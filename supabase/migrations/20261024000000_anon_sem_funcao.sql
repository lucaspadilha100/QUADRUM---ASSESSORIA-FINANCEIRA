-- ─────────────────────────────────────────────────────────────────────────────
-- Nenhuma função do schema public executável por `anon` (auditoria de
-- 23/10/2026: 14 funções apareciam executáveis sem login).
--
-- Não era vazamento: as 14 são SECURITY INVOKER — 8 de gatilho (que não se
-- chamam direto) e 6 puras ou que leem tabela com as permissões de quem chama
-- (o anon não lê tabela nenhuma). Mas porta que não precisa existir, fecha.
--
-- ⚠️ A causa: o Postgres dá EXECUTE a PUBLIC em toda função nova, e o
-- `alter default privileges IN SCHEMA ... revoke ... from public` da
-- 20261015000000 NÃO desfaz isso (por schema, default privilege só ACRESCENTA).
-- Por isso toda função nova leva `revoke execute ... from public, anon`
-- explícito — e o teste "anon não executa NENHUMA função" pega a que esquecer.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;

-- A única pura que ainda não tinha grant explícito à equipe (as outras já têm;
-- as de gatilho não precisam: gatilho não confere EXECUTE de quem dispara).
grant execute on function public.q_data_extenso(date) to authenticated, service_role;
