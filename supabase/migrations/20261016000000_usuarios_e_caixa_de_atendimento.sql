-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · USUÁRIOS da equipe e a CAIXA de atendimentos
--
-- Pedido do dono do processo em 15/10/2026: as telas do admin reais e
-- funcionando. Duas delas precisam de banco que ainda não existia:
--
--   Usuários      o gestor CRIA a pessoa da equipe (login + perfil) e redefine
--                 a senha dela — sem passar pelo painel do Supabase.
--   Atendimentos  a caixa precisa da última mensagem e das não lidas de cada
--                 conversa; lido mensagem a mensagem na tela, seria uma
--                 consulta por atendimento.
--
-- E uma trava que só apareceu com a tela de Usuários: SEMPRE sobra um gestor.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO 1 · criar a pessoa da equipe e redefinir a senha ════════════════

-- O gestor cria o login (e-mail REAL, já confirmado) e o perfil numa tacada.
-- ⚠️ Mesmo cuidado da q_portal_definir_senha: tokens '' e não nulos, senão o
-- Auth falha no LOGIN com "Database error querying schema".
-- ⚠️ Recusa e-mail que já é CLIENTE do portal: a mesma conta não pode ser as
-- duas coisas — o ProtectedRoute do admin e o do portal se contradiriam.
create or replace function public.q_equipe_criar_usuario(
  p_email text, p_nome text, p_papel text, p_senha text, p_cargo text default null
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor cria usuários.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_nome, ''))) = 0 then
    raise exception 'Informe o nome.' using errcode = 'P0001';
  end if;
  if p_papel not in ('gestor', 'colaborador') then
    raise exception 'Nível inválido.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha precisa de pelo menos 8 caracteres.' using errcode = 'P0001';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;

  if v_user is not null then
    if exists (select 1 from public.perfis where id = v_user) then
      raise exception 'Este e-mail já é de um usuário da equipe.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.clientes where user_id = v_user) then
      raise exception 'Este e-mail é de um cliente do portal.' using errcode = 'P0001';
    end if;
    -- Conta órfã (criada no painel do Supabase, sem perfil): vira equipe com a senha nova.
    update auth.users
       set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until = null, updated_at = now()
     where id = v_user;
  else
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      v_email, extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', trim(p_nome)), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  insert into public.perfis (id, nome, email, papel, cargo)
  values (v_user, trim(p_nome), v_email, p_papel, nullif(trim(coalesce(p_cargo, '')), ''));
  return v_user;
end $$;

-- O gestor redefine a senha de alguém da equipe (que esqueceu, ou que entrou agora).
create or replace function public.q_equipe_definir_senha(p_perfil uuid, p_senha text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor redefine senha.' using errcode = '42501';
  end if;
  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha precisa de pelo menos 8 caracteres.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.perfis where id = p_perfil) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0001';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         banned_until = null, updated_at = now()
   where id = p_perfil;
end $$;

revoke execute on function public.q_equipe_criar_usuario(text, text, text, text, text) from public, anon;
revoke execute on function public.q_equipe_definir_senha(uuid, text) from public, anon;
grant execute on function public.q_equipe_criar_usuario(text, text, text, text, text) to authenticated, service_role;
grant execute on function public.q_equipe_definir_senha(uuid, text) to authenticated, service_role;


-- ═══ BLOCO 2 · sempre sobra um gestor ══════════════════════════════════════
-- Sem isso, o último gestor rebaixado ou desativado (inclusive por ele mesmo,
-- num clique errado) deixa a Quadrum sem ninguém capaz de criar usuário,
-- mudar nível ou reativar alguém — e a volta só pelo SQL Editor.

create or replace function public.q_perfil_sobra_um_gestor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.papel = 'gestor' and old.ativo
     and not (new.papel = 'gestor' and new.ativo)
     and not exists (select 1 from public.perfis
                     where id <> old.id and papel = 'gestor' and ativo) then
    raise exception 'É preciso sobrar pelo menos um gestor ativo.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_sobra_um_gestor() from public, anon;

drop trigger if exists trg_perfil_sobra_um_gestor on public.perfis;
create trigger trg_perfil_sobra_um_gestor
  before update on public.perfis
  for each row execute function public.q_perfil_sobra_um_gestor();


-- ═══ BLOCO 3 · a caixa de atendimentos ═════════════════════════════════════
-- Uma linha por atendimento, com a ÚLTIMA mensagem e quantas do CLIENTE estão
-- sem leitura. `security_invoker`: roda com as permissões de quem lê, então a
-- regra gestor/colaborador das tabelas vale aqui sem ser repetida.
-- ⚠️ Toda republicação desta view repete o `with (security_invoker = true)`:
-- `create or replace view` sem ele APAGA a opção e a view passa a rodar como
-- dono — ignorando a RLS e mostrando a caixa inteira a qualquer colaborador.

create or replace view public.atendimentos_caixa
with (security_invoker = true) as
select
  a.id,
  a.numero,
  a.titulo,
  a.cliente_id,
  a.contrato_id,
  a.setor_id,
  a.responsavel_id,
  a.arquivado_em,
  a.created_at,
  -- Responsável por atendimento de cliente de OUTRA carteira vê o atendimento
  -- e não o cliente: `left join`, senão a linha some da caixa dele.
  coalesce(c.nome, 'Cliente de outra carteira') as cliente_nome,
  coalesce(c.documento, '')                    as cliente_documento,
  k.numero    as contrato_numero,
  d.nome      as setor_nome,
  r.nome      as responsavel_nome,
  u.corpo      as ultima_corpo,
  u.autor_tipo as ultima_autor_tipo,
  u.created_at as ultima_em,
  (select count(*) from public.atendimento_mensagens m
    where m.atendimento_id = a.id and m.autor_tipo = 'cliente' and m.lida_em is null)::int as nao_lidas
from public.atendimentos a
left join public.clientes c on c.id = a.cliente_id
left join public.contratos k on k.id = a.contrato_id
left join public.departamentos d on d.id = a.setor_id
left join public.perfis r on r.id = a.responsavel_id
left join lateral (
  select m.corpo, m.autor_tipo, m.created_at
  from public.atendimento_mensagens m
  where m.atendimento_id = a.id
  order by m.created_at desc, m.id desc
  limit 1
) u on true;

revoke all on public.atendimentos_caixa from anon;
grant select on public.atendimentos_caixa to authenticated;
