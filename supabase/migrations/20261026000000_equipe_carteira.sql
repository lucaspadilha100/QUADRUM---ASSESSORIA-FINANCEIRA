-- ─────────────────────────────────────────────────────────────────────────────
-- Usuários com a CARTEIRA de cada pessoa (pedido do dono do processo,
-- 23/10/2026: melhorar a tela de Usuários). Uma chamada devolve, por perfil:
-- clientes de que é consultor, contratos em andamento e no portal, e
-- atendimentos abertos em que é o responsável — contados no banco, sem baixar
-- a carteira. O último acesso só vai para o ADMINISTRADOR (para o gestor ele
-- continua sendo dado da tela Últimos acessos, que é só do admin).
-- O admin some do mapa para quem não é admin, como some da lista de perfis.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.q_equipe_carteira()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := public.q_e_admin();
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor vê a carteira da equipe.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(p.id, jsonb_build_object(
      'clientes',     (select count(*) from public.clientes c where c.consultor_id = p.id),
      'andamento',    (select count(*) from public.contratos k
                        where k.consultor_id = p.id and k.cancelado_em is null and k.data_aceite is null),
      'portal',       (select count(*) from public.contratos k
                        where k.consultor_id = p.id and k.cancelado_em is null and k.data_aceite is not null),
      'atendimentos', (select count(*) from public.atendimentos a
                        where a.responsavel_id = p.id and a.arquivado_em is null),
      'ultimo_acesso', case when v_admin then (
                          select greatest(max(a.created_at), max(u.last_sign_in_at))
                            from auth.users u left join public.acessos a on a.user_id = u.id
                           where u.id = p.id) end))
      from public.perfis p
     where p.papel <> 'admin' or v_admin), '{}'::jsonb);
end $$;
revoke execute on function public.q_equipe_carteira() from public, anon;
grant execute on function public.q_equipe_carteira() to authenticated, service_role;
