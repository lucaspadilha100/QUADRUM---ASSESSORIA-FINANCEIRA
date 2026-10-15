-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · MODELOS DE DOCUMENTO e ASSINATURA ELETRÔNICA no próprio sistema
--
-- Pedido do dono do processo em 15/10/2026: contrato, termo, declaração e
-- procuração são MODELOS dentro do sistema, preenchidos com os dados do
-- cliente; e o cliente ASSINA no portal, com tudo salvo (IP, horário…).
--
-- O caminho de um documento:
--
--   modelo (cadastro, versionado)
--     → GERAR: o banco preenche {{cliente.nome}}, {{contrato.numero}}… com os
--       dados do cadastro e CONGELA o texto (conteudo) + o SHA-256 dele
--     → o cliente LÊ no portal (cada abertura vira evento, com IP e navegador)
--     → ASSINA: marca o aceite, digita o nome completo e CONFIRMA A SENHA do
--       portal; o banco grava a assinatura com IP, navegador, data/hora do
--       SERVIDOR e o hash do texto exato que foi assinado
--     → o documento assinado não muda, não "desassina" e não é cancelado
--
-- Base legal (para o jurídico conferir): assinatura eletrônica entre
-- particulares é válida quando as partes a admitem — MP 2.200-2/2001, art.
-- 10, § 2º. Por isso cada modelo deve trazer a cláusula em que o cliente
-- concorda com a assinatura eletrônica, e o texto do aceite fica gravado
-- junto da assinatura. Procuração para banco/cartório pode exigir
-- certificado ICP-Brasil ou firma reconhecida: isso é decisão do jurídico.
--
-- Decisões:
--   1. Quem PREENCHE é o banco, não a tela: o texto assinado sai dos dados
--      gravados, e a tela não tem como mandar outra coisa.
--   2. Campo vazio RECUSA a geração e diz qual falta. Procuração com "RG: "
--      em branco é pior que procuração nenhuma.
--   3. O texto gerado é CONGELADO. Mudar o modelo depois não mexe no que já
--      foi gerado (o documento guarda modelo e versão de onde veio).
--   4. Nada se apaga: evento e assinatura são só de inclusão — nenhuma regra
--      de INSERT/UPDATE/DELETE para ninguém; quem grava são as funções.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO 1 · os dados do cliente que os documentos pedem ═════════════════

alter table public.clientes
  add column rg                      text,
  add column rg_orgao                text,
  add column nacionalidade           text,
  add column estado_civil            text,
  add column profissao               text,
  add column data_nascimento         date,
  add column cep                     text,
  add column logradouro              text,
  add column endereco_numero         text,
  add column complemento             text,
  add column bairro                  text,
  add column cidade                  text,
  add column uf                      text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column representante_nome      text,
  add column representante_documento text check (representante_documento is null or representante_documento ~ '^[0-9]{11}$');

comment on column public.clientes.representante_nome is
  'Pessoa jurídica: quem assina por ela (sócio/administrador). Entra na qualificação dos documentos.';


-- ═══ BLOCO 2 · os modelos ══════════════════════════════════════════════════

create table public.documento_modelos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null references public.documento_tipos(codigo),
  nome        text not null,
  corpo       text not null default '',
  versao      int  not null default 1,
  ativo       boolean not null default false,
  created_by  uuid references public.perfis(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.documento_modelos.corpo is
  'Texto do modelo. Campos entre chaves duplas ({{cliente.nome}}) são preenchidos pelo banco ao gerar. Linha começando com "# " é título; **texto** é negrito.';
comment on column public.documento_modelos.ativo is
  'Só modelo ativo gera documento. Nasce INATIVO: texto jurídico vai ao cliente depois de revisado.';

create trigger trg_documento_modelos_updated_at before update on public.documento_modelos
  for each row execute function public.q_tocar_updated_at();

-- Mudou o texto, sobe a versão: o documento gerado diz de qual versão veio.
create or replace function public.q_modelo_versao()
returns trigger language plpgsql as $$
begin
  if new.corpo is distinct from old.corpo then
    new.versao := old.versao + 1;
  else
    new.versao := old.versao;
  end if;
  return new;
end $$;
create trigger trg_modelo_versao before update on public.documento_modelos
  for each row execute function public.q_modelo_versao();

alter table public.documento_modelos enable row level security;
create policy documento_modelos_equipe_le on public.documento_modelos
  for select to authenticated using ((select public.q_e_equipe()));
create policy documento_modelos_gestor_cria on public.documento_modelos
  for insert to authenticated with check ((select public.q_e_gestor()));
create policy documento_modelos_gestor_altera on public.documento_modelos
  for update to authenticated using ((select public.q_e_gestor())) with check ((select public.q_e_gestor()));
revoke all on public.documento_modelos from anon;


-- ═══ BLOCO 3 · o documento gerado, os eventos e a assinatura ══════════════

alter table public.contrato_documentos
  add column titulo               text,
  add column conteudo             text,
  add column conteudo_hash        text,
  add column modelo_id            uuid references public.documento_modelos(id),
  add column modelo_versao        int,
  add column cancelado_em         timestamptz,
  add column cancelado_por        uuid references public.perfis(id),
  add column motivo_cancelamento  text;
comment on column public.contrato_documentos.conteudo is
  'Texto CONGELADO do documento, já preenchido. Nulo = documento assinado FORA do sistema (link). Com texto, só se assina pelo portal.';
comment on column public.contrato_documentos.conteudo_hash is
  'SHA-256 (hex) do conteudo, calculado pelo banco. É o que prova que o texto assinado é este.';

create index if not exists contrato_documentos_pendentes_idx
  on public.contrato_documentos (contrato_id) where assinado_em is null and cancelado_em is null;

-- Tudo o que acontece com o documento, com IP e navegador. Só inclusão.
create table public.documento_eventos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.contrato_documentos(id) on delete restrict,
  tipo          text not null,
  ator_tipo     text not null check (ator_tipo in ('equipe', 'cliente', 'sistema')),
  ator_id       uuid,
  ip            text,
  user_agent    text,
  detalhes      jsonb,
  created_at    timestamptz not null default now()
);
create index documento_eventos_doc_idx on public.documento_eventos (documento_id, created_at, id);

-- A assinatura: UMA por documento, com a prova.
create table public.documento_assinaturas (
  id                   uuid primary key default gen_random_uuid(),
  documento_id         uuid not null unique references public.contrato_documentos(id) on delete restrict,
  cliente_id           uuid not null references public.clientes(id),
  user_id              uuid not null,
  signatario_nome      text not null,
  signatario_documento text not null,
  nome_digitado        text not null,
  metodo               text not null,
  aceite_texto         text not null,
  hash_sha256          text not null,
  codigo_verificacao   text not null unique,
  ip                   text,
  user_agent           text,
  requisicao           jsonb,
  visualizado_em       timestamptz,
  assinado_em          timestamptz not null default now()
);

alter table public.documento_eventos     enable row level security;
alter table public.documento_assinaturas enable row level security;
-- A equipe LÊ o que é de documento que ela vê (a regra de contrato_documentos
-- vale dentro do `exists`). Ninguém escreve por fora das funções.
create policy documento_eventos_le on public.documento_eventos
  for select to authenticated
  using (exists (select 1 from public.contrato_documentos d where d.id = documento_id));
create policy documento_assinaturas_le on public.documento_assinaturas
  for select to authenticated
  using (exists (select 1 from public.contrato_documentos d where d.id = documento_id));
revoke all on public.documento_eventos, public.documento_assinaturas from anon;
revoke insert, update, delete on public.documento_eventos, public.documento_assinaturas from authenticated;

-- IP e navegador de quem chamou, lidos dos cabeçalhos que o Supabase repassa.
-- ⚠️ É o SERVIDOR que diz, não a tela: IP mandado pelo navegador seria só o
-- que o navegador quisesse mandar.
create or replace function public.q_requisicao()
returns jsonb language plpgsql stable as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  return jsonb_build_object(
    'ip', coalesce(nullif(h ->> 'cf-connecting-ip', ''),
                   nullif(trim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''),
                   nullif(h ->> 'x-real-ip', '')),
    'user_agent', h ->> 'user-agent',
    'x_forwarded_for', h ->> 'x-forwarded-for',
    'cf_connecting_ip', h ->> 'cf-connecting-ip',
    'pais', h ->> 'cf-ipcountry');
end $$;
revoke execute on function public.q_requisicao() from public, anon, authenticated;

create or replace function public.q_documento_evento(
  p_documento uuid, p_tipo text, p_ator_tipo text, p_ator uuid, p_detalhes jsonb default null
)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb := public.q_requisicao();
begin
  insert into public.documento_eventos (documento_id, tipo, ator_tipo, ator_id, ip, user_agent, detalhes)
  values (p_documento, p_tipo, p_ator_tipo, p_ator, r ->> 'ip', r ->> 'user_agent', p_detalhes);
end $$;
revoke execute on function public.q_documento_evento(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Hash no nascimento, e só a geração grava texto.
create or replace function public.q_documento_nasce()
returns trigger language plpgsql as $$
begin
  if new.conteudo is not null then
    if coalesce(current_setting('quadrum.gerando_documento', true), '') <> 'sim' then
      raise exception 'Documento com texto nasce só pela geração a partir de um modelo.' using errcode = '42501';
    end if;
    new.conteudo_hash := encode(extensions.digest(convert_to(new.conteudo, 'UTF8'), 'sha256'), 'hex');
  else
    new.conteudo_hash := null;
  end if;
  if new.assinado_em is not null and new.conteudo is not null then
    raise exception 'Documento do sistema nasce pendente.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_documento_nasce before insert on public.contrato_documentos
  for each row execute function public.q_documento_nasce();

-- O documento do SISTEMA é imutável no que importa, e assinatura não se desfaz.
create or replace function public.q_documento_protege()
returns trigger language plpgsql as $$
declare v_assinatura timestamptz;
begin
  if old.conteudo is not null and (
       new.conteudo is distinct from old.conteudo
    or new.conteudo_hash is distinct from old.conteudo_hash
    or new.titulo is distinct from old.titulo
    or new.tipo is distinct from old.tipo
    or new.contrato_id is distinct from old.contrato_id
    or new.modelo_id is distinct from old.modelo_id
    or new.modelo_versao is distinct from old.modelo_versao) then
    raise exception 'O texto de um documento gerado não muda. Cancele e gere outro.' using errcode = 'P0001';
  end if;
  if old.conteudo is null and new.conteudo is not null then
    raise exception 'Documento de link não ganha texto depois de criado.' using errcode = 'P0001';
  end if;

  if old.cancelado_em is not null and (new.cancelado_em is distinct from old.cancelado_em
                                       or new.assinado_em is distinct from old.assinado_em) then
    raise exception 'Documento cancelado não volta nem é assinado. Gere outro.' using errcode = 'P0001';
  end if;
  if old.assinado_em is not null and new.cancelado_em is not null and old.cancelado_em is null then
    raise exception 'Documento assinado não se cancela.' using errcode = 'P0001';
  end if;

  if old.conteudo is not null and new.assinado_em is distinct from old.assinado_em then
    -- Só a assinatura gravada pelo portal muda isto — e ela não se desfaz.
    select a.assinado_em into v_assinatura from public.documento_assinaturas a where a.documento_id = old.id;
    if v_assinatura is null or new.assinado_em is distinct from v_assinatura or old.assinado_em is not null then
      raise exception 'Documento do sistema só é assinado pelo cliente, no portal — e a assinatura não se desfaz.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_documento_protege before update on public.contrato_documentos
  for each row execute function public.q_documento_protege();

-- O que a EQUIPE faz no documento (cancelar, marcar assinado o de link) vira evento.
create or replace function public.q_documento_registra()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelado_em is not null and old.cancelado_em is null then
    perform public.q_documento_evento(new.id, 'cancelado', 'equipe', auth.uid(),
      jsonb_build_object('motivo', new.motivo_cancelamento));
  end if;
  if new.conteudo is null and new.assinado_em is distinct from old.assinado_em then
    perform public.q_documento_evento(new.id,
      case when new.assinado_em is null then 'assinatura_desmarcada' else 'marcado_assinado' end,
      'equipe', auth.uid(), null);
  end if;
  return new;
end $$;
revoke execute on function public.q_documento_registra() from public, anon, authenticated;
create trigger trg_documento_registra after update on public.contrato_documentos
  for each row execute function public.q_documento_registra();


-- ═══ BLOCO 4 · preencher o modelo ══════════════════════════════════════════

create or replace function public.q_formatar_documento(p text)
returns text language sql immutable as $$
  select case length(p)
    when 11 then substr(p,1,3)||'.'||substr(p,4,3)||'.'||substr(p,7,3)||'-'||substr(p,10,2)
    when 14 then substr(p,1,2)||'.'||substr(p,3,3)||'.'||substr(p,6,3)||'/'||substr(p,9,4)||'-'||substr(p,13,2)
    else p end;
$$;

create or replace function public.q_data_extenso(p date)
returns text language sql immutable as $$
  select extract(day from p)::int || ' de ' ||
    (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
           'setembro','outubro','novembro','dezembro'])[extract(month from p)::int] ||
    ' de ' || extract(year from p)::int;
$$;

-- O CATÁLOGO dos campos: a tela do modelo lista daqui. ⚠️ As chaves são as
-- MESMAS de q_documento_variaveis (o teste confere): campo novo entra nas duas.
create or replace function public.q_documento_catalogo()
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('chave', c, 'rotulo', r, 'grupo', g) order by o)
  from (values
    (1,  'cliente.qualificacao',   'Qualificação completa (nome, documento, RG, endereço…)', 'Cliente'),
    (2,  'cliente.nome',           'Nome / razão social', 'Cliente'),
    (3,  'cliente.documento',      'CPF/CNPJ', 'Cliente'),
    (4,  'cliente.tipo_documento', 'CPF ou CNPJ (a sigla)', 'Cliente'),
    (5,  'cliente.rg',             'RG', 'Cliente'),
    (6,  'cliente.rg_orgao',       'Órgão emissor do RG', 'Cliente'),
    (7,  'cliente.nacionalidade',  'Nacionalidade', 'Cliente'),
    (8,  'cliente.estado_civil',   'Estado civil', 'Cliente'),
    (9,  'cliente.profissao',      'Profissão', 'Cliente'),
    (10, 'cliente.data_nascimento','Data de nascimento', 'Cliente'),
    (11, 'cliente.email',          'E-mail', 'Cliente'),
    (12, 'cliente.telefone',       'Telefone', 'Cliente'),
    (13, 'cliente.endereco',       'Endereço completo', 'Cliente'),
    (14, 'cliente.cidade',         'Cidade', 'Cliente'),
    (15, 'cliente.uf',             'UF', 'Cliente'),
    (16, 'cliente.cep',            'CEP', 'Cliente'),
    (17, 'representante.nome',     'Representante legal (PJ)', 'Cliente'),
    (18, 'representante.cpf',      'CPF do representante (PJ)', 'Cliente'),
    (20, 'contrato.numero',        'Número do contrato', 'Contrato'),
    (21, 'contrato.banco',         'Banco', 'Contrato'),
    (22, 'contrato.linha',         'Linha de crédito', 'Contrato'),
    (23, 'contrato.veiculo',       'Veículo', 'Contrato'),
    (24, 'contrato.ano_modelo',    'Ano/modelo', 'Contrato'),
    (25, 'contrato.placa',         'Placa', 'Contrato'),
    (26, 'contrato.consultor',     'Consultor', 'Contrato'),
    (30, 'data.hoje',              'Data de hoje (15/10/2026)', 'Data'),
    (31, 'data.extenso',           'Data de hoje por extenso (15 de outubro de 2026)', 'Data')
  ) as t(o, c, r, g)
  where public.q_e_equipe();
$$;

-- Os VALORES, para um contrato. Interna: quem chama já conferiu o acesso.
create or replace function public.q_documento_variaveis(p_contrato uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k public.contratos;
  c public.clientes;
  v_banco text; v_linha text; v_consultor text;
  v_endereco text; v_qualif text; v_doc text; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  vazio boolean;
begin
  if p_contrato is not null then
    select * into k from public.contratos where id = p_contrato;
    select * into c from public.clientes where id = k.cliente_id;
    select nome into v_banco from public.bancos where id = k.banco_id;
    select nome into v_linha from public.linhas_credito where id = k.linha_credito_id;
    select nome into v_consultor from public.perfis where id = k.consultor_id;
  end if;

  v_doc := public.q_formatar_documento(c.documento);
  v_endereco := nullif(concat_ws(', ',
      nullif(trim(coalesce(c.logradouro, '') || coalesce(' ' || nullif(c.endereco_numero, ''), '')), ''),
      nullif(c.complemento, ''),
      nullif(c.bairro, ''),
      nullif(concat_ws('/', nullif(c.cidade, ''), nullif(c.uf, '')), ''),
      case when nullif(c.cep, '') is not null then 'CEP ' || c.cep end), '');

  -- A qualificação só sai INTEIRA: faltando uma parte, ela fica nula e a
  -- geração diz o que falta (em vez de sair "portador do RG nº , residente em").
  if c.id is not null and c.tipo_pessoa = 'PJ' then
    vazio := coalesce(c.nome, '') = '' or v_endereco is null
          or coalesce(c.representante_nome, '') = '' or coalesce(c.representante_documento, '') = '';
    v_qualif := case when not vazio then
      c.nome || ', pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ' || v_doc ||
      ', com sede em ' || v_endereco || ', neste ato representada por ' || c.representante_nome ||
      ', inscrito(a) no CPF sob o nº ' || public.q_formatar_documento(c.representante_documento) end;
  elsif c.id is not null then
    vazio := coalesce(c.nome, '') = '' or coalesce(c.nacionalidade, '') = '' or coalesce(c.estado_civil, '') = ''
          or coalesce(c.profissao, '') = '' or coalesce(c.rg, '') = '' or v_endereco is null;
    v_qualif := case when not vazio then
      c.nome || ', ' || c.nacionalidade || ', ' || c.estado_civil || ', ' || c.profissao ||
      ', portador(a) do RG nº ' || c.rg || coalesce(' ' || nullif(c.rg_orgao, ''), '') ||
      ', inscrito(a) no CPF sob o nº ' || v_doc || ', residente e domiciliado(a) em ' || v_endereco end;
  end if;

  return jsonb_build_object(
    'cliente.qualificacao',    v_qualif,
    'cliente.nome',            c.nome,
    'cliente.documento',       v_doc,
    'cliente.tipo_documento',  case c.tipo_pessoa when 'PJ' then 'CNPJ' when 'PF' then 'CPF' end,
    'cliente.rg',              c.rg,
    'cliente.rg_orgao',        c.rg_orgao,
    'cliente.nacionalidade',   c.nacionalidade,
    'cliente.estado_civil',    c.estado_civil,
    'cliente.profissao',       c.profissao,
    'cliente.data_nascimento', to_char(c.data_nascimento, 'DD/MM/YYYY'),
    'cliente.email',           c.email,
    'cliente.telefone',        c.telefone,
    'cliente.endereco',        v_endereco,
    'cliente.cidade',          c.cidade,
    'cliente.uf',              c.uf,
    'cliente.cep',             c.cep,
    'representante.nome',      c.representante_nome,
    'representante.cpf',       public.q_formatar_documento(c.representante_documento),
    'contrato.numero',         k.numero::text,
    'contrato.banco',          v_banco,
    'contrato.linha',          v_linha,
    'contrato.veiculo',        k.veiculo,
    'contrato.ano_modelo',     k.ano_modelo,
    'contrato.placa',          k.placa,
    'contrato.consultor',      v_consultor,
    'data.hoje',               to_char(v_hoje, 'DD/MM/YYYY'),
    'data.extenso',            public.q_data_extenso(v_hoje)
  );
end $$;
revoke execute on function public.q_documento_variaveis(uuid) from public, anon, authenticated;

-- Troca {{chave}} pelos valores. Devolve o texto, o que FALTA (chave sem
-- valor) e o que NÃO EXISTE (chave que o catálogo não conhece — erro de
-- digitação no modelo). Na prévia, o que falta aparece como [rótulo].
create or replace function public.q_documento_montar(p_corpo text, p_vars jsonb, p_marcar_falta boolean)
returns jsonb language plpgsql stable as $$
declare
  v_texto  text := coalesce(p_corpo, '');
  v_cat    jsonb := (select jsonb_object_agg(x ->> 'chave', x ->> 'rotulo')
                     from jsonb_array_elements(coalesce(public.q_documento_catalogo(), '[]'::jsonb)) x);
  m        text[];
  v_chave  text;
  v_valor  text;
  v_falta  jsonb := '[]'::jsonb;
  v_desc   jsonb := '[]'::jsonb;
  v_padrao text;
begin
  for m in select regexp_matches(coalesce(p_corpo, ''), '\{\{\s*([A-Za-z_.]+)\s*\}\}', 'g') loop
    v_chave := lower(m[1]);
    v_padrao := '\{\{\s*' || replace(v_chave, '.', '\.') || '\s*\}\}';
    if not (p_vars ? v_chave) then
      if not v_desc @> to_jsonb(v_chave) then v_desc := v_desc || to_jsonb(v_chave); end if;
      continue;
    end if;
    v_valor := nullif(trim(p_vars ->> v_chave), '');
    if v_valor is null then
      if not v_falta @> jsonb_build_array(jsonb_build_object('chave', v_chave, 'rotulo', v_cat ->> v_chave)) then
        v_falta := v_falta || jsonb_build_array(jsonb_build_object('chave', v_chave, 'rotulo', v_cat ->> v_chave));
      end if;
      if p_marcar_falta then
        v_texto := regexp_replace(v_texto, v_padrao, '[' || replace(coalesce(v_cat ->> v_chave, v_chave), '\', '\\') || ']', 'gi');
      end if;
    else
      v_texto := regexp_replace(v_texto, v_padrao, replace(v_valor, '\', '\\'), 'gi');
    end if;
  end loop;
  return jsonb_build_object('texto', v_texto, 'faltando', v_falta, 'desconhecidas', v_desc);
end $$;
revoke execute on function public.q_documento_montar(text, jsonb, boolean) from public, anon, authenticated;

-- A PRÉVIA da tela: o texto preenchido com um contrato (ou sem, mostrando os
-- campos como [rótulo]). Não grava nada.
create or replace function public.q_documento_previa(p_corpo text, p_contrato uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.q_e_equipe() then
    raise exception 'Só a equipe.' using errcode = '42501';
  end if;
  if p_contrato is not null and not public.q_ve_contrato(p_contrato) then
    raise exception 'Sem permissão para este contrato.' using errcode = '42501';
  end if;
  return public.q_documento_montar(p_corpo, public.q_documento_variaveis(p_contrato), true);
end $$;

-- GERAR: preenche, congela e manda para o portal do cliente.
create or replace function public.q_documento_gerar(p_contrato uuid, p_modelo uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_mod  public.documento_modelos;
  v_res  jsonb;
  v_id   uuid;
begin
  if not public.q_e_equipe() or not public.q_ve_contrato(p_contrato) then
    raise exception 'Sem permissão para este contrato.' using errcode = '42501';
  end if;
  if exists (select 1 from public.contratos where id = p_contrato and cancelado_em is not null) then
    raise exception 'Contrato perdido não recebe documento.' using errcode = 'P0001';
  end if;
  select * into v_mod from public.documento_modelos where id = p_modelo;
  if v_mod.id is null or not v_mod.ativo then
    raise exception 'Modelo não encontrado ou inativo.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contrato_documentos
             where contrato_id = p_contrato and tipo = v_mod.tipo
               and assinado_em is null and cancelado_em is null) then
    raise exception 'Já existe um documento deste tipo pendente neste contrato. Cancele o anterior para gerar outro.' using errcode = 'P0001';
  end if;

  v_res := public.q_documento_montar(v_mod.corpo, public.q_documento_variaveis(p_contrato), false);
  if jsonb_array_length(v_res -> 'desconhecidas') > 0 then
    raise exception 'O modelo usa campos que não existem: %. Corrija o modelo.',
      (select string_agg('{{' || x || '}}', ', ') from jsonb_array_elements_text(v_res -> 'desconhecidas') x)
      using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_res -> 'faltando') > 0 then
    raise exception 'Faltam dados para gerar o documento: %. Complete o cadastro do cliente/contrato.',
      (select string_agg(coalesce(x ->> 'rotulo', x ->> 'chave'), ', ') from jsonb_array_elements(v_res -> 'faltando') x)
      using errcode = 'P0001';
  end if;

  perform set_config('quadrum.gerando_documento', 'sim', true);
  insert into public.contrato_documentos (contrato_id, tipo, titulo, conteudo, modelo_id, modelo_versao)
  values (p_contrato, v_mod.tipo, v_mod.nome, v_res ->> 'texto', v_mod.id, v_mod.versao)
  returning id into v_id;
  perform set_config('quadrum.gerando_documento', '', true);

  perform public.q_documento_evento(v_id, 'gerado', 'equipe', auth.uid(),
    jsonb_build_object('modelo', v_mod.nome, 'versao', v_mod.versao));
  return v_id;
end $$;

revoke execute on function public.q_documento_catalogo() from public, anon;
revoke execute on function public.q_documento_previa(text, uuid) from public, anon;
revoke execute on function public.q_documento_gerar(uuid, uuid) from public, anon;
grant execute on function public.q_documento_catalogo() to authenticated, service_role;
grant execute on function public.q_documento_previa(text, uuid) to authenticated, service_role;
grant execute on function public.q_documento_gerar(uuid, uuid) to authenticated, service_role;
grant execute on function public.q_formatar_documento(text) to authenticated, service_role;


-- ═══ BLOCO 5 · o cliente lê e assina, no portal ════════════════════════════

-- O texto do aceite — gravado junto da assinatura, palavra por palavra.
create or replace function public.q_texto_aceite()
returns text language sql immutable as $$
  select 'Declaro que li e concordo integralmente com o conteúdo deste documento e que o assino '
      || 'eletronicamente, reconhecendo esta assinatura como válida e equivalente à minha assinatura '
      || 'manuscrita, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.';
$$;
grant execute on function public.q_texto_aceite() to authenticated, service_role;

-- O documento, para o DONO dele. Cada abertura vira evento ("visualizado").
create or replace function public.portal_documento(p_documento uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid := public.q_cliente_da_sessao();
  d record;
begin
  if v_cliente is null then
    raise exception 'Sessão de cliente não encontrada.' using errcode = '42501';
  end if;
  select cd.*, t.nome as tipo_nome, k.numero as contrato_numero, c.nome as cliente_nome,
         c.tipo_pessoa, c.representante_nome
    into d
  from public.contrato_documentos cd
  join public.contratos k on k.id = cd.contrato_id
  join public.clientes c on c.id = k.cliente_id
  join public.documento_tipos t on t.codigo = cd.tipo
  where cd.id = p_documento and k.cliente_id = v_cliente and k.data_aceite is not null;
  if d.id is null then
    raise exception 'Documento não encontrado.' using errcode = 'P0001';
  end if;

  if d.conteudo is not null then
    perform public.q_documento_evento(d.id, 'visualizado', 'cliente', auth.uid(), null);
  end if;

  return jsonb_build_object(
    'id', d.id,
    'titulo', coalesce(d.titulo, d.tipo_nome),
    'tipo', d.tipo_nome,
    'contrato_numero', d.contrato_numero,
    'no_sistema', d.conteudo is not null,
    'link', d.link_assinatura,
    'conteudo', d.conteudo,
    'conteudo_hash', d.conteudo_hash,
    'criado_em', d.created_at,
    'cancelado', d.cancelado_em is not null,
    'assinado_em', d.assinado_em,
    'cliente_nome', d.cliente_nome,
    'pj', d.tipo_pessoa = 'PJ',
    'representante_nome', d.representante_nome,
    'aceite_texto', public.q_texto_aceite(),
    'assinatura', (
      select jsonb_build_object(
        'nome', a.signatario_nome, 'documento', a.signatario_documento, 'nome_digitado', a.nome_digitado,
        'assinado_em', a.assinado_em, 'ip', a.ip, 'user_agent', a.user_agent, 'metodo', a.metodo,
        'hash', a.hash_sha256, 'codigo', a.codigo_verificacao, 'aceite_texto', a.aceite_texto,
        'visualizado_em', a.visualizado_em)
      from public.documento_assinaturas a where a.documento_id = d.id)
  );
end $$;

-- ASSINAR. Confirma a SENHA do portal (prova de que é o titular, não só a aba
-- aberta), confere o nome digitado e o aceite, e grava a prova.
-- ⚠️ Senha errada DEVOLVE {ok:false} em vez de erro: um erro desfaria o
-- registro da tentativa, e o limite de tentativas nunca contaria.
create or replace function public.portal_assinar_documento(
  p_documento uuid, p_senha text, p_nome text, p_aceite boolean
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cliente uuid := public.q_cliente_da_sessao();
  d         record;
  v_ok      boolean;
  v_hash    text;
  v_req     jsonb := public.q_requisicao();
  v_codigo  text;
  v_quando  timestamptz := now();
  v_nome    text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_visto   timestamptz;
begin
  if v_cliente is null then
    raise exception 'Sessão de cliente não encontrada.' using errcode = '42501';
  end if;

  select cd.*, c.nome as cliente_nome, c.documento as cliente_documento, c.tipo_pessoa, c.representante_nome
    into d
  from public.contrato_documentos cd
  join public.contratos k on k.id = cd.contrato_id
  join public.clientes c on c.id = k.cliente_id
  where cd.id = p_documento and k.cliente_id = v_cliente and k.data_aceite is not null
  for update of cd;
  if d.id is null then
    raise exception 'Documento não encontrado.' using errcode = 'P0001';
  end if;
  if d.conteudo is null then
    raise exception 'Este documento é assinado fora do portal.' using errcode = 'P0001';
  end if;
  if d.cancelado_em is not null then
    raise exception 'Este documento foi cancelado.' using errcode = 'P0001';
  end if;
  if d.assinado_em is not null then
    raise exception 'Este documento já foi assinado.' using errcode = 'P0001';
  end if;
  if not coalesce(p_aceite, false) then
    raise exception 'Marque que leu e concorda com o documento.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.documento_eventos
      where documento_id = d.id and tipo = 'senha_incorreta'
        and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas com a senha errada. Aguarde 15 minutos e tente de novo.');
  end if;

  select u.encrypted_password = extensions.crypt(coalesce(p_senha, ''), u.encrypted_password)
    into v_ok from auth.users u where u.id = auth.uid();
  if not coalesce(v_ok, false) then
    perform public.q_documento_evento(d.id, 'senha_incorreta', 'cliente', auth.uid(), null);
    return jsonb_build_object('ok', false, 'erro', 'Senha incorreta.');
  end if;

  -- O nome digitado tem de ser o do cadastro (sem diferença de acento ou
  -- maiúscula). Pessoa jurídica: a razão social ou o representante.
  if public.q_busca(v_nome) <> public.q_busca(regexp_replace(trim(d.cliente_nome), '\s+', ' ', 'g'))
     and (d.tipo_pessoa <> 'PJ' or d.representante_nome is null
          or public.q_busca(v_nome) <> public.q_busca(regexp_replace(trim(d.representante_nome), '\s+', ' ', 'g'))) then
    raise exception 'Digite o nome completo exatamente como no seu cadastro.' using errcode = 'P0001';
  end if;

  -- Integridade: o texto ainda é o que foi gerado.
  v_hash := encode(extensions.digest(convert_to(d.conteudo, 'UTF8'), 'sha256'), 'hex');
  if v_hash <> d.conteudo_hash then
    raise exception 'O documento não confere com o original. Fale com o seu consultor.' using errcode = 'P0001';
  end if;

  select min(created_at) into v_visto from public.documento_eventos
   where documento_id = d.id and tipo = 'visualizado';

  loop
    v_codigo := upper(encode(extensions.gen_random_bytes(6), 'hex'));
    v_codigo := substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4) || '-' || substr(v_codigo, 9, 4);
    exit when not exists (select 1 from public.documento_assinaturas where codigo_verificacao = v_codigo);
  end loop;

  insert into public.documento_assinaturas (
    documento_id, cliente_id, user_id, signatario_nome, signatario_documento, nome_digitado,
    metodo, aceite_texto, hash_sha256, codigo_verificacao, ip, user_agent, requisicao,
    visualizado_em, assinado_em)
  values (
    d.id, v_cliente, auth.uid(), d.cliente_nome, d.cliente_documento, v_nome,
    'Login no Portal do Cliente (CPF/CNPJ + senha) e confirmação da senha no ato da assinatura',
    public.q_texto_aceite(), v_hash, v_codigo, v_req ->> 'ip', v_req ->> 'user_agent', v_req,
    v_visto, v_quando);

  update public.contrato_documentos set assinado_em = v_quando where id = d.id;
  perform public.q_documento_evento(d.id, 'assinado', 'cliente', auth.uid(),
    jsonb_build_object('hash', v_hash, 'codigo', v_codigo));

  return jsonb_build_object('ok', true, 'documento', public.portal_documento(d.id));
end $$;

-- Meus Contratos ganha: a pendência diz se assina NO PORTAL, e os documentos
-- já ASSINADOS ficam disponíveis para consulta e impressão. Cancelado some.
create or replace function public.portal_contratos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id,
    'numero', k.numero,
    'data_aceite', k.data_aceite,
    'banco', b.nome,
    'linha', l.nome,
    'veiculo', k.veiculo,
    'ano_modelo', k.ano_modelo,
    'placa', k.placa,
    'consultor', p.nome,
    'unidade', coalesce(nullif(concat_ws(', ', u.cidade, u.uf), ''), u.nome),
    'cancelado', k.cancelado_em is not null,
    'historico', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', h.id, 'texto', h.texto, 'autor', ap.nome, 'created_at', h.created_at)
             order by h.created_at desc, h.id desc), '[]'::jsonb)
      from public.contrato_historico h
      left join public.departamentos d on d.id = h.departamento_id
      left join public.perfis ap on ap.id = h.autor_id
      where h.contrato_id = k.id and not coalesce(d.urgente, false)
    ),
    'urgente_nao_lido', exists (
      select 1 from public.contrato_historico h
      join public.departamentos d on d.id = h.departamento_id
      where h.contrato_id = k.id and d.urgente and h.lido_pelo_cliente_em is null
    ),
    'pendencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', cd.id, 'tipo', cd.tipo, 'nome', coalesce(cd.titulo, t.nome), 'link', cd.link_assinatura,
               'no_sistema', cd.conteudo is not null)
             order by t.ordem, cd.created_at), '[]'::jsonb)
      from public.contrato_documentos cd
      join public.documento_tipos t on t.codigo = cd.tipo
      where cd.contrato_id = k.id and cd.assinado_em is null and cd.cancelado_em is null
    ),
    'documentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', cd.id, 'nome', coalesce(cd.titulo, t.nome), 'assinado_em', cd.assinado_em,
               'no_sistema', cd.conteudo is not null)
             order by cd.assinado_em desc), '[]'::jsonb)
      from public.contrato_documentos cd
      join public.documento_tipos t on t.codigo = cd.tipo
      where cd.contrato_id = k.id and cd.assinado_em is not null
    ),
    'atendimentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'numero', a.numero, 'titulo', a.titulo, 'arquivado', a.arquivado_em is not null)
             order by a.created_at desc), '[]'::jsonb)
      from public.atendimentos a
      where a.contrato_id = k.id
    )
  ) order by k.numero desc), '[]'::jsonb)
  from public.contratos k
  left join public.bancos b on b.id = k.banco_id
  left join public.linhas_credito l on l.id = k.linha_credito_id
  left join public.perfis p on p.id = k.consultor_id
  left join public.unidades u on u.id = k.unidade_id
  where k.cliente_id = public.q_cliente_da_sessao()
    and k.data_aceite is not null;
$$;

revoke execute on function public.portal_documento(uuid) from public, anon;
revoke execute on function public.portal_assinar_documento(uuid, text, text, boolean) from public, anon;
grant execute on function public.portal_documento(uuid) to authenticated, service_role;
grant execute on function public.portal_assinar_documento(uuid, text, text, boolean) to authenticated, service_role;


-- ═══ BLOCO 6 · as listas e o painel do admin ═══════════════════════════════

create or replace view public.documentos_lista with (security_invoker = true) as
select
  d.id, d.contrato_id, d.tipo, t.nome as tipo_nome, coalesce(d.titulo, t.nome) as titulo,
  d.link_assinatura, d.assinado_em, d.cancelado_em, d.created_at,
  d.conteudo is not null as no_sistema,
  k.numero as contrato_numero, k.data_aceite as contrato_aceite,
  c.nome as cliente_nome, c.documento as cliente_documento,
  case when d.cancelado_em is not null then 'cancelado'
       when d.assinado_em is not null then 'assinado'
       else 'pendente' end as situacao,
  concat_ws(' ', c.busca, public.q_busca(coalesce(d.titulo, t.nome)), '#' || k.numero) as busca
from public.contrato_documentos d
join public.documento_tipos t on t.codigo = d.tipo
left join public.contratos k on k.id = d.contrato_id
left join public.clientes c on c.id = k.cliente_id;
revoke all on public.documentos_lista from anon;
grant select on public.documentos_lista to authenticated;

create or replace function public.q_documentos_pagina(
  p_busca text default '', p_situacao text default 'pendente', p_pagina int default 1, p_por int default 20
)
returns jsonb language sql stable as $$
  with base as materialized (
    select l.* from public.documentos_lista l where public.q_casa_busca(l.busca, p_busca)
  ),
  tam as (select least(greatest(coalesce(p_por, 20), 1), 100) as por,
                 greatest(coalesce(p_pagina, 1), 1) as pagina)
  select jsonb_build_object(
    'contagem', (select jsonb_build_object(
        'todos',     count(*),
        'pendente',  count(*) filter (where situacao = 'pendente'),
        'assinado',  count(*) filter (where situacao = 'assinado'),
        'cancelado', count(*) filter (where situacao = 'cancelado'))
      from base),
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(x) - 'busca' order by x.created_at desc, x.id)
      from (
        select b.* from base b
        where coalesce(p_situacao, 'todos') = 'todos' or b.situacao = p_situacao
        order by b.created_at desc, b.id
        limit (select por from tam) offset (select (pagina - 1) * por from tam)
      ) x), '[]'::jsonb)
  );
$$;

-- O PAINEL: os números e as listas curtas, contados no banco (a RLS recorta).
create or replace function public.q_painel(p_parado_dias int default 7)
returns jsonb language sql stable as $$
  with k as materialized (
    select id, numero, etapa_id, etapa_desde, data_aceite, cancelado_em,
           cliente_nome, consultor_nome, etapa_nome
    from public.contratos_lista
  ),
  cx as materialized (
    select id, cliente_nome, setor_nome, titulo, ultima_corpo, nao_lidas, arquivado_em, ordem_em
    from public.atendimentos_caixa
  )
  select jsonb_build_object(
    'andamento', (select count(*) from k where cancelado_em is null and data_aceite is null),
    'portal',    (select count(*) from k where cancelado_em is null and data_aceite is not null),
    'perdidos',  (select count(*) from k where cancelado_em is not null),
    'por_etapa', (select coalesce(jsonb_object_agg(etapa_id, n), '{}'::jsonb)
                  from (select etapa_id, count(*) n from k where cancelado_em is null group by etapa_id) e),
    'parados_total', (select count(*) from k where cancelado_em is null
                      and etapa_desde < now() - make_interval(days => p_parado_dias)),
    'parados', (select coalesce(jsonb_agg(to_jsonb(x) order by x.etapa_desde), '[]'::jsonb) from (
                  select id, numero, etapa_desde, cliente_nome, consultor_nome, etapa_nome from k
                  where cancelado_em is null and etapa_desde < now() - make_interval(days => p_parado_dias)
                  order by etapa_desde limit 8) x),
    'atendimentos_abertos', (select count(*) from cx where arquivado_em is null),
    'atendimentos_nao_lidos', (select count(*) from cx where arquivado_em is null and nao_lidas > 0),
    'esperando', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem_em desc), '[]'::jsonb) from (
                  select id, cliente_nome, setor_nome, titulo, ultima_corpo, nao_lidas, ordem_em from cx
                  where arquivado_em is null and nao_lidas > 0 order by ordem_em desc limit 6) x),
    'assinaturas_pendentes', (select count(*) from public.contrato_documentos
                              where assinado_em is null and cancelado_em is null)
  );
$$;

revoke execute on function public.q_documentos_pagina(text, text, int, int) from public, anon;
revoke execute on function public.q_painel(int) from public, anon;
grant execute on function public.q_documentos_pagina(text, text, int, int) to authenticated, service_role;
grant execute on function public.q_painel(int) to authenticated, service_role;


-- ═══ BLOCO 7 · modelos de PARTIDA (inativos) ═══════════════════════════════
-- Ponto de partida para o jurídico revisar. Nascem INATIVOS: nenhum texto
-- chega ao cliente antes de alguém ler, ajustar e ativar na tela de Modelos.

insert into public.documento_modelos (tipo, nome, ativo, corpo) values
('procuracao', 'Procuração', false,
'# PROCURAÇÃO

**OUTORGANTE:** {{cliente.qualificacao}}.

**OUTORGADA:** QUADRUM ASSESSORIA FINANCEIRA, [CNPJ e endereço da Quadrum].

**PODERES:** representar o(a) OUTORGANTE perante {{contrato.banco}}, em relação ao contrato de {{contrato.linha}}, podendo solicitar informações, extratos e cálculos, apresentar propostas e negociar condições de pagamento, [completar conforme o jurídico].

O(A) OUTORGANTE concorda que este instrumento seja assinado eletronicamente, por meio do Portal do Cliente da Quadrum, reconhecendo a validade dessa assinatura nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

Natal/RN, {{data.extenso}}.

{{cliente.nome}}
{{cliente.tipo_documento}}: {{cliente.documento}}'),
('contrato', 'Contrato de prestação de serviços', false,
'# CONTRATO DE PRESTAÇÃO DE SERVIÇOS Nº {{contrato.numero}}

**CONTRATANTE:** {{cliente.qualificacao}}.

**CONTRATADA:** QUADRUM ASSESSORIA FINANCEIRA, [CNPJ e endereço da Quadrum].

**CLÁUSULA 1ª – DO OBJETO.** Assessoria na negociação do contrato de {{contrato.linha}} junto a {{contrato.banco}}, [completar].

**CLÁUSULA 2ª – DOS HONORÁRIOS.** [completar conforme o jurídico].

**CLÁUSULA 3ª – DA ASSINATURA ELETRÔNICA.** As partes concordam que este contrato seja assinado eletronicamente, por meio do Portal do Cliente da Quadrum, e reconhecem a validade dessa assinatura nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

Natal/RN, {{data.extenso}}.

{{cliente.nome}}
{{cliente.tipo_documento}}: {{cliente.documento}}'),
('termo', 'Termo de ciência', false,
'# TERMO DE CIÊNCIA

Eu, {{cliente.qualificacao}}, declaro estar ciente de que [completar conforme o jurídico], referente ao contrato nº {{contrato.numero}}.

Concordo com a assinatura eletrônica deste termo por meio do Portal do Cliente da Quadrum, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

Natal/RN, {{data.extenso}}.

{{cliente.nome}}'),
('declaracao', 'Declaração', false,
'# DECLARAÇÃO

Eu, {{cliente.qualificacao}}, DECLARO, para os devidos fins, que [completar conforme o jurídico].

Concordo com a assinatura eletrônica desta declaração por meio do Portal do Cliente da Quadrum, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

Natal/RN, {{data.extenso}}.

{{cliente.nome}}');
