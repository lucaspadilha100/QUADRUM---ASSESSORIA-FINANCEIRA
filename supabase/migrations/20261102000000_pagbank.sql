-- PagBank (04/11/2026, pedido do dono do processo): cada parcela pode ganhar
-- cobrança REAL no PagBank — boleto (com multa e juros), PIX (copia-e-cola) e
-- link de cartão —, e o pagamento volta SOZINHO pelo aviso do PagBank
-- (webhook), marcando a parcela como paga para a equipe e para o cliente.
-- Documentação lida: docs/integracao-pagbank.md.
--
--   · Quem fala com o PagBank são as Edge Functions `pagbank` (a equipe emite
--     e consulta) e `pagbank-webhook` (o PagBank avisa). O token mora só nos
--     segredos delas; o banco nunca vê o token.
--   · A equipe NÃO grava cobrança nem marca "pago pelo PagBank" pela API: as
--     funções de escrita são só da `service_role` (as Edge Functions). Assim
--     ninguém forja um pagamento pelo navegador.
--   · Nada se apaga: cobrança encerrada fica (`encerrada_em`), e todo aviso
--     recebido fica cru em `pagbank_eventos`.

-- ═══ BLOCO 1 · as cobranças e o registro dos avisos ═══════════════════════
create table if not exists public.parcela_cobrancas (
  id                   uuid primary key,              -- vai como reference_id ao PagBank
  parcela_id           uuid not null references public.contrato_parcelas(id),
  contrato_id          uuid not null references public.contratos(id),
  tipo                 text not null check (tipo in ('boleto', 'pix', 'link')),
  ambiente             text not null check (ambiente in ('sandbox', 'producao')),
  status               text not null default 'WAITING',
  valor                numeric(12,2) not null,
  vencimento           date,
  expira_em            timestamptz,
  pagbank_order_id     text,
  pagbank_charge_id    text,
  pagbank_checkout_id  text,
  boleto_url           text,
  boleto_linha_digitavel text,
  pix_copia_cola       text,
  pix_qr_url           text,
  link_url             text,
  pago_em              timestamptz,
  encerrada_em         timestamptz,
  motivo_encerramento  text,
  criada_por           uuid references public.perfis(id),
  resposta             jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists parcela_cobrancas_uma_aberta on public.parcela_cobrancas (parcela_id, tipo) where encerrada_em is null;
create index if not exists parcela_cobrancas_parcela on public.parcela_cobrancas (parcela_id, created_at desc);
create index if not exists parcela_cobrancas_charge on public.parcela_cobrancas (pagbank_charge_id);
create index if not exists parcela_cobrancas_checkout on public.parcela_cobrancas (pagbank_checkout_id);
drop trigger if exists trg_parcela_cobrancas_updated_at on public.parcela_cobrancas;
create trigger trg_parcela_cobrancas_updated_at before update on public.parcela_cobrancas
  for each row execute function public.q_tocar_updated_at();

alter table public.parcela_cobrancas enable row level security;
revoke all on public.parcela_cobrancas from anon;
revoke insert, update, delete on public.parcela_cobrancas from authenticated;
drop policy if exists parcela_cobrancas_le on public.parcela_cobrancas;
create policy parcela_cobrancas_le on public.parcela_cobrancas
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

-- Todo aviso que chega, cru, válido ou não (prova e diagnóstico).
create table if not exists public.pagbank_eventos (
  id           uuid primary key default gen_random_uuid(),
  recebido_em  timestamptz not null default now(),
  assinatura_ok boolean not null,
  origem       text,
  corpo        text not null,
  cobranca_id  uuid references public.parcela_cobrancas(id),
  resultado    text
);
create index if not exists pagbank_eventos_recebido on public.pagbank_eventos (recebido_em desc);
alter table public.pagbank_eventos enable row level security;
revoke all on public.pagbank_eventos from anon;
revoke insert, update, delete on public.pagbank_eventos from authenticated;
drop policy if exists pagbank_eventos_le on public.pagbank_eventos;
create policy pagbank_eventos_le on public.pagbank_eventos
  for select to authenticated using ((select public.q_e_gestor()));


-- ═══ BLOCO 2 · o que a Edge Function lê (com o login de quem pediu) ═══════
-- Os dados para emitir a cobrança de uma parcela. Quem não vê o contrato não
-- recebe nada: a função `pagbank` chama isto COM o token do usuário.
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
                                  'pago', p.pago_em is not null, 'cancelada', p.cancelada_em is not null),
    'total_parcelas', v_total,
    'contrato', jsonb_build_object('id', k.id, 'numero', k.numero, 'cancelado', k.cancelado_em is not null),
    'cliente', jsonb_build_object('nome', c.nome, 'documento', c.documento, 'email', c.email, 'telefone', c.telefone,
      'logradouro', c.logradouro, 'numero', c.endereco_numero, 'complemento', c.complemento, 'bairro', c.bairro,
      'cidade', c.cidade, 'uf', c.uf, 'cep', c.cep));
end $$;
revoke execute on function public.q_parcela_dados_cobranca(uuid) from public, anon;
grant execute on function public.q_parcela_dados_cobranca(uuid) to authenticated, service_role;


-- ═══ BLOCO 3 · o que só a Edge Function grava (service_role) ═════════════
-- Registra a cobrança emitida. A anterior do MESMO tipo, se aberta, é
-- encerrada como substituída (o boleto antigo só expira: o PagBank não
-- cancela boleto em aberto pela API).
create or replace function public.q_cobranca_registrar(
  p_id uuid, p_parcela uuid, p_tipo text, p_ambiente text, p_criada_por uuid, p_dados jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.contrato_parcelas where id = p_parcela;
  if not found then raise exception 'Parcela não encontrada.' using errcode = 'P0001'; end if;
  update public.parcela_cobrancas
     set encerrada_em = now(), motivo_encerramento = 'substituida'
   where parcela_id = p_parcela and tipo = p_tipo and encerrada_em is null;
  insert into public.parcela_cobrancas (id, parcela_id, contrato_id, tipo, ambiente, status, valor, vencimento, expira_em,
    pagbank_order_id, pagbank_charge_id, pagbank_checkout_id, boleto_url, boleto_linha_digitavel, pix_copia_cola,
    pix_qr_url, link_url, criada_por, resposta)
  values (p_id, p_parcela, p.contrato_id, p_tipo, p_ambiente, coalesce(p_dados ->> 'status', 'WAITING'), p.valor,
          coalesce((p_dados ->> 'vencimento')::date, p.vencimento), -- o boleto não vence hoje: pode ser amanhã
    (p_dados ->> 'expira_em')::timestamptz, p_dados ->> 'order_id', p_dados ->> 'charge_id', p_dados ->> 'checkout_id',
    p_dados ->> 'boleto_url', p_dados ->> 'boleto_linha_digitavel', p_dados ->> 'pix_copia_cola', p_dados ->> 'pix_qr_url',
    p_dados ->> 'link_url', p_criada_por, p_dados -> 'resposta');
  return p_id;
end $$;
revoke execute on function public.q_cobranca_registrar(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.q_cobranca_registrar(uuid, uuid, text, text, uuid, jsonb) to service_role;

-- Um aviso (ou consulta) do PagBank sobre uma cobrança. PAID marca a parcela
-- paga (data do pagamento no dia de Brasília); status final encerra.
create or replace function public.q_pagbank_evento(
  p_cobranca uuid, p_status text, p_pago_em timestamptz, p_metodo text, p_charge_id text, p_order_id text
) returns text language plpgsql security definer set search_path = public as $$
declare c record; p record; v_forma text;
begin
  select * into c from public.parcela_cobrancas where id = p_cobranca;
  if not found then return 'cobranca_desconhecida'; end if;
  -- O status só ANDA: o PagBank reentrega e não garante ordem, e o link
  -- expira depois de pago. Paga não volta; encerrada não reabre.
  if c.status = 'PAID' and p_status <> 'PAID' then return 'ignorado:ja_paga'; end if;
  if c.status in ('CANCELED', 'DECLINED', 'EXPIRED') and p_status not in ('PAID', 'CANCELED', 'DECLINED', 'EXPIRED') then
    return 'ignorado:encerrada';
  end if;
  update public.parcela_cobrancas
     set status = p_status,
         pagbank_charge_id = coalesce(pagbank_charge_id, p_charge_id),
         pagbank_order_id = coalesce(pagbank_order_id, p_order_id),
         pago_em = case when p_status = 'PAID' then coalesce(p_pago_em, now()) else pago_em end,
         encerrada_em = case when p_status in ('PAID', 'CANCELED', 'DECLINED', 'EXPIRED') then coalesce(encerrada_em, now()) else encerrada_em end,
         motivo_encerramento = case when p_status in ('PAID', 'CANCELED', 'DECLINED', 'EXPIRED') and encerrada_em is null then lower(p_status) else motivo_encerramento end
   where id = p_cobranca;
  if p_status <> 'PAID' then return 'status:' || p_status; end if;

  select * into p from public.contrato_parcelas where id = c.parcela_id;
  if p.cancelada_em is not null then return 'pago_parcela_cancelada'; end if;
  if p.pago_em is not null then return 'pago_parcela_ja_paga'; end if;
  v_forma := case upper(coalesce(p_metodo, c.tipo))
               when 'BOLETO' then 'Boleto bancário' when 'PIX' then 'PIX'
               when 'CREDIT_CARD' then 'Cartão de crédito' when 'DEBIT_CARD' then 'Cartão de débito'
               when 'LINK' then 'Cartão de crédito' else coalesce(p_metodo, c.tipo) end;
  update public.contrato_parcelas
     set pago_em = least((coalesce(p_pago_em, now()) at time zone 'America/Sao_Paulo')::date,
                         (now() at time zone 'America/Sao_Paulo')::date),
         pago_forma = v_forma,
         pago_obs = 'PagBank ' || coalesce(p_charge_id, c.pagbank_charge_id, c.pagbank_checkout_id, ''),
         pago_registrado_em = now(), pago_registrado_por = null
   where id = c.parcela_id;
  return 'parcela_paga';
end $$;
revoke execute on function public.q_pagbank_evento(uuid, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.q_pagbank_evento(uuid, text, timestamptz, text, text, text) to service_role;

-- Guarda o aviso cru (a Edge Function chama ANTES de interpretar).
create or replace function public.q_pagbank_evento_log(p_assinatura_ok boolean, p_origem text, p_corpo text)
returns uuid language sql security definer set search_path = public as $$
  insert into public.pagbank_eventos (assinatura_ok, origem, corpo) values (p_assinatura_ok, p_origem, p_corpo) returning id;
$$;
revoke execute on function public.q_pagbank_evento_log(boolean, text, text) from public, anon, authenticated;
grant execute on function public.q_pagbank_evento_log(boolean, text, text) to service_role;

create or replace function public.q_pagbank_evento_resultado(p_evento uuid, p_cobranca uuid, p_resultado text)
returns void language sql security definer set search_path = public as $$
  update public.pagbank_eventos set cobranca_id = p_cobranca, resultado = p_resultado where id = p_evento;
$$;
revoke execute on function public.q_pagbank_evento_resultado(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.q_pagbank_evento_resultado(uuid, uuid, text) to service_role;


-- ═══ BLOCO 4 · a parcela muda → a cobrança aberta deixa de valer ═════════
-- Paga por outro caminho (dinheiro), cancelada, ou com valor/vencimento
-- novo: as cobranças abertas saem do portal. ⚠️ O boleto/PIX já emitido não
-- some do PagBank (boleto não cancela pela API; PIX e link expiram).
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
  end if;
  return null;
end $$;
revoke execute on function public.q_parcela_encerra_cobrancas() from public, anon, authenticated;
drop trigger if exists trg_parcela_encerra_cobrancas on public.contrato_parcelas;
create trigger trg_parcela_encerra_cobrancas after update on public.contrato_parcelas
  for each row execute function public.q_parcela_encerra_cobrancas();


-- ═══ BLOCO 5 · o portal mostra as cobranças abertas; ao vivo ══════════════
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

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'parcela_cobrancas') then
    alter publication supabase_realtime add table public.parcela_cobrancas;
  end if;
end $$;
