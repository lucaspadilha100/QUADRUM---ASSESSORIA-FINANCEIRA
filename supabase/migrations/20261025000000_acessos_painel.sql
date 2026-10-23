-- ─────────────────────────────────────────────────────────────────────────────
-- Últimos acessos ganha PAINEL (pedido do dono do processo, 23/10/2026: a tela
-- estava "simplória"): números do período, logins por dia, situação de cada
-- pessoa e o dispositivo do último login.
--
--   resumo     hoje · 7 dias · 30 dias · nunca entraram · logins hoje
--              (segue o filtro de TIPO; ignora busca e situação)
--   por_dia    14 dias de logins e pessoas, no dia de Brasília
--   status     hoje | 7d | 30d | inativo | nunca  (de cada pessoa)
--   p_status   filtra a lista pela situação (os cartões do topo são links)
--
-- "N logins em 30 dias" conta o registro E o último login do Auth: quem entrou
-- antes da tabela `acessos` existir não aparece com "0" ao lado de "há 18 h".
-- ⚠️ Assinatura mudou (p_status): a antiga sai antes, senão as duas
-- conviveriam e o PostgREST não saberia qual chamar.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.q_acessos_pessoas(text, text, int, int);

create or replace function public.q_acessos_pessoas(
  p_busca text default '', p_tipo text default 'todos', p_status text default 'todos',
  p_pagina int default 1, p_por int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_por  int  := least(greatest(coalesce(p_por, 20), 1), 100);
  v_ini  int  := (greatest(coalesce(p_pagina, 1), 1) - 1) * v_por;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v      jsonb;
begin
  if not public.q_e_admin() then
    raise exception 'Só o administrador vê os acessos.' using errcode = '42501';
  end if;
  with gente as (
    select p.id as user_id, p.nome, p.email as identificador, 'equipe'::text as tipo, p.papel, p.ativo, p.avatar_url
      from public.perfis p
    union all
    select c.user_id, c.nome, c.documento, 'cliente', null, true, null
      from public.clientes c where c.user_id is not null
  ), todos as (
    select g.*, u.banned_until,
           ult.created_at as ultimo_registro, ult.ip, ult.app, ult.user_agent,
           greatest(ult.created_at, u.last_sign_in_at) as ultimo_acesso,
           greatest(
             (select count(*) from public.acessos a
               where a.user_id = g.user_id and a.created_at >= now() - interval '30 days'),
             case when u.last_sign_in_at >= now() - interval '30 days' then 1 else 0 end
           ) as acessos_30d
      from gente g
      join auth.users u on u.id = g.user_id
      left join lateral (select a.created_at, a.ip, a.app, a.user_agent from public.acessos a
                          where a.user_id = g.user_id order by a.created_at desc limit 1) ult on true
  ), marcado as (
    select t.*,
           case
             when t.ultimo_acesso is null then 'nunca'
             when (t.ultimo_acesso at time zone 'America/Sao_Paulo')::date = v_hoje then 'hoje'
             when t.ultimo_acesso >= now() - interval '7 days' then '7d'
             when t.ultimo_acesso >= now() - interval '30 days' then '30d'
             else 'inativo'
           end as status
      from todos t
  ), do_tipo as (
    select * from marcado
     where p_tipo = 'todos' or tipo = case p_tipo when 'equipe' then 'equipe' else 'cliente' end
  ), buscado as (
    select * from marcado
     where public.q_casa_busca(public.q_busca(nome || ' ' || coalesce(identificador, '')), p_busca)
       and case p_status
             when 'todos' then true
             when 'hoje'  then status = 'hoje'
             when '7d'    then status in ('hoje', '7d')
             when '30d'   then status in ('hoje', '7d', '30d')
             else status = p_status
           end
  ), base as (
    select * from buscado
     where p_tipo = 'todos' or tipo = case p_tipo when 'equipe' then 'equipe' else 'cliente' end
  )
  select jsonb_build_object(
    'linhas', coalesce((select jsonb_agg(to_jsonb(x) order by x.ultimo_acesso desc nulls last, x.nome, x.user_id)
                          from (select * from base
                                 order by ultimo_acesso desc nulls last, nome, user_id offset v_ini limit v_por) x), '[]'::jsonb),
    'total', (select count(*) from base),
    'contagem', jsonb_build_object(
      'todos',    (select count(*) from buscado),
      'equipe',   (select count(*) from buscado where tipo = 'equipe'),
      'clientes', (select count(*) from buscado where tipo = 'cliente')),
    'resumo', jsonb_build_object(
      'pessoas', (select count(*) from do_tipo),
      'hoje',    (select count(*) from do_tipo where status = 'hoje'),
      'd7',      (select count(*) from do_tipo where status in ('hoje', '7d')),
      'd30',     (select count(*) from do_tipo where status in ('hoje', '7d', '30d')),
      'inativo', (select count(*) from do_tipo where status = 'inativo'),
      'nunca',   (select count(*) from do_tipo where status = 'nunca'),
      'logins_hoje', (select count(*) from public.acessos a
                       where a.user_id in (select user_id from do_tipo)
                         and (a.created_at at time zone 'America/Sao_Paulo')::date = v_hoje)),
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', d.dia, 'logins', coalesce(x.logins, 0), 'pessoas', coalesce(x.pessoas, 0)) order by d.dia)
                  from (select (v_hoje - k) as dia from generate_series(0, 13) k) d
                  left join (select (a.created_at at time zone 'America/Sao_Paulo')::date as dia,
                                    count(*) as logins, count(distinct a.user_id) as pessoas
                               from public.acessos a
                              where a.user_id in (select user_id from do_tipo)
                                and a.created_at >= now() - interval '15 days'
                              group by 1) x on x.dia = d.dia))
  into v;
  return v;
end $$;
revoke execute on function public.q_acessos_pessoas(text, text, text, int, int) from public, anon;
grant execute on function public.q_acessos_pessoas(text, text, text, int, int) to authenticated, service_role;
