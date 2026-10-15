-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · ESCALA — busca, paginação e contagem no BANCO
--
-- Pedido do dono do processo em 15/10/2026: "revise o app pensando nele em
-- escala, pq do jeito que tá parece um app que vai atender 10 clientes só".
--
-- Até aqui cada tela baixava a carteira INTEIRA e filtrava no navegador. Com
-- 50 mil contratos isso é a aba travada, o plano de dados estourado e um
-- dropdown com 50 mil linhas. A partir daqui:
--
--   1. a TELA pede UMA página (20/50/100) e o banco devolve a página, o total
--      e as contagens dos filtros — numa chamada só (`q_*_pagina`);
--   2. a BUSCA roda no banco, sem acento e por palavra ("maria oliveira" acha
--      "Maria das Graças Oliveira"), sobre uma coluna já normalizada;
--   3. a PIPELINE traz só as primeiras N de cada coluna, com o total ao lado,
--      e "carregar mais" pede o resto;
--   4. as REGRAS DE ACESSO deixam de fazer uma consulta por linha: o "quem sou
--      eu" é calculado UMA vez por consulta (`(select …)`), e a carteira do
--      colaborador vira um conjunto (`in (select q_meus_*())`).
--
-- ⚠️ As funções de página são SECURITY INVOKER (o padrão): rodam com as
-- permissões de quem chama, então a RLS das tabelas vale nelas. Gestor vê
-- tudo, colaborador a carteira dele — sem a tela repetir a regra.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO 1 · busca sem acento e índices ═══════════════════════════════════

-- Normaliza para busca: minúsculas e sem acento. Imutável de propósito (vira
-- coluna gerada). `translate` em vez da extensão `unaccent`: unaccent não é
-- imutável e não pode alimentar coluna gerada.
create or replace function public.q_busca(p text)
returns text language sql immutable parallel safe as $$
  select lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$$;

-- "Todas as palavras do termo aparecem no alvo." Palavra só de dígitos e
-- pontuação de documento (123.456-7) vira só dígitos: o documento é gravado
-- sem máscara. Termo vazio casa com tudo.
create or replace function public.q_casa_busca(p_alvo text, p_termo text)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_termo, '') !~ '\S'
      or not exists (
        select 1
        from regexp_split_to_table(public.q_busca(trim(p_termo)), '\s+') w
        where w <> ''
          and position(
                case when w ~ '^[0-9./-]+$' then regexp_replace(w, '\D', '', 'g') else w end
                in coalesce(p_alvo, '')) = 0
      );
$$;

grant execute on function public.q_busca(text) to authenticated, service_role;
grant execute on function public.q_casa_busca(text, text) to authenticated, service_role;

-- O texto de busca do cliente, já normalizado e GRAVADO: a busca compara
-- texto pronto em vez de normalizar cada linha a cada tecla.
alter table public.clientes add column busca text generated always as (
  public.q_busca(nome) || ' ' || documento || ' ' || lower(coalesce(email, '')) || ' ' ||
  regexp_replace(coalesce(telefone, ''), '\D', '', 'g')
) stored;

-- Ordem estável das listas e os caminhos que as regras e as telas percorrem.
create index if not exists clientes_nome_id_idx on public.clientes (nome, id);
create index if not exists contratos_etapa_ordem_idx on public.contratos (etapa_id, etapa_desde, id);
create index if not exists atendimentos_responsavel_idx on public.atendimentos (responsavel_id);
create index if not exists atendimentos_cliente_idx on public.atendimentos (cliente_id);
create index if not exists atendimentos_contrato_idx on public.atendimentos (contrato_id);
create index if not exists atendimento_mensagens_nao_lidas_idx
  on public.atendimento_mensagens (atendimento_id) where autor_tipo = 'cliente' and lida_em is null;


-- ═══ BLOCO 2 · regras de acesso que escalam ════════════════════════════════
-- MESMA regra de antes (o teste confere caso a caso), escrita de outro jeito:
--   antes   q_ve_cliente(cliente_id)        → uma consulta POR LINHA
--   agora   cliente_id in (select q_meus_clientes())  → um conjunto por consulta
-- e `(select q_e_gestor())` em vez de `q_e_gestor()`: entre parênteses o
-- Postgres calcula uma vez e reaproveita (InitPlan), em vez de linha a linha.

-- A carteira do colaborador logado, como conjunto. Vazio para quem não é da
-- equipe (inclusive o cliente do portal).
create or replace function public.q_meus_clientes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clientes c
  where public.q_e_equipe() and c.consultor_id = auth.uid();
$$;

create or replace function public.q_meus_contratos()
returns setof uuid language sql stable security definer set search_path = public as $$
  select k.id from public.contratos k
  where public.q_e_equipe()
    and (k.consultor_id = auth.uid()
         or k.cliente_id in (select c.id from public.clientes c where c.consultor_id = auth.uid()));
$$;

create or replace function public.q_meus_atendimentos()
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.id from public.atendimentos a
  where public.q_e_equipe()
    and (a.responsavel_id = auth.uid()
         or a.cliente_id in (select c.id from public.clientes c where c.consultor_id = auth.uid()));
$$;

revoke execute on function public.q_meus_clientes()     from public, anon;
revoke execute on function public.q_meus_contratos()    from public, anon;
revoke execute on function public.q_meus_atendimentos() from public, anon;
grant execute on function public.q_meus_clientes()     to authenticated, service_role;
grant execute on function public.q_meus_contratos()    to authenticated, service_role;
grant execute on function public.q_meus_atendimentos() to authenticated, service_role;

-- Perfis
drop policy if exists perfis_equipe_le on public.perfis;
drop policy if exists perfis_gestor_cria on public.perfis;
drop policy if exists perfis_edita_o_proprio on public.perfis;
create policy perfis_equipe_le on public.perfis
  for select to authenticated using ((select public.q_e_equipe()));
create policy perfis_gestor_cria on public.perfis
  for insert to authenticated with check ((select public.q_e_gestor()));
create policy perfis_edita_o_proprio on public.perfis
  for update to authenticated
  using ((select public.q_e_gestor()) or (id = (select auth.uid()) and (select public.q_e_equipe())))
  with check ((select public.q_e_gestor()) or (id = (select auth.uid()) and (select public.q_e_equipe())));

-- Clientes — ⚠️ a leitura continua olhando a COLUNA (consultor_id), nunca uma
-- função que relê `clientes`: é o que deixa o RETURNING do cadastro passar.
drop policy if exists clientes_le on public.clientes;
drop policy if exists clientes_cria on public.clientes;
drop policy if exists clientes_altera on public.clientes;
create policy clientes_le on public.clientes
  for select to authenticated
  using ((select public.q_e_gestor()) or ((select public.q_e_equipe()) and consultor_id = (select auth.uid())));
create policy clientes_cria on public.clientes
  for insert to authenticated
  with check ((select public.q_e_gestor()) or ((select public.q_e_equipe()) and consultor_id = (select auth.uid())));
create policy clientes_altera on public.clientes
  for update to authenticated
  using ((select public.q_e_gestor()) or ((select public.q_e_equipe()) and consultor_id = (select auth.uid())))
  with check ((select public.q_e_gestor()) or ((select public.q_e_equipe()) and consultor_id = (select auth.uid())));

-- Contratos
drop policy if exists contratos_le on public.contratos;
drop policy if exists contratos_altera on public.contratos;
create policy contratos_le on public.contratos
  for select to authenticated
  using ((select public.q_e_gestor())
         or ((select public.q_e_equipe())
             and (consultor_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))));
create policy contratos_altera on public.contratos
  for update to authenticated
  using ((select public.q_e_gestor())
         or ((select public.q_e_equipe())
             and (consultor_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))))
  with check ((select public.q_e_gestor())
              or ((select public.q_e_equipe())
                  and (consultor_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))));

-- Histórico
drop policy if exists contrato_historico_le on public.contrato_historico;
create policy contrato_historico_le on public.contrato_historico
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

-- Documentos
drop policy if exists contrato_documentos_le on public.contrato_documentos;
drop policy if exists contrato_documentos_altera on public.contrato_documentos;
create policy contrato_documentos_le on public.contrato_documentos
  for select to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));
create policy contrato_documentos_altera on public.contrato_documentos
  for update to authenticated
  using ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()))
  with check ((select public.q_e_gestor()) or contrato_id in (select public.q_meus_contratos()));

-- Atendimentos
drop policy if exists atendimentos_le on public.atendimentos;
drop policy if exists atendimentos_altera on public.atendimentos;
create policy atendimentos_le on public.atendimentos
  for select to authenticated
  using ((select public.q_e_gestor())
         or ((select public.q_e_equipe())
             and (responsavel_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))));
create policy atendimentos_altera on public.atendimentos
  for update to authenticated
  using ((select public.q_e_gestor())
         or ((select public.q_e_equipe())
             and (responsavel_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))))
  with check ((select public.q_e_gestor())
              or ((select public.q_e_equipe())
                  and (responsavel_id = (select auth.uid()) or cliente_id in (select public.q_meus_clientes()))));

-- Mensagens
drop policy if exists atendimento_mensagens_le on public.atendimento_mensagens;
drop policy if exists atendimento_mensagens_marca_lida on public.atendimento_mensagens;
create policy atendimento_mensagens_le on public.atendimento_mensagens
  for select to authenticated
  using ((select public.q_e_gestor()) or atendimento_id in (select public.q_meus_atendimentos()));
create policy atendimento_mensagens_marca_lida on public.atendimento_mensagens
  for update to authenticated
  using ((select public.q_e_gestor()) or atendimento_id in (select public.q_meus_atendimentos()))
  with check ((select public.q_e_gestor()) or atendimento_id in (select public.q_meus_atendimentos()));


-- ═══ BLOCO 3 · as listas, prontas para a tela ══════════════════════════════
-- Views com `security_invoker`: a RLS das tabelas vale nelas.
-- ⚠️ Republicar SEMPRE com `with (security_invoker = true)` — sem ele a view
-- roda como dona e o colaborador vê a carteira inteira.

create or replace view public.contratos_lista with (security_invoker = true) as
select
  k.id, k.numero, k.cliente_id, k.etapa_id, k.etapa_desde, k.data_aceite,
  k.cancelado_em, k.motivo_cancelamento, k.veiculo, k.ano_modelo, k.placa,
  k.observacoes, k.consultor_id, k.banco_id, k.linha_credito_id,
  k.created_at, k.updated_at,
  -- Cliente de OUTRA carteira (o colaborador é consultor só do contrato):
  -- vem nulo, e a tela diz isso em vez de esconder o contrato.
  c.nome      as cliente_nome,
  c.documento as cliente_documento,
  c.telefone  as cliente_telefone,
  c.email     as cliente_email,
  c.user_id   as cliente_user_id,
  b.nome      as banco_nome,
  l.nome      as linha_nome,
  l.tem_veiculo as linha_tem_veiculo,
  p.nome      as consultor_nome,
  p.avatar_url as consultor_avatar,
  e.nome      as etapa_nome,
  e.cor       as etapa_cor,
  e.ordem     as etapa_ordem,
  case when k.cancelado_em is not null then 'perdido'
       when k.data_aceite is not null then 'portal'
       else 'andamento' end as situacao,
  concat_ws(' ', c.busca, lower(k.placa), '#' || k.numero) as busca
from public.contratos k
left join public.clientes c on c.id = k.cliente_id
left join public.bancos b on b.id = k.banco_id
left join public.linhas_credito l on l.id = k.linha_credito_id
left join public.perfis p on p.id = k.consultor_id
left join public.pipeline_etapas e on e.id = k.etapa_id;

create or replace view public.clientes_lista with (security_invoker = true) as
select
  c.id, c.documento, c.tipo_pessoa, c.nome, c.email, c.telefone, c.consultor_id,
  c.user_id, c.created_at, c.busca,
  p.nome as consultor_nome,
  coalesce(n.ativos, 0)   as contratos_ativos,
  coalesce(n.perdidos, 0) as contratos_perdidos
from public.clientes c
left join public.perfis p on p.id = c.consultor_id
left join lateral (
  select count(*) filter (where k.cancelado_em is null)     as ativos,
         count(*) filter (where k.cancelado_em is not null) as perdidos
  from public.contratos k where k.cliente_id = c.id
) n on true;

-- A caixa ganha a busca e a ordem "conversa viva sobe". ⚠️ Coluna nova em
-- `create or replace view` só entra no FIM (no meio: 42P16).
create or replace view public.atendimentos_caixa
with (security_invoker = true) as
select
  a.id, a.numero, a.titulo, a.cliente_id, a.contrato_id, a.setor_id,
  a.responsavel_id, a.arquivado_em, a.created_at,
  coalesce(c.nome, 'Cliente de outra carteira') as cliente_nome,
  coalesce(c.documento, '')                    as cliente_documento,
  k.numero    as contrato_numero,
  d.nome      as setor_nome,
  r.nome      as responsavel_nome,
  u.corpo      as ultima_corpo,
  u.autor_tipo as ultima_autor_tipo,
  u.created_at as ultima_em,
  (select count(*) from public.atendimento_mensagens m
    where m.atendimento_id = a.id and m.autor_tipo = 'cliente' and m.lida_em is null)::int as nao_lidas,
  concat_ws(' ', c.busca, public.q_busca(a.titulo), '#' || a.numero) as busca,
  coalesce(u.created_at, a.created_at) as ordem_em
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

revoke all on public.contratos_lista, public.clientes_lista, public.atendimentos_caixa from anon;
grant select on public.contratos_lista, public.clientes_lista, public.atendimentos_caixa to authenticated;


-- ═══ BLOCO 4 · uma página por chamada ══════════════════════════════════════
-- Cada função devolve { linhas, contagem } — a página pedida e os números de
-- cada filtro, calculados sobre a MESMA busca. Um lugar só decide o que casa
-- com a busca: a página e o contador não têm como discordar.
-- `p_por` vai até 100; página fora do fim devolve lista vazia, nunca erro.

create or replace function public.q_contratos_pagina(
  p_busca text default '', p_etapa uuid default null, p_consultor uuid default null,
  p_situacao text default 'todos', p_pagina int default 1, p_por int default 20
)
returns jsonb language sql stable as $$
  with base as materialized (
    select l.* from public.contratos_lista l
    where (p_etapa is null or l.etapa_id = p_etapa)
      and (p_consultor is null or l.consultor_id = p_consultor)
      and public.q_casa_busca(l.busca, p_busca)
  ),
  tam as (select least(greatest(coalesce(p_por, 20), 1), 100) as por,
                 greatest(coalesce(p_pagina, 1), 1) as pagina)
  select jsonb_build_object(
    'contagem', (select jsonb_build_object(
        'todos',     count(*),
        'ativos',    count(*) filter (where situacao <> 'perdido'),
        'andamento', count(*) filter (where situacao = 'andamento'),
        'portal',    count(*) filter (where situacao = 'portal'),
        'perdido',   count(*) filter (where situacao = 'perdido'))
      from base),
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(x) - 'busca' order by x.numero desc)
      from (
        select b.* from base b, tam
        where coalesce(p_situacao, 'todos') = 'todos'
           or b.situacao = p_situacao
           or (p_situacao = 'ativos' and b.situacao <> 'perdido')
        order by b.numero desc
        limit (select por from tam) offset (select (pagina - 1) * por from tam)
      ) x), '[]'::jsonb)
  );
$$;

create or replace function public.q_clientes_pagina(
  p_busca text default '', p_portal text default 'todos', p_consultor uuid default null,
  p_pagina int default 1, p_por int default 20
)
returns jsonb language sql stable as $$
  with base as materialized (
    select c.id, c.user_id from public.clientes c
    where (p_consultor is null or c.consultor_id = p_consultor)
      and public.q_casa_busca(c.busca, p_busca)
  ),
  tam as (select least(greatest(coalesce(p_por, 20), 1), 100) as por,
                 greatest(coalesce(p_pagina, 1), 1) as pagina),
  pagina as (
    select l.* from public.clientes_lista l
    where l.id in (
      select b.id from base b
      where coalesce(p_portal, 'todos') = 'todos'
         or (p_portal = 'com' and b.user_id is not null)
         or (p_portal = 'sem' and b.user_id is null))
    order by l.nome, l.id
    limit (select por from tam) offset (select (pagina - 1) * por from tam)
  )
  select jsonb_build_object(
    'contagem', (select jsonb_build_object(
        'todos', count(*),
        'com',   count(*) filter (where user_id is not null),
        'sem',   count(*) filter (where user_id is null))
      from base),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x) - 'busca' order by x.nome, x.id) from pagina x), '[]'::jsonb)
  );
$$;

create or replace function public.q_caixa_pagina(
  p_busca text default '', p_setor uuid default null, p_aba text default 'abertos',
  p_pagina int default 1, p_por int default 20
)
returns jsonb language sql stable as $$
  with base as materialized (
    select l.* from public.atendimentos_caixa l
    where (p_setor is null or l.setor_id = p_setor)
      and public.q_casa_busca(l.busca, p_busca)
  ),
  tam as (select least(greatest(coalesce(p_por, 20), 1), 100) as por,
                 greatest(coalesce(p_pagina, 1), 1) as pagina)
  select jsonb_build_object(
    'contagem', (select jsonb_build_object(
        'abertos',    count(*) filter (where arquivado_em is null),
        'nao_lidas',  count(*) filter (where arquivado_em is null and nao_lidas > 0),
        'arquivados', count(*) filter (where arquivado_em is not null))
      from base),
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(x) - 'busca' order by x.ordem_em desc, x.id)
      from (
        select b.* from base b
        where case coalesce(p_aba, 'abertos')
                when 'arquivados' then b.arquivado_em is not null
                when 'nao_lidas'  then b.arquivado_em is null and b.nao_lidas > 0
                else b.arquivado_em is null end
        order by b.ordem_em desc, b.id
        limit (select por from tam) offset (select (pagina - 1) * por from tam)
      ) x), '[]'::jsonb)
  );
$$;

-- A pipeline: as primeiras `p_padrao` de cada coluna (as paradas há mais
-- tempo primeiro), mais o TOTAL de cada uma. `p_limites` aumenta uma coluna
-- só ({"<etapa_id>": 60}) — é o "carregar mais".
create or replace function public.q_pipeline(
  p_busca text default '', p_perdidos boolean default false,
  p_padrao int default 30, p_limites jsonb default '{}'::jsonb
)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'perdidos', (select count(*) from public.contratos_lista l
                 where l.cancelado_em is not null and public.q_casa_busca(l.busca, p_busca)),
    'colunas', coalesce(jsonb_agg(jsonb_build_object(
        'etapa_id', e.id, 'total', t.total, 'cards', t.cards)
      order by e.ordem, e.nome), '[]'::jsonb)
  )
  from public.pipeline_etapas e
  cross join lateral (
    select
      (select count(*) from public.contratos_lista l
        where l.etapa_id = e.id and (p_perdidos or l.cancelado_em is null)
          and public.q_casa_busca(l.busca, p_busca)) as total,
      coalesce((
        select jsonb_agg(to_jsonb(x) - 'busca' order by x.etapa_desde, x.id)
        from (
          select l.* from public.contratos_lista l
          where l.etapa_id = e.id and (p_perdidos or l.cancelado_em is null)
            and public.q_casa_busca(l.busca, p_busca)
          order by l.etapa_desde, l.id
          limit least(greatest(coalesce((p_limites ->> e.id::text)::int, p_padrao, 30), 1), 500)
        ) x), '[]'::jsonb) as cards
  ) t;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'q_contratos_pagina(text, uuid, uuid, text, int, int)',
    'q_clientes_pagina(text, text, uuid, int, int)',
    'q_caixa_pagina(text, uuid, text, int, int)',
    'q_pipeline(text, boolean, int, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
