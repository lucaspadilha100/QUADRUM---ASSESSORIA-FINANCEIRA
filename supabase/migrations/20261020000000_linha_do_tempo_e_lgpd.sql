-- ─────────────────────────────────────────────────────────────────────────────
-- LINHA DO TEMPO DE ETAPAS e LGPD (termo de privacidade + exportar dados)
--
-- Pedido do dono do processo (16/10/2026):
--   8. quem moveu o card, de qual etapa para qual e quando — e quanto tempo
--      cada etapa leva;
--  10. termo de privacidade aceito no primeiro acesso ao portal (o texto
--      aceito fica gravado) e exportar os dados de um cliente quando ele pedir.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ BLOCO 1 · a linha do tempo do contrato ═════════════════════════════════
-- Quem grava é o BANCO (gatilho), por qualquer caminho que mude a etapa ou o
-- cancelamento: arrastar o card, o select do painel, o SQL Editor.
create table if not exists public.contrato_movimentos (
  id             uuid primary key default gen_random_uuid(),
  contrato_id    uuid not null references public.contratos(id) on delete restrict,
  tipo           text not null check (tipo in ('criado', 'etapa', 'perdido', 'reaberto')),
  de_etapa_id    uuid references public.pipeline_etapas(id),
  para_etapa_id  uuid references public.pipeline_etapas(id),
  autor_id       uuid,
  motivo         text,
  -- Linha remontada a partir do estado atual (contratos anteriores a esta
  -- migração): a data é a melhor conhecida, o autor não se sabe.
  reconstituido  boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists contrato_movimentos_contrato_idx
  on public.contrato_movimentos (contrato_id, created_at, id);

alter table public.contrato_movimentos enable row level security;
revoke all on public.contrato_movimentos from anon;
revoke insert, update, delete on public.contrato_movimentos from authenticated;
drop policy if exists contrato_movimentos_le on public.contrato_movimentos;
create policy contrato_movimentos_le on public.contrato_movimentos
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

create or replace function public.q_registra_movimento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contrato_movimentos (contrato_id, tipo, para_etapa_id, autor_id)
    values (new.id, 'criado', new.etapa_id, auth.uid());
    return null;
  end if;
  if new.etapa_id is distinct from old.etapa_id then
    insert into public.contrato_movimentos (contrato_id, tipo, de_etapa_id, para_etapa_id, autor_id)
    values (new.id, 'etapa', old.etapa_id, new.etapa_id, auth.uid());
  end if;
  if old.cancelado_em is null and new.cancelado_em is not null then
    insert into public.contrato_movimentos (contrato_id, tipo, de_etapa_id, autor_id, motivo)
    values (new.id, 'perdido', new.etapa_id, auth.uid(), new.motivo_cancelamento);
  elsif old.cancelado_em is not null and new.cancelado_em is null then
    insert into public.contrato_movimentos (contrato_id, tipo, para_etapa_id, autor_id)
    values (new.id, 'reaberto', new.etapa_id, auth.uid());
  end if;
  return null;
end $$;
revoke execute on function public.q_registra_movimento() from public, anon, authenticated;

drop trigger if exists trg_registra_movimento on public.contratos;
create trigger trg_registra_movimento
  after insert or update of etapa_id, cancelado_em on public.contratos
  for each row execute function public.q_registra_movimento();

-- Contratos que já existiam: entram com o que se sabe (desde quando estão na
-- etapa atual e, se perdidos, quando).
insert into public.contrato_movimentos (contrato_id, tipo, para_etapa_id, reconstituido, created_at)
select k.id, 'criado', k.etapa_id, true, k.etapa_desde
  from public.contratos k
 where not exists (select 1 from public.contrato_movimentos m where m.contrato_id = k.id);
insert into public.contrato_movimentos (contrato_id, tipo, de_etapa_id, motivo, reconstituido, created_at)
select k.id, 'perdido', k.etapa_id, k.motivo_cancelamento, true, k.cancelado_em
  from public.contratos k
 where k.cancelado_em is not null
   and not exists (select 1 from public.contrato_movimentos m where m.contrato_id = k.id and m.tipo = 'perdido');

-- Quanto tempo cada etapa leva: a média das PASSAGENS concluídas nos últimos
-- `p_dias` (entrou na etapa → saiu dela). SECURITY INVOKER: o colaborador
-- mede só a própria carteira, pela RLS.
create or replace function public.q_tempo_por_etapa(p_dias int default 90)
returns jsonb language sql stable set search_path = public as $$
  with m as (
    select contrato_id, tipo, de_etapa_id, para_etapa_id, created_at,
           lag(created_at) over (partition by contrato_id order by created_at, id) as anterior
      from public.contrato_movimentos
  )
  select coalesce(jsonb_agg(jsonb_build_object('etapa_id', x.etapa_id, 'media_dias', x.media, 'passagens', x.n)), '[]'::jsonb)
  from (
    select de_etapa_id as etapa_id,
           round((avg(extract(epoch from (created_at - anterior))) / 86400)::numeric, 1) as media,
           count(*) as n
      from m
     where tipo = 'etapa' and anterior is not null
       and created_at >= now() - make_interval(days => greatest(coalesce(p_dias, 90), 1))
     group by de_etapa_id
  ) x
$$;
grant execute on function public.q_tempo_por_etapa(int) to authenticated, service_role;

-- O admin escuta a linha do tempo ao vivo (useAoVivo: as listas batem).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contrato_movimentos') then
    execute 'alter publication supabase_realtime add table public.contrato_movimentos';
  end if;
end $$;


-- ═══ BLOCO 2 · termo de privacidade (LGPD) ══════════════════════════════════
-- Versionado como os modelos de documento: o texto de uma versão NUNCA muda
-- (é o que o cliente aceitou); mudar o termo é publicar versão nova, e todo
-- cliente aceita de novo no próximo acesso. Uma versão ativa por vez.
create table if not exists public.privacidade_termos (
  id            uuid primary key default gen_random_uuid(),
  versao        bigint generated always as identity unique,
  titulo        text not null,
  texto         text not null check (length(trim(texto)) > 0),
  ativo         boolean not null default false,
  publicado_em  timestamptz,
  criado_por    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index if not exists privacidade_um_ativo on public.privacidade_termos ((true)) where ativo;

alter table public.privacidade_termos enable row level security;
revoke all on public.privacidade_termos from anon;
drop policy if exists privacidade_termos_le on public.privacidade_termos;
create policy privacidade_termos_le on public.privacidade_termos
  for select to authenticated using ((select public.q_e_equipe()));
drop policy if exists privacidade_termos_cria on public.privacidade_termos;
create policy privacidade_termos_cria on public.privacidade_termos
  for insert to authenticated with check ((select public.q_e_gestor()));
revoke update, delete on public.privacidade_termos from authenticated;

create or replace function public.q_privacidade_protege()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.texto is distinct from old.texto or new.titulo is distinct from old.titulo) then
    raise exception 'O texto de uma versão publicada não muda. Crie uma versão nova.' using errcode = 'P0001';
  end if;
  if new.ativo and new.texto ~ '\[PREENCHER' then
    raise exception 'O termo ainda tem campos [PREENCHER…]. Complete antes de publicar.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_privacidade_protege on public.privacidade_termos;
create trigger trg_privacidade_protege before insert or update on public.privacidade_termos
  for each row execute function public.q_privacidade_protege();

-- Publicar = esta versão vira a ativa (e a anterior sai). Só gestor.
create or replace function public.q_privacidade_publicar(p_termo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor publica o termo.' using errcode = '42501';
  end if;
  update public.privacidade_termos set ativo = false where ativo and id <> p_termo;
  update public.privacidade_termos set ativo = true, publicado_em = coalesce(publicado_em, now()) where id = p_termo;
  if not found then raise exception 'Termo não encontrado.' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.q_privacidade_publicar(uuid) from public, anon;
grant execute on function public.q_privacidade_publicar(uuid) to authenticated, service_role;

create or replace function public.q_privacidade_desativar()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor desativa o termo.' using errcode = '42501';
  end if;
  update public.privacidade_termos set ativo = false where ativo;
end $$;
revoke execute on function public.q_privacidade_desativar() from public, anon;
grant execute on function public.q_privacidade_desativar() to authenticated, service_role;

-- O aceite: a prova, como na assinatura (IP e navegador dos cabeçalhos, hash
-- do texto aceito, hora do servidor). Sem regra de escrita para ninguém.
create table if not exists public.privacidade_aceites (
  id          uuid primary key default gen_random_uuid(),
  termo_id    uuid not null references public.privacidade_termos(id),
  cliente_id  uuid not null references public.clientes(id),
  user_id     uuid not null,
  texto_hash  text not null,
  ip          text,
  user_agent  text,
  requisicao  jsonb,
  aceito_em   timestamptz not null default now(),
  unique (termo_id, cliente_id)
);
alter table public.privacidade_aceites enable row level security;
revoke all on public.privacidade_aceites from anon;
revoke insert, update, delete on public.privacidade_aceites from authenticated;
drop policy if exists privacidade_aceites_le on public.privacidade_aceites;
create policy privacidade_aceites_le on public.privacidade_aceites
  for select to authenticated
  using ((select public.q_e_gestor()) or cliente_id in (select public.q_meus_clientes()));

-- Portal: o termo que falta aceitar (nulo = nada a aceitar).
create or replace function public.portal_privacidade()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'versao', t.versao, 'titulo', t.titulo, 'texto', t.texto,
           'aceito_em', a.aceito_em)
    from public.privacidade_termos t
    left join public.privacidade_aceites a on a.termo_id = t.id and a.cliente_id = public.q_cliente_da_sessao()
   where t.ativo and public.q_cliente_da_sessao() is not null
$$;
revoke execute on function public.portal_privacidade() from public, anon;
grant execute on function public.portal_privacidade() to authenticated, service_role;

create or replace function public.portal_aceitar_privacidade(p_termo uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cliente uuid := public.q_cliente_da_sessao();
  v_texto   text;
  v_req     jsonb := public.q_requisicao();
begin
  if v_cliente is null then
    raise exception 'Entre no portal para aceitar.' using errcode = '42501';
  end if;
  select texto into v_texto from public.privacidade_termos where id = p_termo and ativo;
  if v_texto is null then
    raise exception 'Este termo não está mais em vigor. Recarregue a página.' using errcode = 'P0001';
  end if;
  insert into public.privacidade_aceites (termo_id, cliente_id, user_id, texto_hash, ip, user_agent, requisicao)
  values (p_termo, v_cliente, auth.uid(), encode(extensions.digest(convert_to(v_texto, 'UTF8'), 'sha256'), 'hex'),
          v_req ->> 'ip', v_req ->> 'user_agent', v_req)
  on conflict (termo_id, cliente_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.portal_aceitar_privacidade(uuid) from public, anon;
grant execute on function public.portal_aceitar_privacidade(uuid) to authenticated, service_role;

-- Versão de partida, INATIVA: o jurídico completa os [PREENCHER…] e o gestor
-- publica. Enquanto não houver versão ativa, o portal não pede aceite.
insert into public.privacidade_termos (titulo, texto)
select 'Política de Privacidade e Tratamento de Dados',
$t$# POLÍTICA DE PRIVACIDADE E TRATAMENTO DE DADOS PESSOAIS

A QUADRUM ASSESSORIA FINANCEIRA, inscrita no CNPJ sob o nº [PREENCHER CNPJ], com sede em [PREENCHER ENDEREÇO], Natal/RN ("Quadrum"), trata os seus dados pessoais conforme a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD).

**1. Quais dados tratamos.** Nome, CPF ou CNPJ, RG, estado civil, profissão, data de nascimento, endereço, telefone, e-mail, dados dos contratos e dívidas que você nos confiou (banco credor, linha de crédito, valores, veículo e placa, quando houver), mensagens trocadas no atendimento e registros de acesso a este portal (data, hora, endereço IP e navegador).

**2. Para que usamos.** Para prestar o serviço contratado de assessoria financeira: analisar a sua situação, negociar com os credores em seu nome, preparar e registrar os documentos necessários, manter você informado sobre o andamento e cumprir obrigações legais. A base legal é a execução do contrato e o cumprimento de obrigação legal (LGPD, art. 7º, II e V).

**3. Com quem compartilhamos.** Com os bancos e credores envolvidos na negociação, na medida necessária para representá-lo; com prestadores de serviço que operam este sistema (hospedagem e banco de dados), sob dever de sigilo; e com autoridades, quando a lei exigir. Não vendemos os seus dados.

**4. Por quanto tempo guardamos.** Enquanto durar a prestação do serviço e, depois, pelo prazo necessário para cumprir obrigações legais e para o exercício regular de direitos.

**5. Seus direitos.** Você pode pedir confirmação do tratamento, acesso, correção, cópia dos seus dados, informação sobre compartilhamento e, quando cabível, eliminação ou anonimização (LGPD, art. 18), pelo contato abaixo.

**6. Segurança.** Os seus dados ficam em ambiente protegido, com acesso restrito à equipe responsável pelo seu atendimento.

**7. Contato do encarregado (DPO):** [PREENCHER NOME E E-MAIL DO ENCARREGADO].

Ao clicar em "Aceitar", você declara que leu e concorda com esta Política.$t$
where not exists (select 1 from public.privacidade_termos);


-- ═══ BLOCO 3 · exportar os dados de um cliente (LGPD, art. 18) ══════════════
-- Tudo o que o sistema guarda sobre a pessoa, num arquivo só. Só o gestor, e
-- cada exportação fica registrada (quem, quando).
create table if not exists public.lgpd_exportacoes (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id),
  exportado_por  uuid not null,
  created_at     timestamptz not null default now()
);
alter table public.lgpd_exportacoes enable row level security;
revoke all on public.lgpd_exportacoes from anon;
revoke insert, update, delete on public.lgpd_exportacoes from authenticated;
drop policy if exists lgpd_exportacoes_le on public.lgpd_exportacoes;
create policy lgpd_exportacoes_le on public.lgpd_exportacoes
  for select to authenticated using ((select public.q_e_gestor()));

create or replace function public.q_cliente_exportar(p_cliente uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record;
  v jsonb;
begin
  if not public.q_e_gestor() then
    raise exception 'Só um gestor exporta os dados de um cliente.' using errcode = '42501';
  end if;
  select * into c from public.clientes where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.' using errcode = 'P0001'; end if;

  v := jsonb_build_object(
    'gerado_em', now(),
    'cliente', to_jsonb(c) - 'busca',
    'contratos', (select coalesce(jsonb_agg(to_jsonb(k) || jsonb_build_object(
        'etapa', (select nome from public.pipeline_etapas where id = k.etapa_id),
        'banco', (select nome from public.bancos where id = k.banco_id),
        'linha_credito', (select nome from public.linhas_credito where id = k.linha_credito_id),
        'historico', (select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at), '[]'::jsonb) from public.contrato_historico h where h.contrato_id = k.id),
        'movimentos', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) from public.contrato_movimentos m where m.contrato_id = k.id),
        'documentos', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
            'assinatura', (select to_jsonb(a) from public.documento_assinaturas a where a.documento_id = d.id),
            'eventos', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb) from public.documento_eventos e where e.documento_id = d.id))
          order by d.created_at), '[]'::jsonb) from public.contrato_documentos d where d.contrato_id = k.id)
      ) order by k.numero), '[]'::jsonb) from public.contratos k where k.cliente_id = c.id),
    'atendimentos', (select coalesce(jsonb_agg(to_jsonb(at) || jsonb_build_object(
        'mensagens', (select coalesce(jsonb_agg(to_jsonb(mm) order by mm.created_at, mm.id), '[]'::jsonb) from public.atendimento_mensagens mm where mm.atendimento_id = at.id))
      order by at.created_at), '[]'::jsonb) from public.atendimentos at where at.cliente_id = c.id),
    'privacidade_aceites', (select coalesce(jsonb_agg(to_jsonb(pa) || jsonb_build_object('versao', t.versao, 'texto', t.texto) order by pa.aceito_em), '[]'::jsonb)
      from public.privacidade_aceites pa join public.privacidade_termos t on t.id = pa.termo_id where pa.cliente_id = c.id),
    'notificacoes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at), '[]'::jsonb) from public.notificacoes n where c.user_id is not null and n.destinatario = c.user_id)
  );
  insert into public.lgpd_exportacoes (cliente_id, exportado_por) values (c.id, auth.uid());
  return v;
end $$;
revoke execute on function public.q_cliente_exportar(uuid) from public, anon;
grant execute on function public.q_cliente_exportar(uuid) to authenticated, service_role;
