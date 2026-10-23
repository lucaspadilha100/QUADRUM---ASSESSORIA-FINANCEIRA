-- ─────────────────────────────────────────────────────────────────────────────
-- CPF/CNPJ só é exigido na entrada do PORTAL (pedido do dono do processo,
-- 23/10/2026): o contrato nasce só com o NOME; o documento passa a ser
-- obrigatório quando o card chega à etapa de aceite — que se chama agora
-- "Criar Perfil no Portal" —, porque é ele o login do cliente.
--
-- ⚠️ A regra mora no BANCO: entrar na etapa `aceita` sem documento é recusado
-- (gatilho em contratos), e o acesso ao portal também (q_portal_definir_senha).
-- ⚠️ Depois que o cliente tem acesso ao portal, o documento não muda nem some:
-- ele é o login (o e-mail sintético nasce dele).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ BLOCO 1 · documento opcional ═══════════════════════════════════════════
-- O CHECK de "só dígitos" continua valendo para quem tem; nulo passa. O UNIQUE
-- deixa vários nulos.
alter table public.clientes alter column documento drop not null;

-- A busca normalizada não pode virar NULA sem documento (sumiria da busca por
-- nome). Postgres 17: troca a expressão da coluna gerada sem derrubar as views.
alter table public.clientes alter column busca set expression as (
  public.q_busca(nome) || ' ' || coalesce(documento, '') || ' ' || lower(coalesce(email, '')) || ' ' ||
  regexp_replace(coalesce(telefone, ''), '\D', '', 'g')
);

-- Quem já tem acesso ao portal: o documento é o login, não muda. E cliente
-- com contrato já no portal não perde o documento.
create or replace function public.q_cliente_documento_protege()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.documento is not distinct from old.documento then
    return new;
  end if;
  if old.user_id is not null then
    raise exception 'O CPF/CNPJ é o login do portal deste cliente e não pode mudar.' using errcode = 'P0001';
  end if;
  if new.documento is null and exists (
    select 1 from public.contratos where cliente_id = new.id and data_aceite is not null
  ) then
    raise exception 'Cliente com contrato no portal precisa do CPF/CNPJ.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_cliente_documento_protege() from public, anon, authenticated;
drop trigger if exists trg_cliente_documento_protege on public.clientes;
create trigger trg_cliente_documento_protege before update of documento on public.clientes
  for each row execute function public.q_cliente_documento_protege();


-- ═══ BLOCO 2 · o documento é exigido na entrada do portal ═══════════════════
create or replace function public.q_contrato_exige_documento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_etapa text;
begin
  if tg_op = 'UPDATE' and new.etapa_id is not distinct from old.etapa_id then
    return new;
  end if;
  select nome into v_etapa from public.pipeline_etapas where id = new.etapa_id and aceita;
  if v_etapa is not null
     and (select documento from public.clientes where id = new.cliente_id) is null then
    raise exception 'Informe o CPF/CNPJ do cliente antes de mover para "%".', v_etapa using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.q_contrato_exige_documento() from public, anon, authenticated;
drop trigger if exists trg_contrato_exige_documento on public.contratos;
create trigger trg_contrato_exige_documento before insert or update of etapa_id on public.contratos
  for each row execute function public.q_contrato_exige_documento();

-- O acesso ao portal também exige o documento (é o login).
create or replace function public.q_portal_definir_senha(p_cliente uuid, p_senha text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_doc   text;
  v_user  uuid;
  v_email text;
begin
  if not public.q_ve_cliente(p_cliente) then
    raise exception 'Sem permissão para este cliente.' using errcode = '42501';
  end if;
  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha precisa de pelo menos 8 caracteres.' using errcode = 'P0001';
  end if;

  select documento, user_id into v_doc, v_user from public.clientes where id = p_cliente;
  if v_doc is null then
    raise exception 'Informe o CPF/CNPJ do cliente antes de criar o acesso ao portal.' using errcode = 'P0001';
  end if;
  v_email := public.q_portal_email(v_doc);

  -- Vínculo perdido (conta existe, cliente sem user_id): reaproveita a conta.
  if v_user is null then
    select id into v_user from auth.users where email = v_email;
  end if;

  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      v_email, extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"portal_cliente":true}'::jsonb, now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
           banned_until = null,
           updated_at = now()
     where id = v_user;
  end if;

  update public.clientes set user_id = v_user where id = p_cliente and user_id is distinct from v_user;
  return v_email;
end $$;

revoke execute on function public.q_portal_definir_senha(uuid, text) from public, anon;
grant execute on function public.q_portal_definir_senha(uuid, text) to authenticated, service_role;


-- ═══ BLOCO 3 · a coluna de aceite ganha o nome do que ela faz ═══════════════
update public.pipeline_etapas set nome = 'Criar Perfil no Portal'
 where nome = 'Contrato aceito';
