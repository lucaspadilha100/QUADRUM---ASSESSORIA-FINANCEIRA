-- ─────────────────────────────────────────────────────────────────────────────
-- Colunas da Pipeline (pedido do dono do processo, 22/10/2026)
--
--   Análise da dívida          → Reunião
--   Em negociação com o banco  → Em negociação
--   + Enviar link de pagamento   (depois de Em negociação)
--   + Enviado
--
-- Etapa é CADASTRO: renomear mantém o id, então os cards, a linha do tempo e
-- o tempo por etapa seguem ligados à mesma coluna, só com o nome novo.
-- Idempotente: rodar de novo não muda nada.
-- ─────────────────────────────────────────────────────────────────────────────

update public.pipeline_etapas set nome = 'Reunião'
 where nome = 'Análise da dívida';

update public.pipeline_etapas set nome = 'Em negociação'
 where nome = 'Em negociação com o banco';

insert into public.pipeline_etapas (nome, ordem, cor, aceita) values
  ('Enviar link de pagamento', 53, '#8B5CF6', false),
  ('Enviado',                  56, '#6366F1', false)
on conflict (nome) do nothing;
