-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · PORTAL DO CLIENTE — o acesso do cliente e o que ele lê
--
-- Pedido do dono do processo em 15/10/2026 ("cadê a visualização de cliente?").
-- Especificação: docs/mapeamento-portal-cliente.md.
--
-- O cliente NUNCA toca nas tabelas da equipe. Tudo o que ele vê ou faz passa
-- por funções `portal_*`, que:
--   1. descobrem QUEM é o cliente pela sessão (`clientes.user_id = auth.uid()`)
--      e ignoram qualquer id de cliente vindo da tela;
--   2. devolvem só os campos que o portal mostra — observação interna, outro
--      cliente e histórico URGENTE (texto) nunca saem daqui;
--   3. escrevem só o que o cliente pode escrever (mensagem dele, abrir
--      atendimento, marcar como lido).
-- As tabelas continuam SEM nenhuma policy para o cliente: ausência fecha.
--
-- O LOGIN do cliente é CPF/CNPJ + senha. O Supabase Auth só conhece e-mail,
-- então cada cliente tem um e-mail SINTÉTICO: `<documento>@portal.quadrum.example`
-- (`.example` é domínio reservado: nenhum e-mail sai para lugar nenhum). A
-- regra mora em `q_portal_email()` e a tela do portal monta o MESMO e-mail ao
-- logar — mudou um, mude o outro (apps/portal/src/lib/acesso.ts).
--
-- A senha é gerada pela EQUIPE (o portal não tem cadastro nem "esqueci a
-- senha" — "Para obter sua senha ligue para…").
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO 1 · quem é o cliente da sessão, e o login dele ══════════════════

create or replace function public.q_portal_email(p_documento text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p_documento, ''), '\D', '', 'g') || '@portal.quadrum.example';
$$;

-- O cliente logado. Nulo para quem não é cliente (inclusive a equipe).
create or replace function public.q_cliente_da_sessao()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.clientes where user_id = auth.uid() and auth.uid() is not null;
$$;

revoke execute on function public.q_portal_email(text) from public, anon;
revoke execute on function public.q_cliente_da_sessao() from public, anon;
grant execute on function public.q_portal_email(text) to authenticated, service_role;
grant execute on function public.q_cliente_da_sessao() to authenticated, service_role;

-- A equipe gera (ou redefine) a senha do portal de um cliente que ela VÊ.
-- Cria a conta no Auth na primeira vez; depois só troca a senha (e desbloqueia).
--
-- ⚠️ Escreve em `auth.users`/`auth.identities` direto, como dono. Os campos de
-- token vão como '' e NÃO nulos: o Auth do Supabase falha ao ler usuário com
-- token nulo ("Database error querying schema"), e o sintoma aparece só no
-- LOGIN, longe daqui.
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


-- ═══ BLOCO 2 · o que o cliente LÊ ══════════════════════════════════════════

-- Quem está logado (topo do menu do portal). Nulo = não é cliente.
create or replace function public.portal_eu()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'nome', c.nome, 'documento', c.documento, 'tipo_pessoa', c.tipo_pessoa)
  from public.clientes c where c.id = public.q_cliente_da_sessao();
$$;

-- Meus Contratos: só os ACEITOS (data_aceite), como no portal antigo.
-- Histórico de departamento URGENTE não vem no texto — só a marca de que há
-- um não lido ("Você tem uma mensagem urgente").
create or replace function public.portal_contratos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id,
    'numero', k.numero,
    'data_aceite', k.data_aceite,
    'banco', b.nome,
    'linha', l.nome,
    'veiculo', k.veiculo,
    'ano_modelo', k.ano_modelo,
    'placa', k.placa,
    'consultor', p.nome,
    'unidade', coalesce(nullif(concat_ws(', ', u.cidade, u.uf), ''), u.nome),
    'cancelado', k.cancelado_em is not null,
    'historico', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', h.id, 'texto', h.texto, 'autor', ap.nome, 'created_at', h.created_at)
             order by h.created_at desc, h.id desc), '[]'::jsonb)
      from public.contrato_historico h
      left join public.departamentos d on d.id = h.departamento_id
      left join public.perfis ap on ap.id = h.autor_id
      where h.contrato_id = k.id and not coalesce(d.urgente, false)
    ),
    'urgente_nao_lido', exists (
      select 1 from public.contrato_historico h
      join public.departamentos d on d.id = h.departamento_id
      where h.contrato_id = k.id and d.urgente and h.lido_pelo_cliente_em is null
    ),
    'pendencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', cd.id, 'tipo', cd.tipo, 'nome', t.nome, 'link', cd.link_assinatura)
             order by t.ordem, cd.created_at), '[]'::jsonb)
      from public.contrato_documentos cd
      join public.documento_tipos t on t.codigo = cd.tipo
      where cd.contrato_id = k.id and cd.assinado_em is null
    ),
    'atendimentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'numero', a.numero, 'titulo', a.titulo, 'arquivado', a.arquivado_em is not null)
             order by a.created_at desc), '[]'::jsonb)
      from public.atendimentos a
      where a.contrato_id = k.id
    )
  ) order by k.numero desc), '[]'::jsonb)
  from public.contratos k
  left join public.bancos b on b.id = k.banco_id
  left join public.linhas_credito l on l.id = k.linha_credito_id
  left join public.perfis p on p.id = k.consultor_id
  left join public.unidades u on u.id = k.unidade_id
  where k.cliente_id = public.q_cliente_da_sessao()
    and k.data_aceite is not null;
$$;

-- "Novas mensagens no chat!": mensagem da EQUIPE não lida em atendimento aberto.
create or replace function public.portal_avisos()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('chat_nao_lido', exists (
    select 1 from public.atendimento_mensagens m
    join public.atendimentos a on a.id = m.atendimento_id
    where a.cliente_id = public.q_cliente_da_sessao()
      and a.arquivado_em is null
      and m.autor_tipo = 'equipe'
      and m.lida_em is null
  ));
$$;

-- Abrir "Meus Contratos" marca o histórico como lido (inclusive o urgente: o
-- aviso aparece nessa abertura e some na próxima — o comportamento antigo).
create or replace function public.portal_marcar_historico_lido()
returns void language sql security definer set search_path = public as $$
  update public.contrato_historico h
     set lido_pelo_cliente_em = now()
   where h.lido_pelo_cliente_em is null
     and h.contrato_id in (
       select k.id from public.contratos k
       where k.cliente_id = public.q_cliente_da_sessao() and k.data_aceite is not null
     );
$$;

-- Setores que atendem no chat (o seletor do robô).
create or replace function public.portal_setores()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome) order by d.ordem, d.nome), '[]'::jsonb)
  from public.departamentos d
  where d.atende_chat and d.ativo and public.q_cliente_da_sessao() is not null;
$$;


-- ═══ BLOCO 3 · o chat ══════════════════════════════════════════════════════

-- Um atendimento com as mensagens, do jeito que o portal desenha. Interna:
-- só as funções portal_* a chamam (sem grant para ninguém).
create or replace function public.q_portal_chat_json(p_atendimento uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id,
    'numero', a.numero,
    'titulo', a.titulo,
    'arquivado', a.arquivado_em is not null,
    'setor', d.nome,
    'contrato_numero', k.numero,
    'mensagens', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id,
               'autor_tipo', m.autor_tipo,
               -- Primeiro nome de quem escreveu; robô sem nome (a tela põe o dele).
               'autor', case m.autor_tipo
                          when 'equipe'  then split_part(pe.nome, ' ', 1)
                          when 'cliente' then split_part(c.nome, ' ', 1)
                        end,
               'corpo', m.corpo,
               'created_at', m.created_at)
             order by m.created_at, m.id), '[]'::jsonb)
      from public.atendimento_mensagens m
      left join public.perfis pe on m.autor_tipo = 'equipe' and pe.id = m.autor_id
      where m.atendimento_id = a.id
    )
  )
  from public.atendimentos a
  join public.clientes c on c.id = a.cliente_id
  left join public.departamentos d on d.id = a.setor_id
  left join public.contratos k on k.id = a.contrato_id
  where a.id = p_atendimento;
$$;
revoke all on function public.q_portal_chat_json(uuid) from public, anon, authenticated;

-- O atendimento ATIVO do cliente (no máximo um — o banco garante). Nulo = nenhum.
create or replace function public.portal_chat_ativo()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.q_portal_chat_json(a.id)
  from public.atendimentos a
  where a.cliente_id = public.q_cliente_da_sessao() and a.arquivado_em is null
  limit 1;
$$;

-- Um atendimento do cliente (o arquivado, somente leitura).
create or replace function public.portal_chat(p_atendimento uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.q_portal_chat_json(a.id)
  from public.atendimentos a
  where a.id = p_atendimento and a.cliente_id = public.q_cliente_da_sessao();
$$;

-- O robô: o cliente escolhe contrato e setor e descreve o pedido; o atendimento
-- nasce com as 8 mensagens do roteiro. As falas do ROBÔ são escritas AQUI, não
-- vêm da tela — senão o cliente poderia gravar qualquer coisa "dita pelo robô".
create or replace function public.portal_abrir_atendimento(p_contrato uuid, p_setor uuid, p_descricao text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cliente  uuid := public.q_cliente_da_sessao();
  v_contrato public.contratos;
  v_setor    text;
  v_rotulo   text;
  v_id       uuid;
  v_msgs     text[][];
  i          int;
begin
  if v_cliente is null then
    raise exception 'Sessão de cliente não encontrada.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_descricao, ''))) = 0 then
    raise exception 'Descreva o que você precisa.' using errcode = 'P0001';
  end if;

  select * into v_contrato from public.contratos
   where id = p_contrato and cliente_id = v_cliente and data_aceite is not null and cancelado_em is null;
  if not found then
    raise exception 'Contrato não encontrado.' using errcode = 'P0001';
  end if;

  select nome into v_setor from public.departamentos where id = p_setor and atende_chat and ativo;
  if v_setor is null then
    raise exception 'Setor não encontrado.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.atendimentos where cliente_id = v_cliente and arquivado_em is null) then
    raise exception 'Você já tem um atendimento em aberto.' using errcode = 'P0001';
  end if;

  -- "veículo ano (placa)", como no seletor do portal antigo; sem veículo, o nº.
  v_rotulo := coalesce(
    nullif(trim(concat_ws(' ', v_contrato.veiculo, v_contrato.ano_modelo,
                          case when v_contrato.placa is not null then '(' || v_contrato.placa || ')' end)), ''),
    'Contrato #' || v_contrato.numero);

  insert into public.atendimentos (cliente_id, contrato_id, setor_id, titulo, responsavel_id)
  values (v_cliente, v_contrato.id, p_setor, left(trim(p_descricao), 120), v_contrato.consultor_id)
  returning id into v_id;

  v_msgs := array[
    array['robo',    'Olá. Seja bem-vindo ao atendimento da Quadrum.'],
    array['robo',    'Para qual contrato você deseja atendimento?'],
    array['cliente', v_rotulo],
    array['robo',    'E com qual setor você deseja falar?'],
    array['cliente', v_setor],
    array['robo',    'Por favor, nos fale resumidamente como podemos ajudá-lo?'],
    array['cliente', trim(p_descricao)],
    array['robo',    'Obrigado por entrar em contato com a Quadrum. Sua solicitação foi encaminhada e em breve você receberá uma resposta por aqui.']
  ];
  -- Um milissegundo entre as falas: a ORDEM da conversa não pode depender de
  -- empate de relógio.
  for i in 1 .. array_length(v_msgs, 1) loop
    insert into public.atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo, created_at)
    values (v_id, v_msgs[i][1],
            case when v_msgs[i][1] = 'cliente' then v_cliente end,
            v_msgs[i][2], now() + (i * interval '1 millisecond'));
  end loop;

  return public.q_portal_chat_json(v_id);
end $$;

create or replace function public.portal_enviar_mensagem(p_atendimento uuid, p_corpo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cliente uuid := public.q_cliente_da_sessao();
begin
  if v_cliente is null or not exists (
    select 1 from public.atendimentos where id = p_atendimento and cliente_id = v_cliente
  ) then
    raise exception 'Atendimento não encontrado.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_corpo, ''))) = 0 then
    raise exception 'Mensagem vazia.' using errcode = 'P0001';
  end if;
  -- Atendimento arquivado: o gatilho `trg_mensagem_atendimento_aberto` recusa.
  insert into public.atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo)
  values (p_atendimento, 'cliente', v_cliente, trim(p_corpo));
  return public.q_portal_chat_json(p_atendimento);
end $$;

-- O cliente leu: marca as mensagens da EQUIPE como lidas.
create or replace function public.portal_marcar_chat_lido(p_atendimento uuid)
returns void language sql security definer set search_path = public as $$
  update public.atendimento_mensagens m
     set lida_em = now()
   where m.atendimento_id = p_atendimento
     and m.autor_tipo = 'equipe'
     and m.lida_em is null
     and exists (select 1 from public.atendimentos a
                 where a.id = p_atendimento and a.cliente_id = public.q_cliente_da_sessao());
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'portal_eu()', 'portal_contratos()', 'portal_avisos()', 'portal_marcar_historico_lido()',
    'portal_setores()', 'portal_chat_ativo()', 'portal_chat(uuid)',
    'portal_abrir_atendimento(uuid, uuid, text)', 'portal_enviar_mensagem(uuid, text)',
    'portal_marcar_chat_lido(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
