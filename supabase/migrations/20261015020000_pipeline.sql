-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · PIPELINE (kanban de contratos)
--
-- Pedido do dono do processo em 15/10/2026: o CRM no sentido da pipeline —
-- card, arrastar e soltar — portado do carbohub, e CASANDO com o que o Portal
-- do Cliente mostra (docs/mapeamento-portal-cliente.md). Nada rebuscado.
--
-- O CARD É O CONTRATO. É o que o cliente vê no portal ("CONTRATO #123"), então
-- a pipeline não cria uma segunda entidade ("lead", "negócio") que depois
-- precisaria ser convertida — e divergir.
--
--   etapa com `aceita`  →  o card chega nela  →  data_aceite = hoje
--                          →  o contrato PASSA A APARECER no portal
--   "Perdido"           →  cancelado_em (a coluna que já existe)
--                          →  o portal mostra o selo CONTRATO CANCELADO
--
-- Decisões:
--   1. Etapas são CADASTRO, nunca CHECK: etapa nova é INSERT, sem deploy.
--   2. "Perdido" NÃO é uma etapa: é `cancelado_em`, a mesma coluna que o portal
--      lê. Uma etapa "Perdido" ao lado dela seria o segundo lugar dizendo se o
--      contrato está cancelado — e os dois iam discordar.
--   3. Voltar o card para antes da etapa aceita NÃO apaga `data_aceite`: o
--      aceite é um FATO (o cliente aceitou naquele dia), não uma posição na
--      tela. Desfazer aceite, se um dia precisar, é decisão explícita.
--   4. A regra mora no GATILHO, não na tela: o arrastar, o "Avançar" e
--      qualquer update futuro passam por ele.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO 1 · etapas e a coluna no contrato ═══════════════════════════════

create table public.pipeline_etapas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  ordem       int not null default 0,
  cor         text not null default '#64748B',
  aceita      boolean not null default false,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.pipeline_etapas.aceita is
  'Chegar nesta etapa = o cliente ACEITOU o contrato: grava contratos.data_aceite (se vazio) e o contrato passa a aparecer no Portal do Cliente.';

create trigger trg_pipeline_etapas_updated_at before update on public.pipeline_etapas
  for each row execute function public.q_tocar_updated_at();

alter table public.contratos
  add column etapa_id uuid references public.pipeline_etapas(id),
  add column etapa_desde timestamptz not null default now();
create index contratos_etapa_idx on public.contratos (etapa_id);
comment on column public.contratos.etapa_desde is
  'Desde quando o card está na etapa atual — é o "parado há N dias" do card. Quem grava é o gatilho, na troca de etapa.';

alter table public.pipeline_etapas enable row level security;
create policy pipeline_etapas_equipe_le on public.pipeline_etapas
  for select to authenticated using (public.q_e_equipe());
create policy pipeline_etapas_gestor_cria on public.pipeline_etapas
  for insert to authenticated with check (public.q_e_gestor());
create policy pipeline_etapas_gestor_altera on public.pipeline_etapas
  for update to authenticated using (public.q_e_gestor()) with check (public.q_e_gestor());


-- ═══ BLOCO 2 · o gatilho da etapa ══════════════════════════════════════════

create or replace function public.q_contrato_etapa()
returns trigger language plpgsql as $$
declare v_aceita boolean;
begin
  -- Contrato NOVO sem etapa entra na PRIMEIRA etapa ativa. Só no INSERT: num
  -- UPDATE, etapa nula é erro de quem chamou, e o NOT NULL tem de recusar —
  -- preencher ali jogaria o card de volta à primeira coluna, calado.
  if tg_op = 'INSERT' and new.etapa_id is null then
    select id into new.etapa_id from public.pipeline_etapas
    where ativo order by ordem, nome limit 1;
  end if;

  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    new.etapa_desde := now();
    select aceita into v_aceita from public.pipeline_etapas where id = new.etapa_id;
    if coalesce(v_aceita, false) and new.data_aceite is null then
      new.data_aceite := current_date;
    end if;
  end if;
  return new;
end $$;

create trigger trg_contrato_etapa
  before insert or update of etapa_id on public.contratos
  for each row execute function public.q_contrato_etapa();


-- ═══ BLOCO 3 · etapas iniciais ═════════════════════════════════════════════
-- Ponto de partida editável (cadastro). Só "Contrato aceito" tem `aceita`.

insert into public.pipeline_etapas (nome, ordem, cor, aceita) values
  ('Novo contato',            10, '#94A3B8', false),
  ('Análise da dívida',       20, '#0E4A5A', false),
  ('Proposta apresentada',    30, '#F59E0B', false),
  ('Contrato aceito',         40, '#D4AF37', true),
  ('Em negociação com o banco', 50, '#3B82F6', false),
  ('Acordo fechado',          60, '#22C55E', false),
  ('Concluído',               70, '#15803D', false);

-- Contrato que já existir sem etapa vai para a primeira (hoje: nenhum).
update public.contratos set etapa_id = (
  select id from public.pipeline_etapas where ativo order by ordem, nome limit 1
) where etapa_id is null;

alter table public.contratos alter column etapa_id set not null;
