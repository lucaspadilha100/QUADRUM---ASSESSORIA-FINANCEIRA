-- Planos de pagamento (04/11/2026, pedido do dono do processo; tabela em
-- "Tabela de Precificação TriConecta"): cada PLANO é um nível da tabela de
-- honorários com até TRÊS opções de preço — à vista, N boletos de R$ X, ou
-- N vezes de R$ Y no cartão (o preço muda com a forma). No contrato, escolhe-
-- se o plano e a opção, e as cobranças saem prontas; exceção é "personalizado".
--
--   · Cartão parcelado é UMA cobrança: "8x de R$ 137" é um link de R$ 1.096
--     que o cliente divide em até 8x SEM JUROS para ele (a TriConecta assume)
--     — nunca 8 links. `contrato_parcelas.cartao_parcelas` é o "em até Nx" do
--     link; `cartao_sem_juros`, quantas dessas vezes não têm juros.
--   · Boleto/PIX: uma cobrança por parcela, cada uma com valor e vencimento
--     próprios (a tela gera pelo plano e deixa trocar).
--   · `planos_pagamento` é CADASTRO (plano novo = INSERT, sem deploy). A
--     FORMA da cobrança é lista FECHADA (CHECK) de propósito: cada uma muda o
--     que o sistema faz (cartão = um link; boleto = um boleto por parcela).

-- ═══ BLOCO 1 · o cadastro de planos (a tabela de honorários) ══════════════
create table if not exists public.planos_pagamento (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null unique check (length(trim(nome)) > 0),
  ativo            boolean not null default true,
  padrao           boolean not null default false,
  ordem            int not null default 0,
  avista_valor     numeric(12,2) check (avista_valor > 0),
  boleto_parcelas  int check (boleto_parcelas between 1 and 120),
  boleto_valor     numeric(12,2) check (boleto_valor > 0),
  cartao_parcelas  int check (cartao_parcelas between 1 and 18),
  cartao_valor     numeric(12,2) check (cartao_valor > 0),
  cartao_sem_juros int check (cartao_sem_juros between 1 and 18),   -- nulo = todas sem juros
  dia_vencimento   int not null default 10 check (dia_vencimento between 1 and 31),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((boleto_parcelas is null) = (boleto_valor is null)),
  check ((cartao_parcelas is null) = (cartao_valor is null)),
  check (avista_valor is not null or boleto_parcelas is not null or cartao_parcelas is not null),
  check (cartao_sem_juros is null or cartao_sem_juros <= cartao_parcelas)
);
create unique index if not exists planos_pagamento_um_padrao on public.planos_pagamento ((true)) where padrao;
drop trigger if exists trg_planos_pagamento_updated_at on public.planos_pagamento;
create trigger trg_planos_pagamento_updated_at before update on public.planos_pagamento
  for each row execute function public.q_tocar_updated_at();

alter table public.planos_pagamento enable row level security;
revoke all on public.planos_pagamento from anon;
revoke delete on public.planos_pagamento from authenticated;
drop policy if exists planos_pagamento_equipe_le on public.planos_pagamento;
drop policy if exists planos_pagamento_gestor_cria on public.planos_pagamento;
drop policy if exists planos_pagamento_gestor_altera on public.planos_pagamento;
create policy planos_pagamento_equipe_le on public.planos_pagamento
  for select to authenticated using ((select public.q_e_equipe()));
create policy planos_pagamento_gestor_cria on public.planos_pagamento
  for insert to authenticated with check ((select public.q_e_gestor()));
create policy planos_pagamento_gestor_altera on public.planos_pagamento
  for update to authenticated using ((select public.q_e_gestor())) with check ((select public.q_e_gestor()));

-- A Tabela Oficial de Honorários (o gestor edita na tela).
insert into public.planos_pagamento (nome, ordem, padrao, avista_valor, boleto_parcelas, boleto_valor, cartao_parcelas, cartao_valor)
select * from (values
  ('Nível 1 (Acessível)',            1, false,  997.00, 6,  197.00, 8,  137.00),
  ('Nível 2 (Intermediário Baixo)',  2, false, 1997.00, 6,  397.00, 8,  267.00),
  ('Nível Base (Referência)',        3, true,  2997.00, 6,  597.00, 8,  397.00),
  ('Premium 1 (Ajustado)',           4, false, 3997.00, 6,  847.00, 8,  547.00),
  ('Premium 2 (Ajustado)',           5, false, 4997.00, 6, 1097.00, 8,  697.00),
  ('Corporate / VIP',                6, false, 7997.00, 6, 1597.00, 8, 1097.00)
) v(nome, ordem, padrao, avista_valor, boleto_parcelas, boleto_valor, cartao_parcelas, cartao_valor)
where not exists (select 1 from public.planos_pagamento);


-- ═══ BLOCO 2 · cada cobrança sabe a sua forma; o contrato, o seu plano ════
alter table public.contrato_parcelas add column if not exists forma text
  check (forma in ('Boleto bancário', 'PIX', 'Cartão de crédito', 'Transferência bancária'));
alter table public.contrato_parcelas add column if not exists cartao_parcelas int
  check (cartao_parcelas between 1 and 18);
alter table public.contrato_parcelas add column if not exists cartao_sem_juros int
  check (cartao_sem_juros between 1 and 18);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contrato_parcelas_sem_juros_cabe') then
    alter table public.contrato_parcelas add constraint contrato_parcelas_sem_juros_cabe
      check (cartao_sem_juros is null or cartao_sem_juros <= coalesce(cartao_parcelas, 1));
  end if;
end $$;
alter table public.contratos add column if not exists plano_id uuid references public.planos_pagamento(id);
-- A opção escolhida do plano (ou personalizado): é o que reabre a tela como estava.
alter table public.contratos add column if not exists plano_opcao text
  check (plano_opcao in ('avista', 'boleto', 'cartao', 'personalizado'));


-- ═══ BLOCO 3 · gravar o plano leva a forma e o cartão de cada cobrança ═════
-- Mesma regra de antes (paga não muda nem sai; o resto é criado, alterado ou
-- cancelado), agora também com forma, vezes no cartão e sem juros.
create or replace function public.q_parcelas_definir(p_contrato uuid, p_parcelas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  k record; p record; it jsonb; v_n int;
begin
  if not public.q_e_equipe() or not public.q_ve_contrato(p_contrato) then
    raise exception 'Contrato não encontrado.' using errcode = '42501';
  end if;
  select * into k from public.contratos where id = p_contrato;
  if k.cancelado_em is not null then
    raise exception 'Contrato perdido não tem parcelas.' using errcode = 'P0001';
  end if;
  p_parcelas := coalesce(p_parcelas, '[]'::jsonb);
  if jsonb_typeof(p_parcelas) <> 'array' then
    raise exception 'Lista de parcelas inválida.' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_array_elements(p_parcelas) e)
     <> (select count(distinct (e ->> 'numero')) from jsonb_array_elements(p_parcelas) e) then
    raise exception 'Número de parcela repetido.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_parcelas) e
              where (e ->> 'numero') is null or (e ->> 'valor') is null or (e ->> 'vencimento') is null
                 or (e ->> 'valor')::numeric <= 0) then
    raise exception 'Toda parcela precisa de número, valor e vencimento.' using errcode = 'P0001';
  end if;

  -- O que já existe.
  for p in select * from public.contrato_parcelas where contrato_id = p_contrato and cancelada_em is null loop
    it := null;
    select e into it from jsonb_array_elements(p_parcelas) e where (e ->> 'numero')::int = p.numero;
    if p.pago_em is not null then
      if it is null or (it ->> 'valor')::numeric <> p.valor or (it ->> 'vencimento')::date <> p.vencimento then
        raise exception 'A parcela % já foi paga: não muda nem sai do plano.', p.numero using errcode = 'P0001';
      end if;
    elsif it is null then
      update public.contrato_parcelas set cancelada_em = now(), cancelada_por = auth.uid() where id = p.id;
    elsif (it ->> 'valor')::numeric <> p.valor or (it ->> 'vencimento')::date <> p.vencimento
       or (it ->> 'forma') is distinct from p.forma
       or (it ->> 'cartao_parcelas')::int is distinct from p.cartao_parcelas
       or (it ->> 'cartao_sem_juros')::int is distinct from p.cartao_sem_juros then
      update public.contrato_parcelas
         set valor = (it ->> 'valor')::numeric, vencimento = (it ->> 'vencimento')::date,
             forma = it ->> 'forma', cartao_parcelas = (it ->> 'cartao_parcelas')::int,
             cartao_sem_juros = (it ->> 'cartao_sem_juros')::int
       where id = p.id;
    end if;
  end loop;

  -- O que é novo.
  insert into public.contrato_parcelas (contrato_id, numero, valor, vencimento, forma, cartao_parcelas, cartao_sem_juros)
  select p_contrato, (e ->> 'numero')::int, (e ->> 'valor')::numeric, (e ->> 'vencimento')::date,
         e ->> 'forma', (e ->> 'cartao_parcelas')::int, (e ->> 'cartao_sem_juros')::int
    from jsonb_array_elements(p_parcelas) e
   where not exists (select 1 from public.contrato_parcelas x
                      where x.contrato_id = p_contrato and x.cancelada_em is null and x.numero = (e ->> 'numero')::int);

  select count(*) into v_n from public.contrato_parcelas where contrato_id = p_contrato and cancelada_em is null;
  return v_n;
end $$;
revoke execute on function public.q_parcelas_definir(uuid, jsonb) from public, anon;
grant execute on function public.q_parcelas_definir(uuid, jsonb) to authenticated, service_role;

-- Mudou as vezes no cartão: o link aberto (feito com o limite antigo) sai.
-- Valor e vencimento já encerravam tudo (20261102000000); isto é só do link.
create or replace function public.q_parcela_encerra_cobrancas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_motivo text;
begin
  v_motivo := case
    when new.cancelada_em is not null and old.cancelada_em is null then 'parcela_cancelada'
    when new.pago_em is not null and old.pago_em is null then 'parcela_paga'
    when new.valor is distinct from old.valor or new.vencimento is distinct from old.vencimento then 'parcela_alterada'
    else null end;
  if v_motivo is not null then
    update public.parcela_cobrancas set encerrada_em = now(), motivo_encerramento = v_motivo
     where parcela_id = new.id and encerrada_em is null;
  elsif new.cartao_parcelas is distinct from old.cartao_parcelas or new.cartao_sem_juros is distinct from old.cartao_sem_juros then
    update public.parcela_cobrancas set encerrada_em = now(), motivo_encerramento = 'cartao_alterado'
     where parcela_id = new.id and tipo = 'link' and encerrada_em is null;
  end if;
  return null;
end $$;
revoke execute on function public.q_parcela_encerra_cobrancas() from public, anon, authenticated;


-- ═══ BLOCO 4 · o PagBank e o portal leem a forma e o cartão ═══════════════
create or replace function public.q_parcela_dados_cobranca(p_parcela uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p record; k record; c record; v_total int;
begin
  select * into p from public.contrato_parcelas where id = p_parcela;
  if not found or not public.q_e_equipe() or not public.q_ve_contrato(p.contrato_id) then
    raise exception 'Parcela não encontrada.' using errcode = '42501';
  end if;
  select * into k from public.contratos where id = p.contrato_id;
  select * into c from public.clientes where id = k.cliente_id;
  select count(*) into v_total from public.contrato_parcelas where contrato_id = p.contrato_id and cancelada_em is null and numero > 0;
  return jsonb_build_object(
    'parcela', jsonb_build_object('id', p.id, 'numero', p.numero, 'valor', p.valor, 'vencimento', p.vencimento,
                                  'pago', p.pago_em is not null, 'cancelada', p.cancelada_em is not null,
                                  'forma', p.forma, 'cartao_parcelas', p.cartao_parcelas, 'cartao_sem_juros', p.cartao_sem_juros),
    'total_parcelas', v_total,
    'contrato', jsonb_build_object('id', k.id, 'numero', k.numero, 'cancelado', k.cancelado_em is not null),
    'cliente', jsonb_build_object('nome', c.nome, 'documento', c.documento, 'email', c.email, 'telefone', c.telefone,
      'logradouro', c.logradouro, 'numero', c.endereco_numero, 'complemento', c.complemento, 'bairro', c.bairro,
      'cidade', c.cidade, 'uf', c.uf, 'cep', c.cep));
end $$;
revoke execute on function public.q_parcela_dados_cobranca(uuid) from public, anon;
grant execute on function public.q_parcela_dados_cobranca(uuid) to authenticated, service_role;

create or replace function public.portal_pagamentos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'contrato_id', k.id,
    'numero', k.numero,
    'cancelado', k.cancelado_em is not null,
    'forma', k.plano_forma,
    'parcelas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'valor', p.valor, 'vencimento', p.vencimento,
               'pago_em', p.pago_em, 'pago_forma', p.pago_forma,
               'forma', p.forma, 'cartao_parcelas', p.cartao_parcelas,
               'boleto_url', coalesce(cb.boleto_url, p.boleto_url),
               'boleto_linha_digitavel', coalesce(cb.boleto_linha_digitavel, p.boleto_linha_digitavel),
               'pix_copia_cola', coalesce(cx.pix_copia_cola, p.pix_copia_cola),
               'link_cartao', cl.link_url,
               'comprovante', p.comprovante_path)
             order by p.numero), '[]'::jsonb)
      from public.contrato_parcelas p
      left join lateral (select * from public.parcela_cobrancas c where c.parcela_id = p.id and c.tipo = 'boleto' and c.encerrada_em is null order by c.created_at desc limit 1) cb on true
      left join lateral (select * from public.parcela_cobrancas c where c.parcela_id = p.id and c.tipo = 'pix' and c.encerrada_em is null order by c.created_at desc limit 1) cx on true
      left join lateral (select * from public.parcela_cobrancas c where c.parcela_id = p.id and c.tipo = 'link' and c.encerrada_em is null order by c.created_at desc limit 1) cl on true
      where p.contrato_id = k.id and p.cancelada_em is null)
  ) order by k.numero desc), '[]'::jsonb)
  from public.contratos k
  where k.cliente_id = public.q_cliente_da_sessao()
    and k.data_aceite is not null
    and exists (select 1 from public.contrato_parcelas p where p.contrato_id = k.id and p.cancelada_em is null);
$$;
revoke execute on function public.portal_pagamentos() from public, anon;
grant execute on function public.portal_pagamentos() to authenticated, service_role;
