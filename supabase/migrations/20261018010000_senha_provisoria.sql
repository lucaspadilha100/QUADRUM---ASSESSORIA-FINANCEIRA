-- ─────────────────────────────────────────────────────────────────────────────
-- SENHA PROVISÓRIA — no primeiro login, a pessoa cria a própria senha
--
-- Pedido do dono do processo (15/10/2026): a senha que o gestor gera para a
-- equipe (e a equipe gera para o cliente do portal) é aleatória e passada de
-- mão em mão; quem entra tem de trocá-la por uma senha SÓ DELE.
--
-- No portal isso é também JURÍDICO: a senha é a prova de que quem assinou é o
-- titular. Senha que a equipe conhece não prova nada — por isso documento não
-- se assina com senha provisória (gatilho em documento_assinaturas).
--
-- Quem diz "provisória" é QUEM definiu a senha, e isso o banco sabe sozinho:
--   alguém definiu a senha de OUTRA pessoa (auth.uid() <> dono) → provisória
--   a própria pessoa trocou (ou o Auth, no "esqueci a senha")   → deixa de ser
-- Gatilho em auth.users, e não nas funções que geram senha: qualquer caminho
-- futuro (outra tela, outra função) já nasce coberto.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.senha_provisoria (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  definida_por  uuid,
  desde         timestamptz not null default now()
);
alter table public.senha_provisoria enable row level security;
revoke all on public.senha_provisoria from anon, authenticated;
grant select on public.senha_provisoria to authenticated;

-- A equipe vê quem ainda está com senha provisória: o gestor, todos; o
-- colaborador, os clientes que ele vê (a RLS de `clientes` vale no subselect).
-- O cliente do portal não lê (não é equipe e não tem cliente visível).
drop policy if exists senha_provisoria_le on public.senha_provisoria;
create policy senha_provisoria_le on public.senha_provisoria
  for select to authenticated
  using ((select public.q_e_gestor())
         or user_id in (select c.user_id from public.clientes c where c.user_id is not null));


-- ═══ o gatilho: quem definiu a senha decide se ela é provisória ═════════════
-- ⚠️ NUNCA derruba o Auth: um erro aqui viraria "Database error" no login de
-- todo mundo. Falhou, avisa no log do Postgres e deixa passar — o pior caso é
-- alguém não ser obrigado a trocar, nunca ninguém conseguir entrar.
create or replace function public.q_senha_marca_provisoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if auth.uid() is not null and auth.uid() <> new.id then
      insert into public.senha_provisoria (user_id, definida_por) values (new.id, auth.uid())
      on conflict (user_id) do update set definida_por = excluded.definida_por, desde = now();
    else
      delete from public.senha_provisoria where user_id = new.id;
    end if;
  exception when others then
    raise warning '[senha_provisoria] %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_senha_marca_provisoria() from public, anon, authenticated;

drop trigger if exists trg_senha_provisoria_nova on auth.users;
create trigger trg_senha_provisoria_nova
  after insert on auth.users
  for each row execute function public.q_senha_marca_provisoria();

-- Só quando a senha MUDA de fato: o login também grava em auth.users, e não
-- pode limpar a marca.
drop trigger if exists trg_senha_provisoria_troca on auth.users;
create trigger trg_senha_provisoria_troca
  after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.q_senha_marca_provisoria();


-- ═══ a senha é minha? ═══════════════════════════════════════════════════════
create or replace function public.q_senha_provisoria()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.senha_provisoria where user_id = auth.uid())
$$;
revoke execute on function public.q_senha_provisoria() from public, anon;
grant execute on function public.q_senha_provisoria() to authenticated, service_role;


-- ═══ o que é senha FRACA (a tela só mostra; quem recusa é aqui) ═════════════
-- Nulo = aceitável; texto = o motivo, para a tela mostrar.
create or replace function public.q_senha_fraca(p_senha text, p_email text default null)
returns text language plpgsql immutable set search_path = public as $$
declare
  s text := coalesce(p_senha, '');
  v_local text := lower(split_part(coalesce(p_email, ''), '@', 1));
begin
  if length(s) < 8 then return 'A senha precisa de pelo menos 8 caracteres.'; end if;
  if s !~ '[A-Za-zÀ-ÿ]' or s !~ '[0-9]' then return 'Use letras e números.'; end if;
  if s ~ '^(.)\1+$' then return 'A senha não pode ser um caractere repetido.'; end if;
  if lower(s) in ('12345678', '123456789', '1234567890', 'senha123', 'senha1234', 'abc12345',
                  'quadrum1', 'quadrum123', 'qwerty123', 'password1', 'mudar123', 'trocar123') then
    return 'Essa senha é muito comum. Escolha outra.';
  end if;
  -- O próprio CPF/CNPJ (o e-mail do portal é <documento>@…) ou o e-mail.
  if length(v_local) >= 4 and position(v_local in lower(s)) > 0 then
    return 'A senha não pode conter o seu CPF/CNPJ ou o seu e-mail.';
  end if;
  return null;
end $$;
grant execute on function public.q_senha_fraca(text, text) to authenticated, service_role;


-- ═══ trocar a própria senha ═════════════════════════════════════════════════
-- Com senha PROVISÓRIA não pede a atual (a pessoa acabou de digitá-la no
-- login). Fora disso, pede — sessão esquecida aberta não troca a senha de
-- ninguém. Erro de regra DEVOLVE {ok:false, erro}, como a assinatura.
create or replace function public.q_trocar_minha_senha(p_atual text, p_nova text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_email text;
  v_prov  boolean;
  v_fraca text;
begin
  if v_uid is null then
    raise exception 'Entre no sistema para trocar a senha.' using errcode = '42501';
  end if;
  select encrypted_password, email into v_hash, v_email from auth.users where id = v_uid;
  v_prov := exists (select 1 from public.senha_provisoria where user_id = v_uid);

  if not v_prov and (v_hash is null or v_hash <> extensions.crypt(coalesce(p_atual, ''), v_hash)) then
    return jsonb_build_object('ok', false, 'erro', 'A senha atual não confere.');
  end if;
  v_fraca := public.q_senha_fraca(p_nova, v_email);
  if v_fraca is not null then
    return jsonb_build_object('ok', false, 'erro', v_fraca);
  end if;
  if v_hash is not null and v_hash = extensions.crypt(p_nova, v_hash) then
    return jsonb_build_object('ok', false, 'erro',
      case when v_prov then 'Crie uma senha diferente da provisória.' else 'A nova senha é igual à atual.' end);
  end if;

  -- O gatilho vê auth.uid() = dono e tira a marca de provisória.
  update auth.users
     set encrypted_password = extensions.crypt(p_nova, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = v_uid;
  delete from public.senha_provisoria where user_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.q_trocar_minha_senha(text, text) from public, anon;
grant execute on function public.q_trocar_minha_senha(text, text) to authenticated, service_role;


-- ═══ documento não se assina com senha que a equipe conhece ═════════════════
create or replace function public.q_assinatura_exige_senha_propria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.senha_provisoria where user_id = new.user_id) then
    raise exception 'Crie a sua senha pessoal antes de assinar (a senha recebida da equipe é provisória).'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_assinatura_exige_senha_propria() from public, anon, authenticated;

drop trigger if exists trg_assinatura_exige_senha_propria on public.documento_assinaturas;
create trigger trg_assinatura_exige_senha_propria
  before insert on public.documento_assinaturas
  for each row execute function public.q_assinatura_exige_senha_propria();


-- ═══ quem JÁ existe: provisória é a senha de quem nunca entrou ══════════════
-- Contas criadas antes deste gatilho (equipe e clientes do portal) não têm a
-- marca. Quem nunca fez login ainda está com a senha que recebeu; quem já
-- entrou fica como está (o primeiro gestor, por exemplo).
insert into public.senha_provisoria (user_id)
select u.id from auth.users u
where u.last_sign_in_at is null
  and (exists (select 1 from public.perfis p where p.id = u.id)
       or exists (select 1 from public.clientes c where c.user_id = u.id))
on conflict (user_id) do nothing;
