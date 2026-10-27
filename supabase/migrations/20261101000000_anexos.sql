-- Anexos (27/10/2026, pedido do dono do processo): a foto/PDF dos documentos
-- do cliente (RG/CNH, comprovante de residência) e do contrato (CRLV, contrato
-- do financiamento) ficam guardados junto dos dados, "como outra fonte"; e o
-- documento "assinado fora" ganha o ARQUIVO assinado (o link vira opcional).
--
--   · Bucket PRIVADO `anexos`: `cliente/<cliente_id>/…` e `contrato/<contrato_id>/…`.
--     A equipe lê e envia só no que ela VÊ (a mesma regra da carteira);
--     ninguém troca nem apaga arquivo. Foto é reduzida no navegador.
--   · `anexo_tipos` é CADASTRO (tipo novo é INSERT): `de` diz se é do cliente
--     ou do contrato, `secao` diz em que bloco da tela ele aparece.
--   · `anexos`: nada se apaga — "remover" é desativar.
--   · O cliente vê no portal só o arquivo de documento ASSINADO fora do
--     contrato dele (os anexos de cadastro são da equipe).

-- ═══ BLOCO 1 · os tipos e os anexos ═══════════════════════════════════════
create table if not exists public.anexo_tipos (
  codigo  text primary key,
  nome    text not null,
  de      text not null check (de in ('cliente', 'contrato')),
  secao   text not null,
  ordem   int  not null default 0,
  ativo   boolean not null default true
);
alter table public.anexo_tipos enable row level security;
revoke all on public.anexo_tipos from anon;
revoke insert, update, delete on public.anexo_tipos from authenticated;
drop policy if exists anexo_tipos_le on public.anexo_tipos;
create policy anexo_tipos_le on public.anexo_tipos for select to authenticated using ((select public.q_e_equipe()));

insert into public.anexo_tipos (codigo, nome, de, secao, ordem) values
  ('rg_cnh',                 'RG / CNH',                       'cliente',  'identificacao', 10),
  ('cpf',                    'CPF',                            'cliente',  'identificacao', 20),
  ('outro_cliente',          'Outro documento do cliente',     'cliente',  'identificacao', 90),
  ('comprovante_residencia', 'Comprovante de residência',      'cliente',  'endereco',      10),
  ('crlv',                   'Documento do veículo (CRLV)',    'contrato', 'veiculo',       10),
  ('foto_veiculo',           'Foto do veículo',                'contrato', 'veiculo',       20),
  ('contrato_financiamento', 'Contrato do financiamento',      'contrato', 'financiamento', 10),
  ('extrato_financiamento',  'Extrato / boleto do banco',      'contrato', 'financiamento', 20)
on conflict (codigo) do nothing;

create table if not exists public.anexos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id),
  contrato_id    uuid references public.contratos(id),
  tipo           text not null references public.anexo_tipos(codigo),
  path           text not null unique,
  nome           text,
  mime           text,
  tamanho        int,
  created_by     uuid references public.perfis(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  desativado_em  timestamptz,
  desativado_por uuid references public.perfis(id)
);
create index if not exists anexos_cliente on public.anexos (cliente_id, created_at desc);
create index if not exists anexos_contrato on public.anexos (contrato_id, created_at desc);
alter table public.anexos enable row level security;
revoke all on public.anexos from anon;
revoke insert, update, delete on public.anexos from authenticated;
drop policy if exists anexos_le on public.anexos;
create policy anexos_le on public.anexos
  for select to authenticated
  using ((select public.q_e_gestor())
         or cliente_id in (select public.q_meus_clientes())
         or contrato_id in (select public.q_meus_contratos()));

-- O documento assinado fora pode ter o arquivo assinado.
alter table public.contrato_documentos add column if not exists arquivo_path text;


-- ═══ BLOCO 2 · o bucket e quem lê/envia ═══════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 10485760, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A equipe: a pasta de cliente ou de contrato que ela vê.
create or replace function public.q_anexo_pasta_minha(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.q_e_equipe() and (
    public.q_e_gestor()
    or ((storage.foldername(p_nome))[1] = 'cliente'
        and (storage.foldername(p_nome))[2] in (select c::text from public.q_meus_clientes() c))
    or ((storage.foldername(p_nome))[1] = 'contrato'
        and (storage.foldername(p_nome))[2] in (select c::text from public.q_meus_contratos() c)));
$$;
revoke execute on function public.q_anexo_pasta_minha(text) from public, anon;
grant execute on function public.q_anexo_pasta_minha(text) to authenticated, service_role;

-- O cliente: só o arquivo de documento ASSINADO de contrato dele no portal.
create or replace function public.q_portal_arquivo_visivel(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contrato_documentos d
     where d.arquivo_path = p_nome and d.assinado_em is not null and d.cancelado_em is null
       and d.contrato_id in (select public.q_portal_meus_contratos()));
$$;
revoke execute on function public.q_portal_arquivo_visivel(text) from public, anon;
grant execute on function public.q_portal_arquivo_visivel(text) to authenticated, service_role;

drop policy if exists anexos_equipe_le on storage.objects;
create policy anexos_equipe_le on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos' and public.q_anexo_pasta_minha(name));

drop policy if exists anexos_equipe_envia on storage.objects;
create policy anexos_equipe_envia on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos' and public.q_anexo_pasta_minha(name));

drop policy if exists anexos_cliente_le on storage.objects;
create policy anexos_cliente_le on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos' and public.q_portal_arquivo_visivel(name));


-- ═══ BLOCO 3 · as portas ══════════════════════════════════════════════════

-- O arquivo já está no bucket; registra de quem ele é. O tipo diz se é do
-- cliente ou do contrato, e a pasta tem de ser a dele.
create or replace function public.q_anexo_registrar(
  p_tipo text, p_cliente uuid, p_contrato uuid, p_path text, p_nome text, p_mime text, p_tamanho int
) returns uuid language plpgsql security definer set search_path = public as $$
declare t record; v_cliente uuid; v_id uuid;
begin
  if not public.q_e_equipe() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select * into t from public.anexo_tipos where codigo = p_tipo and ativo;
  if not found then raise exception 'Tipo de anexo não encontrado.' using errcode = 'P0001'; end if;
  if t.de = 'contrato' then
    if p_contrato is null or not public.q_ve_contrato(p_contrato) then
      raise exception 'Contrato não encontrado.' using errcode = '42501';
    end if;
    if p_path not like 'contrato/' || p_contrato || '/%' then
      raise exception 'Arquivo fora da pasta do contrato.' using errcode = 'P0001';
    end if;
    select cliente_id into v_cliente from public.contratos where id = p_contrato;
  else
    if p_cliente is null or not public.q_ve_cliente(p_cliente) then
      raise exception 'Cliente não encontrado.' using errcode = '42501';
    end if;
    if p_path not like 'cliente/' || p_cliente || '/%' then
      raise exception 'Arquivo fora da pasta do cliente.' using errcode = 'P0001';
    end if;
    v_cliente := p_cliente;
    p_contrato := null;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'anexos' and name = p_path) then
    raise exception 'Arquivo não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.anexos (cliente_id, contrato_id, tipo, path, nome, mime, tamanho)
  values (v_cliente, p_contrato, p_tipo, p_path, left(p_nome, 200), p_mime, p_tamanho)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.q_anexo_registrar(text, uuid, uuid, text, text, text, int) from public, anon;
grant execute on function public.q_anexo_registrar(text, uuid, uuid, text, text, text, int) to authenticated, service_role;

-- "Remover" um anexo: some da tela, o arquivo e a linha ficam.
create or replace function public.q_anexo_desativar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.anexos where id = p_id;
  if not found or not public.q_e_equipe()
     or not (public.q_ve_cliente(a.cliente_id) or (a.contrato_id is not null and public.q_ve_contrato(a.contrato_id))) then
    raise exception 'Anexo não encontrado.' using errcode = '42501';
  end if;
  update public.anexos set desativado_em = now(), desativado_por = auth.uid()
   where id = p_id and desativado_em is null;
end $$;
revoke execute on function public.q_anexo_desativar(uuid) from public, anon;
grant execute on function public.q_anexo_desativar(uuid) to authenticated, service_role;

-- Documento assinado fora: o arquivo tem de estar na pasta DO CONTRATO e no
-- bucket; documento gerado pelo sistema não leva arquivo (a prova é outra).
-- Anexar = evento na trilha do documento.
create or replace function public.q_documento_arquivo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.arquivo_path is not null and (tg_op = 'INSERT' or new.arquivo_path is distinct from old.arquivo_path) then
    if new.conteudo is not null then
      raise exception 'Documento do sistema não leva arquivo.' using errcode = 'P0001';
    end if;
    if new.arquivo_path not like 'contrato/' || new.contrato_id || '/%'
       or not exists (select 1 from storage.objects where bucket_id = 'anexos' and name = new.arquivo_path) then
      raise exception 'Arquivo não encontrado na pasta do contrato.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.q_documento_arquivo() from public, anon, authenticated;
drop trigger if exists trg_documento_arquivo on public.contrato_documentos;
create trigger trg_documento_arquivo before insert or update of arquivo_path on public.contrato_documentos
  for each row execute function public.q_documento_arquivo();

create or replace function public.q_documento_arquivo_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.arquivo_path is not null and (tg_op = 'INSERT' or new.arquivo_path is distinct from old.arquivo_path) then
    perform public.q_documento_evento(new.id, 'arquivo_anexado', 'equipe', auth.uid(),
      jsonb_build_object('arquivo', new.arquivo_path));
  end if;
  if tg_op = 'INSERT' and new.conteudo is null and new.assinado_em is not null then
    perform public.q_documento_evento(new.id, 'marcado_assinado', 'equipe', auth.uid(), null);
  end if;
  return null;
end $$;
revoke execute on function public.q_documento_arquivo_evento() from public, anon, authenticated;
drop trigger if exists trg_documento_arquivo_evento on public.contrato_documentos;
create trigger trg_documento_arquivo_evento after insert or update of arquivo_path on public.contrato_documentos
  for each row execute function public.q_documento_arquivo_evento();


-- ═══ BLOCO 4 · portal e LGPD (troca no texto VIVO das funções) ═══════════
-- O portal diz, em cada documento assinado, se há arquivo para ver.
do $$
declare
  v_def text := pg_get_functiondef('public.portal_contratos()'::regprocedure);
  a text := $a$'id', cd.id, 'nome', coalesce(cd.titulo, t.nome), 'assinado_em', cd.assinado_em,
               'no_sistema', cd.conteudo is not null)$a$;
begin
  if position('arquivo_path' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then
    raise exception 'portal_contratos não tem o trecho esperado; nada foi mudado.';
  end if;
  execute replace(v_def, a, $b$'id', cd.id, 'nome', coalesce(cd.titulo, t.nome), 'assinado_em', cd.assinado_em,
               'no_sistema', cd.conteudo is not null, 'arquivo', cd.arquivo_path)$b$);
end $$;

-- Exportar os dados do cliente leva os anexos (a lista; os arquivos ficam no bucket).
do $$
declare
  v_def text := pg_get_functiondef('public.q_cliente_exportar(uuid)'::regprocedure);
  a text := $a$'cliente', to_jsonb(c) - 'busca',$a$;
begin
  if position('public.anexos' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then
    raise exception 'q_cliente_exportar não tem o trecho esperado; nada foi mudado.';
  end if;
  execute replace(v_def, a, a || $b$
    'anexos', (select coalesce(jsonb_agg(to_jsonb(ax) order by ax.created_at), '[]'::jsonb) from public.anexos ax where ax.cliente_id = c.id),$b$);
end $$;
