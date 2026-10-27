-- Comprovante de pagamento na parcela (27/10/2026, pedido do dono do processo):
-- a equipe anexa a foto/PDF do comprovante e o cliente vê no portal.
--
--   · Bucket PRIVADO `comprovantes`, pasta <contrato>/<parcela>/<arquivo>. A
--     foto é reduzida no navegador antes de subir (~200 KB); PDF até 3 MB.
--   · A equipe lê e envia só na pasta de contrato que ela VÊ (a mesma regra da
--     carteira); ninguém troca nem apaga arquivo (nada se apaga).
--   · O cliente LÊ os arquivos dos contratos DELE que já estão no portal — a
--     única regra dele em tabela, e ela descobre quem ele é pela SESSÃO
--     (`q_portal_meus_contratos`), nunca por id vindo da tela.
--   · A parcela guarda o caminho; trocar o comprovante vira evento na trilha.

-- ═══ BLOCO 1 · o bucket e quem lê/envia ═══════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Os contratos do cliente logado que já estão no portal.
create or replace function public.q_portal_meus_contratos()
returns setof uuid language sql stable security definer set search_path = public as $$
  select k.id from public.contratos k
   where k.cliente_id = public.q_cliente_da_sessao() and k.data_aceite is not null;
$$;
revoke execute on function public.q_portal_meus_contratos() from public, anon;
grant execute on function public.q_portal_meus_contratos() to authenticated, service_role;

drop policy if exists comprovantes_equipe_le on storage.objects;
create policy comprovantes_equipe_le on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes' and (
    (select public.q_e_gestor())
    or (storage.foldername(name))[1] in (select c::text from public.q_meus_contratos() c)));

drop policy if exists comprovantes_equipe_envia on storage.objects;
create policy comprovantes_equipe_envia on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes' and (select public.q_e_equipe()) and (
    (select public.q_e_gestor())
    or (storage.foldername(name))[1] in (select c::text from public.q_meus_contratos() c)));

drop policy if exists comprovantes_cliente_le on storage.objects;
create policy comprovantes_cliente_le on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes'
    and (storage.foldername(name))[1] in (select c::text from public.q_portal_meus_contratos() c));


-- ═══ BLOCO 2 · a parcela guarda o comprovante ═════════════════════════════
alter table public.contrato_parcelas add column if not exists comprovante_path text;
alter table public.contrato_parcelas add column if not exists comprovante_em   timestamptz;
alter table public.contrato_parcelas add column if not exists comprovante_por  uuid references public.perfis(id);

alter table public.parcela_eventos drop constraint if exists parcela_eventos_tipo_check;
alter table public.parcela_eventos add constraint parcela_eventos_tipo_check
  check (tipo in ('criada', 'alterada', 'paga', 'pagamento_desfeito', 'cancelada', 'comprovante'));

-- A trilha passa a registrar o comprovante (de → para): o arquivo antigo fica no bucket.
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
  elsif new.comprovante_path is distinct from old.comprovante_path then
    v_tipo := 'comprovante';
    v_dados := jsonb_build_object('de', old.comprovante_path, 'para', new.comprovante_path);
  else
    return null;
  end if;
  insert into public.parcela_eventos (parcela_id, contrato_id, tipo, dados) values (new.id, new.contrato_id, v_tipo, v_dados);
  return null;
end $$;
revoke execute on function public.q_parcela_evento() from public, anon, authenticated;

-- A porta: o arquivo já tem de estar no bucket, na pasta DESTA parcela.
create or replace function public.q_parcela_comprovante(p_parcela uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.contrato_parcelas where id = p_parcela;
  if not found or not public.q_e_equipe() or not public.q_ve_contrato(p.contrato_id) then
    raise exception 'Parcela não encontrada.' using errcode = '42501';
  end if;
  if p.cancelada_em is not null then raise exception 'Parcela cancelada.' using errcode = 'P0001'; end if;
  if p_path is null or p_path not like p.contrato_id || '/' || p.id || '/%' then
    raise exception 'Arquivo fora da pasta desta parcela.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'comprovantes' and name = p_path) then
    raise exception 'Arquivo não encontrado.' using errcode = 'P0001';
  end if;
  update public.contrato_parcelas
     set comprovante_path = p_path, comprovante_em = now(), comprovante_por = auth.uid()
   where id = p_parcela;
end $$;
revoke execute on function public.q_parcela_comprovante(uuid, text) from public, anon;
grant execute on function public.q_parcela_comprovante(uuid, text) to authenticated, service_role;


-- ═══ BLOCO 3 · o portal mostra o comprovante ══════════════════════════════
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
               'pix_copia_cola', p.pix_copia_cola, 'comprovante', p.comprovante_path)
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
