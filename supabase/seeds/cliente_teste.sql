-- Cliente de TESTE do Portal do Cliente (não é migração: dado de demonstração).
-- Login no /portal: CPF 999.999.999-99 · senha 12345678
-- Idempotente: rodar de novo não duplica; só redefine a senha.
-- Pedido do dono do processo em 15/10/2026, para apresentar o portal.

do $$
declare
  v_doc      text := '99999999999';
  v_senha    text := '12345678';
  v_email    text := public.q_portal_email('99999999999');
  v_gestor   uuid;
  v_cliente  uuid;
  v_user     uuid;
  v_contrato uuid;
begin
  select id into v_gestor from public.perfis where papel = 'gestor' and ativo order by created_at limit 1;
  if v_gestor is null then
    raise exception 'Nenhum gestor ativo em perfis.';
  end if;

  -- Cliente de teste (reaproveita se já existir).
  select id, user_id into v_cliente, v_user from public.clientes where documento = v_doc;
  if v_cliente is null then
    insert into public.clientes (documento, nome, telefone, consultor_id, created_by)
    values (v_doc, 'Cliente Teste', '(84) 99999-9999', v_gestor, v_gestor)
    returning id into v_cliente;
  end if;

  -- Contrato já na etapa ACEITA: é o que faz ele aparecer no portal.
  if not exists (select 1 from public.contratos where cliente_id = v_cliente) then
    insert into public.contratos (cliente_id, etapa_id, linha_credito_id, veiculo, ano_modelo, placa, consultor_id, created_by)
    values (
      v_cliente,
      (select id from public.pipeline_etapas where aceita and ativo order by ordem limit 1),
      (select id from public.linhas_credito where nome = 'Veicular'),
      'Onix 1.0', '2021/2022', 'TST1A23', v_gestor, v_gestor
    )
    returning id into v_contrato;
    insert into public.contrato_historico (contrato_id, texto, autor_id)
    values (v_contrato, E'Bem-vindo ao Portal do Cliente Quadrum!\nEste é um contrato de teste.', v_gestor);
  end if;

  -- Login do portal: cria a conta ou, se já existir, só troca a senha.
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
      v_email, extensions.crypt(v_senha, extensions.gen_salt('bf')), now(),
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
       set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
           banned_until = null, updated_at = now()
     where id = v_user;
  end if;

  update public.clientes set user_id = v_user where id = v_cliente;
end $$;

select c.nome, c.documento, c.user_id is not null as tem_login,
       k.numero as contrato, k.data_aceite, e.nome as etapa
from public.clientes c
join public.contratos k on k.cliente_id = c.id
join public.pipeline_etapas e on e.id = k.etapa_id
where c.documento = '99999999999';
