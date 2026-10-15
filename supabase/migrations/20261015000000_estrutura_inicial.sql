-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · estrutura inicial do back-office (admin)
--
-- Fonte: docs/mapeamento-portal-cliente.md, seção "O que o CRM interno precisa
-- ter". O admin vem PRIMEIRO porque tudo o que o Portal do Cliente mostra nasce
-- aqui: contrato, histórico, atendimento, documento a assinar.
--
-- Rode no Supabase → SQL Editor, num projeto NOVO e vazio. É idempotente só
-- nas funções e políticas; as tabelas usam `create table` puro de propósito:
-- rodar duas vezes deve FALHAR alto, não "passar" sobre um banco que já tem
-- dado.
--
-- Decisões que custam caro desfazer:
--   1. Listas de negócio são CADASTRO (tabela), nunca CHECK: setor, linha de
--      crédito, banco, tipo de documento. Item novo = INSERT, sem deploy.
--   2. Nada se apaga — desativa (`ativo = false`). Contrato, cliente e histórico
--      não têm policy de DELETE: o portal aponta para eles.
--   3. Uma informação mora num lugar só: "cancelado?" é `cancelado_em is not
--      null`, não um booleano ao lado de uma data que pode discordar dele.
--   4. A regra mora no BANCO, não na tela: um atendimento ativo por cliente,
--      atendimento arquivado não recebe mensagem, mensagem não se reescreve.
--   5. Cliente do portal NÃO lê nada ainda. As políticas dele entram junto com
--      o portal, por funções próprias — ausência fecha.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. Defaults seguros ───────────────────────────────────────────────────
-- No Supabase, função nova nasce executável por `anon` (a chave pública do
-- JavaScript) e tabela nova nasce com GRANT para `anon`. Em projeto novo isso
-- se corta na raiz: o que precisar de `anon` (formulário público, login por
-- documento) recebe GRANT explícito, um a um.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;


-- ─── 1. Equipe e cadastros de apoio ────────────────────────────────────────

create table public.unidades (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cidade      text,
  uf          char(2),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.unidades is
  'Unidades/parceiros. No portal aparece como "Unidade (cidade, UF)" no contrato.';

-- Quem trabalha na Quadrum. O login é o MESMO Supabase Auth do portal do
-- cliente: estar autenticado NÃO é ser da equipe — é ter linha aqui, ativa.
create table public.equipe (
  id          uuid primary key references auth.users(id) on delete restrict,
  nome        text not null,
  email       text,
  telefone    text,
  papel       text not null default 'membro' check (papel in ('gestor', 'membro')),
  unidade_id  uuid references public.unidades(id),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.equipe.ativo is
  'Desativar tira o acesso SEM apagar: contratos, históricos e mensagens continuam apontando para a pessoa. `on delete restrict` no auth.users é o cinto disso.';

create table public.bancos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  codigo      text,                      -- código COMPE, quando houver
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.linhas_credito (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null unique,
  tem_veiculo  boolean not null default false,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column public.linhas_credito.tem_veiculo is
  'Quando true, o contrato desta linha pede veículo, ano e placa. Responde no cadastro a pendência "veículo é o único bem?": linha nova sem veículo é um INSERT.';

-- Departamentos (quem lança histórico) e setores (quem recebe atendimento)
-- são a MESMA lista, com duas marcas. No sistema antigo, "departamentos 4 e 9"
-- eram os urgentes, escritos no código — aqui é a coluna `urgente`.
create table public.departamentos (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null unique,
  atende_chat  boolean not null default false,
  urgente      boolean not null default false,
  ordem        int not null default 0,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column public.departamentos.atende_chat is
  'Aparece como "setor" no robô do chat do portal (Acordo, Cobrança, Monitoramento, Ouvidoria).';
comment on column public.departamentos.urgente is
  'Histórico deste departamento NÃO aparece na lista do cliente: só dispara o aviso "você tem uma mensagem urgente" até ser lido.';

create table public.documento_tipos (
  codigo      text primary key,
  nome        text not null,
  modelo_pf   text,   -- referência do modelo no sistema de assinatura, pessoa física
  modelo_pj   text,   -- idem, pessoa jurídica (nulo = o mesmo da PF)
  ordem       int not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ─── 2. Carteira: clientes e contratos ─────────────────────────────────────

create table public.clientes (
  id            uuid primary key default gen_random_uuid(),
  -- SÓ DÍGITOS. Comparar documento formatado ("123.456.789-00" contra
  -- "12345678900") deixa a linha de fora sem erro nenhum; o CHECK impede que
  -- a forma formatada chegue a existir.
  documento     text not null unique check (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  tipo_pessoa   text generated always as (case when length(documento) = 14 then 'PJ' else 'PF' end) stored,
  nome          text not null,
  email         text,
  telefone      text,
  consultor_id  uuid references public.equipe(id),
  unidade_id    uuid references public.unidades(id),
  -- Acesso ao Portal do Cliente: a conta no Auth que a equipe gera/redefine.
  -- Nulo = o cliente ainda não tem senha do portal.
  user_id       uuid unique references auth.users(id) on delete set null,
  observacoes   text,
  created_by    uuid references public.equipe(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index clientes_nome_idx on public.clientes (lower(nome));

create table public.contratos (
  id                   uuid primary key default gen_random_uuid(),
  -- O que o cliente lê: "CONTRATO #123". O uuid é a identidade; o número é
  -- só apresentação.
  numero               bigint generated always as identity unique,
  cliente_id           uuid not null references public.clientes(id) on delete restrict,
  -- Nulo = ainda não aceito. O portal mostra só contrato ACEITO ("não foi
  -- possível localizar contratos aceitos para seu CPF").
  data_aceite          date,
  banco_id             uuid references public.bancos(id),
  linha_credito_id     uuid references public.linhas_credito(id),
  veiculo              text,
  ano_modelo           text,
  placa                text,
  consultor_id         uuid references public.equipe(id),
  unidade_id           uuid references public.unidades(id),
  cancelado_em         timestamptz,
  cancelado_por        uuid references public.equipe(id),
  motivo_cancelamento  text,
  observacoes          text,
  created_by           uuid references public.equipe(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index contratos_cliente_idx on public.contratos (cliente_id);
comment on column public.contratos.cancelado_em is
  'Cancelado = esta coluna preenchida. Não existe booleano "cancelado" ao lado, para não haver dois lugares dizendo coisas diferentes.';

-- Linha do tempo de ocorrências que a equipe lança e o cliente lê na aba
-- Histórico. Texto livre, quebras de linha preservadas.
create table public.contrato_historico (
  id                    uuid primary key default gen_random_uuid(),
  contrato_id           uuid not null references public.contratos(id) on delete restrict,
  departamento_id       uuid references public.departamentos(id),
  texto                 text not null check (length(trim(texto)) > 0),
  autor_id              uuid references public.equipe(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  lido_pelo_cliente_em  timestamptz
);
create index contrato_historico_contrato_idx on public.contrato_historico (contrato_id, created_at desc, id desc);

create table public.contrato_documentos (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid not null references public.contratos(id) on delete restrict,
  tipo             text not null references public.documento_tipos(codigo),
  link_assinatura  text,
  assinado_em      timestamptz,
  solicitado_por   uuid references public.equipe(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contrato_documentos_contrato_idx on public.contrato_documentos (contrato_id);
comment on table public.contrato_documentos is
  'Pendências de assinatura do contrato ("Pendências contrato #123" no portal). Pendente = assinado_em nulo.';


-- ─── 3. Atendimento (o chat do portal) ─────────────────────────────────────

create table public.atendimentos (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity unique,
  cliente_id      uuid not null references public.clientes(id) on delete restrict,
  contrato_id     uuid references public.contratos(id),
  setor_id        uuid not null references public.departamentos(id),
  titulo          text not null,
  responsavel_id  uuid references public.equipe(id),
  arquivado_em    timestamptz,
  arquivado_por   uuid references public.equipe(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- "O cliente tem no máximo um chat ativo por vez" — regra do portal antigo,
-- que lá morava só na tela. Aqui o banco recusa o segundo.
create unique index atendimentos_um_ativo_por_cliente
  on public.atendimentos (cliente_id) where arquivado_em is null;
create index atendimentos_setor_idx on public.atendimentos (setor_id, arquivado_em);

create table public.atendimento_mensagens (
  id              uuid primary key default gen_random_uuid(),
  atendimento_id  uuid not null references public.atendimentos(id) on delete restrict,
  autor_tipo      text not null check (autor_tipo in ('cliente', 'equipe', 'robo')),
  -- equipe.id quando 'equipe', clientes.id quando 'cliente', nulo no robô.
  autor_id        uuid,
  corpo           text not null check (length(trim(corpo)) > 0),
  created_at      timestamptz not null default now(),
  -- Lida pelo OUTRO lado: mensagem da equipe, lida pelo cliente; e vice-versa.
  lida_em         timestamptz,
  constraint mensagem_tem_autor check (autor_tipo = 'robo' or autor_id is not null)
);
-- Ordem ESTÁVEL: duas mensagens no mesmo instante não podem trocar de lugar
-- nem cair fora de uma janela paginada.
create index atendimento_mensagens_ordem_idx
  on public.atendimento_mensagens (atendimento_id, created_at, id);


-- ─── 4. Funções de apoio ───────────────────────────────────────────────────

create or replace function public.q_tocar_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'unidades','equipe','bancos','linhas_credito','departamentos',
    'documento_tipos','clientes','contratos','contrato_documentos','atendimentos'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.q_tocar_updated_at()', t);
  end loop;
end $$;

-- Quem é da equipe / quem é gestor. SECURITY DEFINER para a política de
-- `equipe` poder perguntar à própria `equipe` sem recursão de RLS.
create or replace function public.q_e_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where id = auth.uid() and ativo);
$$;

create or replace function public.q_e_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe where id = auth.uid() and ativo and papel = 'gestor');
$$;

revoke execute on function public.q_e_equipe() from public, anon;
revoke execute on function public.q_e_gestor() from public, anon;
grant execute on function public.q_e_equipe() to authenticated, service_role;
grant execute on function public.q_e_gestor() to authenticated, service_role;

-- Atendimento arquivado é SÓ LEITURA, para os dois lados. Regra no banco:
-- a tela do admin e a do portal não têm como esquecê-la.
create or replace function public.q_mensagem_atendimento_aberto()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.atendimentos a
             where a.id = new.atendimento_id and a.arquivado_em is not null) then
    raise exception 'Atendimento arquivado não recebe mensagem.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_mensagem_atendimento_aberto
  before insert on public.atendimento_mensagens
  for each row execute function public.q_mensagem_atendimento_aberto();


-- ─── 5. RLS ────────────────────────────────────────────────────────────────
-- Nunca `using (true)` nem `auth.uid() is not null`: o cliente do portal
-- também é `authenticated`, e qualquer uma das duas o deixaria ler a carteira
-- inteira. A porta é `q_e_equipe()`.

alter table public.unidades              enable row level security;
alter table public.equipe                enable row level security;
alter table public.bancos                enable row level security;
alter table public.linhas_credito        enable row level security;
alter table public.departamentos         enable row level security;
alter table public.documento_tipos       enable row level security;
alter table public.clientes              enable row level security;
alter table public.contratos             enable row level security;
alter table public.contrato_historico    enable row level security;
alter table public.contrato_documentos   enable row level security;
alter table public.atendimentos          enable row level security;
alter table public.atendimento_mensagens enable row level security;

-- Cadastros: a equipe lê, o gestor mantém. Sem DELETE: desative.
do $$
declare t text;
begin
  foreach t in array array['unidades','equipe','bancos','linhas_credito','departamentos','documento_tipos'] loop
    execute format('create policy %1$s_equipe_le on public.%1$I for select to authenticated using (public.q_e_equipe())', t);
    execute format('create policy %1$s_gestor_cria on public.%1$I for insert to authenticated with check (public.q_e_gestor())', t);
    execute format('create policy %1$s_gestor_altera on public.%1$I for update to authenticated using (public.q_e_gestor()) with check (public.q_e_gestor())', t);
  end loop;
end $$;

-- Carteira e atendimento: a equipe inteira opera. Sem DELETE.
do $$
declare t text;
begin
  foreach t in array array['clientes','contratos','contrato_documentos','atendimentos'] loop
    execute format('create policy %1$s_equipe_le on public.%1$I for select to authenticated using (public.q_e_equipe())', t);
    execute format('create policy %1$s_equipe_cria on public.%1$I for insert to authenticated with check (public.q_e_equipe())', t);
    execute format('create policy %1$s_equipe_altera on public.%1$I for update to authenticated using (public.q_e_equipe()) with check (public.q_e_equipe())', t);
  end loop;
end $$;

-- Histórico: qualquer um da equipe lança, no PRÓPRIO nome. Corrigir ou tirar
-- uma ocorrência é do gestor — é o que o cliente leu.
create policy contrato_historico_equipe_le on public.contrato_historico
  for select to authenticated using (public.q_e_equipe());
create policy contrato_historico_equipe_cria on public.contrato_historico
  for insert to authenticated with check (public.q_e_equipe() and autor_id = auth.uid());
create policy contrato_historico_gestor_altera on public.contrato_historico
  for update to authenticated using (public.q_e_gestor()) with check (public.q_e_gestor());
create policy contrato_historico_gestor_remove on public.contrato_historico
  for delete to authenticated using (public.q_e_gestor());

-- Mensagens: a equipe responde como ELA mesma (nunca como cliente ou robô).
-- Mensagem enviada não se reescreve: o UPDATE só alcança `lida_em`.
create policy atendimento_mensagens_equipe_le on public.atendimento_mensagens
  for select to authenticated using (public.q_e_equipe());
create policy atendimento_mensagens_equipe_envia on public.atendimento_mensagens
  for insert to authenticated
  with check (public.q_e_equipe() and autor_tipo = 'equipe' and autor_id = auth.uid());
create policy atendimento_mensagens_equipe_marca_lida on public.atendimento_mensagens
  for update to authenticated using (public.q_e_equipe()) with check (public.q_e_equipe());

revoke update on public.atendimento_mensagens from authenticated;
grant update (lida_em) on public.atendimento_mensagens to authenticated;

-- `anon` não tem o que fazer em tabela nenhuma daqui (os defaults do bloco 0
-- valem só para o que for criado DEPOIS dele; isto cobre o que já nasceu).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;


-- ─── 6. Dados iniciais ─────────────────────────────────────────────────────
-- Só o que o portal antigo já mostrava. Os departamentos URGENTES (os "4 e 9"
-- do sistema antigo) NÃO entram aqui: ninguém sabe ainda quais são, e chutar
-- esconderia histórico do cliente. Marca-se na tela de Departamentos.

insert into public.departamentos (nome, atende_chat, ordem) values
  ('Acordo', true, 10),
  ('Cobrança', true, 20),
  ('Monitoramento', true, 30),
  ('Ouvidoria', true, 40);

insert into public.linhas_credito (nome, tem_veiculo) values ('Veicular', true);

insert into public.documento_tipos (codigo, nome, ordem) values
  ('termo', 'Termo', 10),
  ('contrato', 'Contrato', 20),
  ('declaracao', 'Declaração', 30),
  ('procuracao', 'Procuração', 40);
