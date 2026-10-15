-- ─────────────────────────────────────────────────────────────────────────────
-- AO VIVO — o admin se atualiza sozinho (Supabase Realtime)
--
-- Pedido do dono do processo (15/10/2026): "só apareceu assinado quando dei
-- F5… assinou já altera tudo". O admin escuta estas tabelas
-- (apps/admin/src/hooks/useAoVivo.tsx) e relê a tela aberta a cada mudança.
--
-- ⚠️ O Realtime confere a RLS de QUEM ESCUTA, linha a linha: o colaborador é
-- avisado só do que é da carteira dele — a mesma regra das telas. Por isso
-- nenhuma regra muda aqui; é só a publicação.
-- ⚠️ O cliente do portal não tem policy em tabela nenhuma, então não recebe
-- nada por aqui (e não deve): o portal relê sozinho a cada 20 s / 5 s no chat.
-- ⚠️ Tabela nova que a equipe precisa ver mudar ao vivo entra AQUI e no
-- `AFETA` do useAoVivo. Fora da publicação, o canal dela dá CHANNEL_ERROR no
-- console e a tela volta a depender do F5.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'contratos', 'clientes', 'contrato_documentos', 'documento_assinaturas',
    'documento_eventos', 'contrato_historico', 'atendimentos', 'atendimento_mensagens'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
