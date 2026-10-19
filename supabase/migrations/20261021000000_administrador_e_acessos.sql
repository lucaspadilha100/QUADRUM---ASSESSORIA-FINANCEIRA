-- ─────────────────────────────────────────────────────────────────────────────
-- ADMINISTRADOR (acima do gestor) e ÚLTIMOS ACESSOS
--
-- Pedido do dono do processo (19/10/2026): o login dele, criador do sistema,
-- é ADMIN — vê tudo, não aparece na lista de usuários e tem telas que o resto
-- não tem; a primeira é "Últimos acessos" (quando cada pessoa entrou).
--
--   ADMIN        tudo o que o gestor faz (q_e_gestor() é verdadeiro para ele)
--                + telas de administração; invisível para quem não é admin
--   GESTOR       igual a antes; não vê nem mexe no admin
--   COLABORADOR  igual a antes
--
-- ⚠️ Admin só nasce pelo SQL Editor (bloco à parte, com o e-mail): nenhuma
-- tela dá esse nível, e ninguém abaixo dele consegue tirá-lo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ BLOCO 1 · o nível ══════════════════════════════════════════════════════
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('admin', 'gestor', 'colaborador'));

create or replace function public.q_e_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin');
$$;
revoke execute on function public.q_e_admin() from public, anon;
grant execute on function public.q_e_admin() to authenticated, service_role;

-- O admin faz tudo o que o gestor faz: toda regra que pergunta q_e_gestor()
-- passa a valer para ele, sem reescrever regra nenhuma.
create or replace function public.q_e_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel in ('gestor', 'admin'));
$$;

-- Ninguém abaixo do admin mexe no perfil dele nem dá esse nível a alguém.
create or replace function public.q_perfil_protege_acesso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.q_e_admin()
     and (old.papel = 'admin' or new.papel = 'admin') then
    raise exception 'Só um administrador muda o perfil de um administrador.' using errcode = '42501';
  end if;
  if auth.uid() is null or public.q_e_gestor() then
    return new;
  end if;
  if new.papel is distinct from old.papel
     or new.ativo is distinct from old.ativo
     or new.unidade_id is distinct from old.unidade_id
     or new.departamento_id is distinct from old.departamento_id
     or new.email is distinct from old.email then
    raise exception 'Só um gestor muda nível, departamento, unidade, e-mail ou ativação de um perfil.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_protege_acesso() from public, anon;

-- Novo perfil com nível admin só pelo admin (a tela nunca oferece).
create or replace function public.q_perfil_admin_so_pelo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.papel = 'admin' and auth.uid() is not null and not public.q_e_admin() then
    raise exception 'Só um administrador cria outro administrador.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_admin_so_pelo_admin() from public, anon, authenticated;
drop trigger if exists trg_perfil_admin_so_pelo_admin on public.perfis;
create trigger trg_perfil_admin_so_pelo_admin before insert on public.perfis
  for each row execute function public.q_perfil_admin_so_pelo_admin();

-- "Sempre sobra um gestor": o admin conta como quem administra.
create or replace function public.q_perfil_sobra_um_gestor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.papel in ('gestor', 'admin') and old.ativo
     and not (new.papel in ('gestor', 'admin') and new.ativo)
     and not exists (select 1 from public.perfis
                     where id <> old.id and papel in ('gestor', 'admin') and ativo) then
    raise exception 'É preciso sobrar pelo menos um gestor ativo.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_sobra_um_gestor() from public, anon;

-- O admin some das listas de quem não é admin (Usuários, consultor,
-- responsável…). ⚠️ Olha a COLUNA `papel` da linha (regra de leitura da
-- própria tabela), e cada um sempre vê a si mesmo.
drop policy if exists perfis_equipe_le on public.perfis;
create policy perfis_equipe_le on public.perfis
  for select to authenticated
  using ((select public.q_e_equipe())
         and (papel <> 'admin' or id = (select auth.uid()) or (select public.q_e_admin())));


-- ═══ BLOCO 2 · o registro de cada login ═════════════════════════════════════
-- Os apps chamam q_registrar_acesso logo depois de entrar. IP e navegador vêm
-- dos CABEÇALHOS (q_requisicao), nunca da tela. Ninguém lê a tabela direto.
create table if not exists public.acessos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  app         text not null check (app in ('admin', 'portal')),
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists acessos_user_idx on public.acessos (user_id, created_at desc);
create index if not exists acessos_data_idx on public.acessos (created_at desc);
alter table public.acessos enable row level security;
revoke all on public.acessos from anon, authenticated;

create or replace function public.q_registrar_acesso(p_app text)
returns void language plpgsql security definer set search_path = public as $$
declare v_req jsonb := public.q_requisicao();
begin
  if auth.uid() is null then
    raise exception 'Sem sessão.' using errcode = '42501';
  end if;
  insert into public.acessos (user_id, app, ip, user_agent)
  values (auth.uid(), p_app, v_req ->> 'ip', v_req ->> 'user_agent');
end $$;
revoke execute on function public.q_registrar_acesso(text) from public, anon;
grant execute on function public.q_registrar_acesso(text) to authenticated, service_role;

-- Uma linha por PESSOA (equipe e clientes do portal), com o último acesso.
-- O último login do Auth entra junto: quem entrou antes deste registro já
-- aparece com data. Só o admin.
create or replace function public.q_acessos_pessoas(
  p_busca text default '', p_tipo text default 'todos', p_pagina int default 1, p_por int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_por int := least(greatest(coalesce(p_por, 20), 1), 100);
  v_ini int := (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_por, 20), 1), 100);
  v jsonb;
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
  ), base as (
    select g.*, u.banned_until,
           ult.created_at as ultimo_registro, ult.ip, ult.app,
           greatest(ult.created_at, u.last_sign_in_at) as ultimo_acesso,
           (select count(*) from public.acessos a where a.user_id = g.user_id and a.created_at >= now() - interval '30 days') as acessos_30d
      from gente g
      join auth.users u on u.id = g.user_id
      left join lateral (select a.created_at, a.ip, a.app from public.acessos a
                          where a.user_id = g.user_id order by a.created_at desc limit 1) ult on true
     where public.q_casa_busca(public.q_busca(g.nome || ' ' || coalesce(g.identificador, '')), p_busca)
  )
  select jsonb_build_object(
    'linhas', coalesce((select jsonb_agg(to_jsonb(x) order by x.ultimo_acesso desc nulls last, x.nome)
                          from (select * from base where p_tipo = 'todos' or tipo = case p_tipo when 'equipe' then 'equipe' else 'cliente' end
                                 order by ultimo_acesso desc nulls last, nome, user_id offset v_ini limit v_por) x), '[]'::jsonb),
    'contagem', jsonb_build_object(
      'todos', (select count(*) from base),
      'equipe', (select count(*) from base where tipo = 'equipe'),
      'clientes', (select count(*) from base where tipo = 'cliente')))
  into v;
  return v;
end $$;
revoke execute on function public.q_acessos_pessoas(text, text, int, int) from public, anon;
grant execute on function public.q_acessos_pessoas(text, text, int, int) to authenticated, service_role;

-- Os acessos de UMA pessoa, do mais recente para trás.
create or replace function public.q_acessos_de(p_user uuid, p_limite int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.q_e_admin() then
    raise exception 'Só o administrador vê os acessos.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                     from (select id, app, ip, user_agent, created_at from public.acessos
                            where user_id = p_user order by created_at desc
                            limit least(greatest(coalesce(p_limite, 30), 1), 200)) x), '[]'::jsonb);
end $$;
revoke execute on function public.q_acessos_de(uuid, int) from public, anon;
grant execute on function public.q_acessos_de(uuid, int) to authenticated, service_role;
