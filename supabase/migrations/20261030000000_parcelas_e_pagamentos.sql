-- Parcelas do plano e pagamentos (27/10/2026, pedido do dono do processo).
--
--   · Unidade e linha de crédito nascem PREENCHIDAS (Matriz, Veicular): hoje não
--     há filial nem outra linha, e escolher seria um passo à toa. O padrão é
--     CADASTRO (`padrao` na tabela), não código: filial nova é um UPDATE.
--   · O plano escolhido vira PARCELAS (`contrato_parcelas`), com a data de cada
--     uma — a 1ª onde a equipe quiser (hoje, p. ex.), as demais num dia fixo do
--     mês. É delas que o banco vai emitir boleto/PIX quando for integrado
--     (colunas `cobranca_id`, `boleto_*`, `pix_copia_cola`, por ora vazias).
--   · A equipe marca como PAGO (dinheiro, PIX…) e o cliente vê no portal
--     (`portal_pagamentos`), com aviso no sininho.
--
-- Nada se apaga: parcela que sai do plano é CANCELADA; pagamento desfeito fica
-- na trilha (`parcela_eventos`), com o motivo.

-- ═══ BLOCO 1 · unidade e linha de crédito padrão ═══════════════════════════
alter table public.unidades       add column if not exists padrao boolean not null default false;
alter table public.linhas_credito add column if not exists padrao boolean not null default false;
create unique index if not exists unidades_uma_padrao       on public.unidades ((true)) where padrao;
create unique index if not exists linhas_credito_uma_padrao on public.linhas_credito ((true)) where padrao;

do $$
declare v uuid;
begin
  if not exists (select 1 from public.unidades where padrao) then
    select id into v from public.unidades where lower(nome) like 'matriz%' order by ativo desc, created_at limit 1;
    if v is null then
      insert into public.unidades (nome, cidade, uf, padrao) values ('Matriz', 'Natal', 'RN', true);
    else
      update public.unidades set padrao = true, ativo = true where id = v;
    end if;
  end if;
  if not exists (select 1 from public.linhas_credito where padrao) then
    select id into v from public.linhas_credito where lower(nome) like 'veicular%' order by ativo desc, created_at limit 1;
    if v is null then
      insert into public.linhas_credito (nome, tem_veiculo, padrao) values ('Veicular', true, true);
    else
      update public.linhas_credito set padrao = true, ativo = true where id = v;
    end if;
  end if;
end $$;

-- Contrato sem unidade ou sem linha recebe a padrão (na criação e se alguém
-- tentar esvaziar depois).
create or replace function public.q_contrato_padroes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.unidade_id is null then
    select id into new.unidade_id from public.unidades where padrao and ativo;
  end if;
  if new.linha_credito_id is null then
    select id into new.linha_credito_id from public.linhas_credito where padrao and ativo;
  end if;
  return new;
end $$;
revoke execute on function public.q_contrato_padroes() from public, anon, authenticated;
drop trigger if exists trg_contrato_padroes on public.contratos;
create trigger trg_contrato_padroes before insert or update of unidade_id, linha_credito_id on public.contratos
  for each row execute function public.q_contrato_padroes();

-- Os contratos de antes ganham a padrão onde estava vazio.
update public.contratos set unidade_id = (select id from public.unidades where padrao and ativo)
 where unidade_id is null;
update public.contratos set linha_credito_id = (select id from public.linhas_credito where padrao and ativo)
 where linha_credito_id is null;

-- O dia em que as parcelas vencem todo mês (5, 10, 15…): é o que o banco vai
-- usar para emitir. A 1ª pode ser outra data (plano_primeiro_vencimento).
alter table public.contratos add column if not exists plano_dia_vencimento smallint
  check (plano_dia_vencimento between 1 and 31);


-- ═══ BLOCO 2 · as parcelas ═════════════════════════════════════════════════
create table if not exists public.contrato_parcelas (
  id                    uuid primary key default gen_random_uuid(),
  contrato_id           uuid not null references public.contratos(id),
  numero                int  not null check (numero between 0 and 360),   -- 0 = entrada
  valor                 numeric(12,2) not null check (valor > 0),
  vencimento            date not null,
  pago_em               date,
  pago_forma            text,
  pago_obs              text,
  pago_registrado_em    timestamptz,
  pago_registrado_por   uuid references public.perfis(id),
  cancelada_em          timestamptz,
  cancelada_por         uuid references public.perfis(id),
  -- Integração com o banco (boleto/PIX/cartão), quando existir.
  cobranca_id             text,
  boleto_linha_digitavel  text,
  boleto_url              text,
  pix_copia_cola          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (pago_em is null or pago_forma is not null)
);
comment on table public.contrato_parcelas is
  'O plano escolhido, parcela a parcela (0 = entrada). Só nasce e muda pelas funções q_parcelas_definir / q_parcela_pagar / q_parcela_desfazer_pagamento. Nada se apaga: sai do plano = cancelada_em.';
create unique index if not exists contrato_parcelas_numero on public.contrato_parcelas (contrato_id, numero) where cancelada_em is null;
create index if not exists contrato_parcelas_contrato on public.contrato_parcelas (contrato_id, numero);

drop trigger if exists trg_contrato_parcelas_updated_at on public.contrato_parcelas;
create trigger trg_contrato_parcelas_updated_at before update on public.contrato_parcelas
  for each row execute function public.q_tocar_updated_at();

alter table public.contrato_parcelas enable row level security;
revoke all on public.contrato_parcelas from anon;
revoke insert, update, delete on public.contrato_parcelas from authenticated;
drop policy if exists contrato_parcelas_le on public.contrato_parcelas;
create policy contrato_parcelas_le on public.contrato_parcelas
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

-- A trilha: quem criou, mudou, pagou, desfez ou cancelou cada parcela.
create table if not exists public.parcela_eventos (
  id          uuid primary key default gen_random_uuid(),
  parcela_id  uuid not null references public.contrato_parcelas(id),
  contrato_id uuid not null references public.contratos(id),
  tipo        text not null check (tipo in ('criada', 'alterada', 'paga', 'pagamento_desfeito', 'cancelada')),
  dados       jsonb not null default '{}'::jsonb,
  autor_id    uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists parcela_eventos_parcela on public.parcela_eventos (parcela_id, created_at);
alter table public.parcela_eventos enable row level security;
revoke all on public.parcela_eventos from anon;
revoke insert, update, delete on public.parcela_eventos from authenticated;
drop policy if exists parcela_eventos_le on public.parcela_eventos;
create policy parcela_eventos_le on public.parcela_eventos
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

-- Regras que valem para QUALQUER caminho de escrita (a função é só a porta).
create or replace function public.q_parcela_protege()
returns trigger language plpgsql set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'UPDATE' then
    if old.cancelada_em is not null then
      raise exception 'Parcela cancelada não muda.' using errcode = 'P0001';
    end if;
    if old.pago_em is not null and new.pago_em is not null
       and (new.valor is distinct from old.valor or new.vencimento is distinct from old.vencimento
            or new.cancelada_em is not null or new.pago_em is distinct from old.pago_em) then
      raise exception 'A parcela % já foi paga: não muda.', old.numero using errcode = 'P0001';
    end if;
    if old.pago_em is not null and new.pago_em is null and auth.uid() is not null and not public.q_e_gestor() then
      raise exception 'Só um gestor desfaz um pagamento.' using errcode = '42501';
    end if;
  end if;
  if new.pago_em is not null and new.pago_em > v_hoje then
    raise exception 'A data do pagamento não pode ser no futuro.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_parcela_protege() from public, anon, authenticated;
drop trigger if exists trg_parcela_protege on public.contrato_parcelas;
create trigger trg_parcela_protege before insert or update on public.contrato_parcelas
  for each row execute function public.q_parcela_protege();

create or replace function public.q_parcela_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_dados jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_tipo := 'criada';
    v_dados := jsonb_build_object('valor', new.valor, 'vencimento', new.vencimento);
  elsif new.cancelada_em is not null and old.cancelada_em is null then
    v_tipo := 'cancelada';
  elsif new.pago_em is not null and old.pago_em is null then
    v_tipo := 'paga';
    v_dados := jsonb_build_object('pago_em', new.pago_em, 'forma', new.pago_forma, 'obs', new.pago_obs);
  elsif new.pago_em is null and old.pago_em is not null then
    v_tipo := 'pagamento_desfeito';
    v_dados := jsonb_build_object('pago_em', old.pago_em, 'forma', old.pago_forma,
                                  'motivo', nullif(current_setting('q.motivo', true), ''));
  elsif new.valor is distinct from old.valor or new.vencimento is distinct from old.vencimento then
    v_tipo := 'alterada';
    v_dados := jsonb_build_object('de', jsonb_build_object('valor', old.valor, 'vencimento', old.vencimento),
                                  'para', jsonb_build_object('valor', new.valor, 'vencimento', new.vencimento));
  else
    return null;
  end if;
  insert into public.parcela_eventos (parcela_id, contrato_id, tipo, dados) values (new.id, new.contrato_id, v_tipo, v_dados);
  return null;
end $$;
revoke execute on function public.q_parcela_evento() from public, anon, authenticated;
drop trigger if exists trg_parcela_evento on public.contrato_parcelas;
create trigger trg_parcela_evento after insert or update on public.contrato_parcelas
  for each row execute function public.q_parcela_evento();


-- ═══ BLOCO 3 · as portas: definir o plano, pagar, desfazer ═════════════════

-- A lista INTEIRA do plano: [{numero, valor, vencimento}]. O que está pago
-- tem de vir igual; o que não está na lista e não foi pago é cancelado; o
-- resto é criado ou alterado. Devolve quantas parcelas ficaram.
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
    elsif (it ->> 'valor')::numeric <> p.valor or (it ->> 'vencimento')::date <> p.vencimento then
      update public.contrato_parcelas set valor = (it ->> 'valor')::numeric, vencimento = (it ->> 'vencimento')::date where id = p.id;
    end if;
  end loop;

  -- O que é novo.
  insert into public.contrato_parcelas (contrato_id, numero, valor, vencimento)
  select p_contrato, (e ->> 'numero')::int, (e ->> 'valor')::numeric, (e ->> 'vencimento')::date
    from jsonb_array_elements(p_parcelas) e
   where not exists (select 1 from public.contrato_parcelas x
                      where x.contrato_id = p_contrato and x.cancelada_em is null and x.numero = (e ->> 'numero')::int);

  select count(*) into v_n from public.contrato_parcelas where contrato_id = p_contrato and cancelada_em is null;
  return v_n;
end $$;
revoke execute on function public.q_parcelas_definir(uuid, jsonb) from public, anon;
grant execute on function public.q_parcelas_definir(uuid, jsonb) to authenticated, service_role;

create or replace function public.q_parcela_pagar(p_parcela uuid, p_pago_em date, p_forma text, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.contrato_parcelas where id = p_parcela;
  if not found or not public.q_e_equipe() or not public.q_ve_contrato(p.contrato_id) then
    raise exception 'Parcela não encontrada.' using errcode = '42501';
  end if;
  if p.cancelada_em is not null then raise exception 'Parcela cancelada.' using errcode = 'P0001'; end if;
  if p.pago_em is not null then raise exception 'A parcela % já está paga.', p.numero using errcode = 'P0001'; end if;
  if p_pago_em is null then raise exception 'Informe a data do pagamento.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_forma, ''))) = 0 then raise exception 'Informe a forma de pagamento.' using errcode = 'P0001'; end if;
  update public.contrato_parcelas
     set pago_em = p_pago_em, pago_forma = trim(p_forma), pago_obs = nullif(trim(coalesce(p_obs, '')), ''),
         pago_registrado_em = now(), pago_registrado_por = auth.uid()
   where id = p_parcela;
end $$;
revoke execute on function public.q_parcela_pagar(uuid, date, text, text) from public, anon;
grant execute on function public.q_parcela_pagar(uuid, date, text, text) to authenticated, service_role;

create or replace function public.q_parcela_desfazer_pagamento(p_parcela uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor desfaz um pagamento.' using errcode = '42501';
  end if;
  select * into p from public.contrato_parcelas where id = p_parcela;
  if not found then raise exception 'Parcela não encontrada.' using errcode = 'P0001'; end if;
  if p.pago_em is null then raise exception 'A parcela não está paga.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  perform set_config('q.motivo', trim(p_motivo), true);
  update public.contrato_parcelas
     set pago_em = null, pago_forma = null, pago_obs = null, pago_registrado_em = null, pago_registrado_por = null
   where id = p_parcela;
end $$;
revoke execute on function public.q_parcela_desfazer_pagamento(uuid, text) from public, anon;
grant execute on function public.q_parcela_desfazer_pagamento(uuid, text) to authenticated, service_role;


-- ═══ BLOCO 4 · o portal: Pagamentos ═══════════════════════════════════════
-- Do contrato que o cliente vê (aceito), as parcelas em vigor. A observação
-- interna do pagamento NÃO sai daqui.
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
               'boleto_url', p.boleto_url, 'boleto_linha_digitavel', p.boleto_linha_digitavel,
               'pix_copia_cola', p.pix_copia_cola)
             order by p.numero), '[]'::jsonb)
      from public.contrato_parcelas p where p.contrato_id = k.id and p.cancelada_em is null)
  ) order by k.numero desc), '[]'::jsonb)
  from public.contratos k
  where k.cliente_id = public.q_cliente_da_sessao()
    and k.data_aceite is not null
    and exists (select 1 from public.contrato_parcelas p where p.contrato_id = k.id and p.cancelada_em is null);
$$;
revoke execute on function public.portal_pagamentos() from public, anon;
grant execute on function public.portal_pagamentos() to authenticated, service_role;

-- Pago → o cliente é avisado (se o contrato já está no portal).
create or replace function public.q_notifica_pagamento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_num bigint; v_aceite date;
begin
  begin
    if new.pago_em is not null and old.pago_em is null then
      select c.user_id, k.numero, k.data_aceite into v_user, v_num, v_aceite
        from public.contratos k join public.clientes c on c.id = k.cliente_id
       where k.id = new.contrato_id;
      if v_aceite is not null then
        perform public.q_notificar(v_user, 'pagamento_confirmado', 'Pagamento confirmado',
          format('%s · contrato #%s · %s',
                 case when new.numero = 0 then 'Entrada' else 'Parcela ' || new.numero end, v_num, public.q_moeda(new.valor)),
          '/pagamentos', new.contrato_id, null, null);
      end if;
    end if;
  exception when others then
    raise warning '[notificacoes] pagamento: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_pagamento() from public, anon, authenticated;
drop trigger if exists trg_notifica_pagamento on public.contrato_parcelas;
create trigger trg_notifica_pagamento after update on public.contrato_parcelas
  for each row execute function public.q_notifica_pagamento();


-- ═══ BLOCO 5 · ao vivo e LGPD ═════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'contrato_parcelas') then
    alter publication supabase_realtime add table public.contrato_parcelas;
  end if;
end $$;

-- Exportar os dados do cliente passa a levar as parcelas (troca no texto VIVO).
do $$
declare
  v_def text := pg_get_functiondef('public.q_cliente_exportar(uuid)'::regprocedure);
  a text := $a$'movimentos', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) from public.contrato_movimentos m where m.contrato_id = k.id),$a$;
begin
  if position('contrato_parcelas' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then
    raise exception 'q_cliente_exportar não tem o trecho esperado; nada foi mudado.';
  end if;
  execute replace(v_def, a, a || $b$
        'parcelas', (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.numero, pp.created_at), '[]'::jsonb) from public.contrato_parcelas pp where pp.contrato_id = k.id),$b$);
end $$;
