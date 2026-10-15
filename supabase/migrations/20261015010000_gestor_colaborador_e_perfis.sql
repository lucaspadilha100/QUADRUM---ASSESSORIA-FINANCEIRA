-- ════════════════════════════════════════════════════════════════════════════
-- Quadrum · GESTOR e COLABORADOR, e o perfil de cada pessoa
--
-- Pedido do dono do processo em 15/10/2026, logo depois da estrutura inicial
-- ir ao ar: "cada pessoa vai ter seu perfil… já cria o sistema com a ideia de
-- gestor e colaborador". O cliente do portal é usuário comum, sem essa regra.
--
--   GESTOR       vê e opera tudo; mantém cadastros, usuários e transfere carteira
--   COLABORADOR  vê só a PRÓPRIA carteira: clientes de que é o consultor, e o
--                que pende deles (contratos, histórico, documentos, atendimentos)
--                — mais o atendimento em que for o responsável
--
-- Sem matriz de telas: o NÍVEL decide.
--
-- Roda em cima da 20261015000000 (já aplicada). Com o banco ainda vazio de
-- gente, renomear é seguro; o BLOCO A confere isso antes.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ BLOCO A · mede (só lê) ═════════════════════════════════════════════════
-- select (select count(*) from public.equipe)   as pessoas,
--        (select count(*) from public.clientes) as clientes;
-- Esperado: 0 · 0.


-- ═══ BLOCO B · `equipe` vira `perfis`, `membro` vira `colaborador` ═════════

alter table public.equipe rename to perfis;
alter index public.equipe_pkey rename to perfis_pkey;
alter table public.perfis rename constraint equipe_id_fkey to perfis_id_fkey;
alter table public.perfis rename constraint equipe_unidade_id_fkey to perfis_unidade_id_fkey;
alter trigger trg_equipe_updated_at on public.perfis rename to trg_perfis_updated_at;

alter table public.perfis drop constraint equipe_papel_check;
update public.perfis set papel = 'colaborador' where papel = 'membro';
alter table public.perfis alter column papel set default 'colaborador';
alter table public.perfis add constraint perfis_papel_check check (papel in ('gestor', 'colaborador'));

alter table public.perfis add column cargo text;        -- rótulo livre; NÃO dá acesso
alter table public.perfis add column avatar_url text;

comment on table public.perfis is
  'O perfil de cada pessoa da EQUIPE. Estar autenticado não é ser da equipe: é ter linha aqui, ativa. Cliente do portal não tem perfil — mora em `clientes`.';
comment on column public.perfis.papel is
  'GESTOR vê e opera tudo e mantém cadastros/usuários. COLABORADOR vê só a própria carteira. Quem decide é o nível, não uma matriz de telas.';

-- O consultor é o DONO da carteira — é o que o colaborador enxerga. Nasce com
-- quem cadastrou; só o gestor transfere.
alter table public.clientes  alter column consultor_id set default auth.uid();
alter table public.contratos alter column consultor_id set default auth.uid();
create index clientes_consultor_idx  on public.clientes (consultor_id);
create index contratos_consultor_idx on public.contratos (consultor_id);


-- ═══ BLOCO C · funções ══════════════════════════════════════════════════════

-- ⚠️ Corpo de função SQL guarda o NOME da tabela em texto: depois do rename
-- estas duas ainda apontavam `public.equipe`, que não existe mais. Recriar
-- não é enfeite.
create or replace function public.q_e_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

create or replace function public.q_e_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'gestor');
$$;

-- O que um colaborador ENXERGA, encadeado: cliente → contrato → histórico/
-- documento; cliente → atendimento → mensagem. Gestor vê tudo.
create or replace function public.q_ve_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.q_e_gestor()
      or (public.q_e_equipe()
          and exists (select 1 from public.clientes c
                      where c.id = p_cliente and c.consultor_id = auth.uid()));
$$;

create or replace function public.q_ve_contrato(p_contrato uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.q_e_gestor()
      or (public.q_e_equipe()
          and exists (select 1 from public.contratos k
                      where k.id = p_contrato
                        and (k.consultor_id = auth.uid() or public.q_ve_cliente(k.cliente_id))));
$$;

create or replace function public.q_ve_atendimento(p_atendimento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.q_e_gestor()
      or (public.q_e_equipe()
          and exists (select 1 from public.atendimentos a
                      where a.id = p_atendimento
                        and (a.responsavel_id = auth.uid() or public.q_ve_cliente(a.cliente_id))));
$$;

revoke execute on function public.q_ve_cliente(uuid)     from public, anon;
revoke execute on function public.q_ve_contrato(uuid)    from public, anon;
revoke execute on function public.q_ve_atendimento(uuid) from public, anon;
grant execute on function public.q_ve_cliente(uuid)     to authenticated, service_role;
grant execute on function public.q_ve_contrato(uuid)    to authenticated, service_role;
grant execute on function public.q_ve_atendimento(uuid) to authenticated, service_role;

-- NINGUÉM MUDA O PRÓPRIO NÍVEL. Cada um edita o próprio perfil (nome, foto,
-- telefone, cargo), mas papel, ativo, unidade e e-mail são do gestor. Sem
-- isso, um colaborador se daria `papel = 'gestor'` pelo PostgREST e passaria
-- a ver a carteira inteira. Recusa FALANDO, nunca reverte calado.
-- Sem usuário (SQL Editor, service role) passa: é quem administra.
create or replace function public.q_perfil_protege_acesso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.q_e_gestor() then
    return new;
  end if;
  if new.papel is distinct from old.papel
     or new.ativo is distinct from old.ativo
     or new.unidade_id is distinct from old.unidade_id
     or new.email is distinct from old.email then
    raise exception 'Só um gestor muda nível, unidade, e-mail ou ativação de um perfil.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_protege_acesso() from public, anon;

create trigger trg_perfil_protege_acesso
  before update on public.perfis
  for each row execute function public.q_perfil_protege_acesso();


-- ═══ BLOCO D · regras de acesso ═════════════════════════════════════════════
-- Sai TODA regra das tabelas de carteira, atendimento e perfis, e entra a nova.
-- Os cadastros de apoio (unidades, bancos, linhas, departamentos, tipos de
-- documento) não mudam: equipe lê, gestor mantém.
--
-- ⚠️ Duas armadilhas, as duas medidas no teste:
--   1. A regra de LEITURA da própria tabela olha a COLUNA, nunca uma função
--      que relê a tabela. O Supabase devolve a linha recém-gravada (RETURNING)
--      e confere a leitura dela — e a função ainda não enxerga a linha que
--      está nascendo. Resultado: "new row violates row-level security" ao
--      cadastrar um cliente que a pessoa tinha todo o direito de cadastrar.
--   2. No WITH CHECK do UPDATE, a mesma coisa: só a coluna da linha NOVA diz
--      para quem ela está indo. É isso que impede o colaborador de "passar"
--      um cliente para outra pessoa — só o gestor transfere.

do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('perfis','clientes','contratos','contrato_historico',
                        'contrato_documentos','atendimentos','atendimento_mensagens')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Perfis: a equipe vê a equipe (nome de autor, consultor, responsável). Cada
-- um edita o PRÓPRIO — o gatilho segura o nível. Gestor cria e edita todos.
create policy perfis_equipe_le on public.perfis
  for select to authenticated using (public.q_e_equipe());
create policy perfis_gestor_cria on public.perfis
  for insert to authenticated with check (public.q_e_gestor());
create policy perfis_edita_o_proprio on public.perfis
  for update to authenticated
  using (public.q_e_gestor() or (id = auth.uid() and public.q_e_equipe()))
  with check (public.q_e_gestor() or (id = auth.uid() and public.q_e_equipe()));

-- Clientes: o colaborador vê, cadastra e edita os SEUS.
create policy clientes_le on public.clientes
  for select to authenticated
  using (public.q_e_gestor() or (public.q_e_equipe() and consultor_id = auth.uid()));
create policy clientes_cria on public.clientes
  for insert to authenticated
  with check (public.q_e_gestor() or (public.q_e_equipe() and consultor_id = auth.uid()));
create policy clientes_altera on public.clientes
  for update to authenticated
  using (public.q_e_gestor() or (public.q_e_equipe() and consultor_id = auth.uid()))
  with check (public.q_e_gestor() or (public.q_e_equipe() and consultor_id = auth.uid()));

-- Contratos: do cliente que vê, ou em que é o consultor.
create policy contratos_le on public.contratos
  for select to authenticated
  using (public.q_e_gestor()
         or (public.q_e_equipe() and (consultor_id = auth.uid() or public.q_ve_cliente(cliente_id))));
-- Criar exige ENXERGAR o cliente: sem isso, um colaborador abriria contrato
-- para o cliente de outro só se pondo como consultor dele.
create policy contratos_cria on public.contratos
  for insert to authenticated
  with check (public.q_ve_cliente(cliente_id));
create policy contratos_altera on public.contratos
  for update to authenticated
  using (public.q_e_gestor()
         or (public.q_e_equipe() and (consultor_id = auth.uid() or public.q_ve_cliente(cliente_id))))
  with check (public.q_e_gestor()
              or (public.q_e_equipe() and (consultor_id = auth.uid() or public.q_ve_cliente(cliente_id))));

-- Histórico: lança no PRÓPRIO nome, em contrato que vê. Corrigir ou tirar uma
-- ocorrência é do gestor — é o que o cliente leu.
create policy contrato_historico_le on public.contrato_historico
  for select to authenticated using (public.q_ve_contrato(contrato_id));
create policy contrato_historico_cria on public.contrato_historico
  for insert to authenticated
  with check (public.q_ve_contrato(contrato_id) and autor_id = auth.uid());
create policy contrato_historico_gestor_altera on public.contrato_historico
  for update to authenticated using (public.q_e_gestor()) with check (public.q_e_gestor());
create policy contrato_historico_gestor_remove on public.contrato_historico
  for delete to authenticated using (public.q_e_gestor());

-- Documentos para assinar: de contrato que vê.
create policy contrato_documentos_le on public.contrato_documentos
  for select to authenticated using (public.q_ve_contrato(contrato_id));
create policy contrato_documentos_cria on public.contrato_documentos
  for insert to authenticated with check (public.q_ve_contrato(contrato_id));
create policy contrato_documentos_altera on public.contrato_documentos
  for update to authenticated
  using (public.q_ve_contrato(contrato_id)) with check (public.q_ve_contrato(contrato_id));

-- Atendimentos: do cliente que vê, ou em que é o responsável.
create policy atendimentos_le on public.atendimentos
  for select to authenticated
  using (public.q_e_gestor()
         or (public.q_e_equipe() and (responsavel_id = auth.uid() or public.q_ve_cliente(cliente_id))));
create policy atendimentos_cria on public.atendimentos
  for insert to authenticated with check (public.q_ve_cliente(cliente_id));
create policy atendimentos_altera on public.atendimentos
  for update to authenticated
  using (public.q_e_gestor()
         or (public.q_e_equipe() and (responsavel_id = auth.uid() or public.q_ve_cliente(cliente_id))))
  with check (public.q_e_gestor()
              or (public.q_e_equipe() and (responsavel_id = auth.uid() or public.q_ve_cliente(cliente_id))));

-- Mensagens: responde como ELE mesmo (nunca como cliente ou robô), em
-- atendimento que vê. O UPDATE continua só em `lida_em` (grant de coluna da
-- 20261015000000 — não muda aqui).
create policy atendimento_mensagens_le on public.atendimento_mensagens
  for select to authenticated using (public.q_ve_atendimento(atendimento_id));
create policy atendimento_mensagens_envia on public.atendimento_mensagens
  for insert to authenticated
  with check (public.q_ve_atendimento(atendimento_id) and autor_tipo = 'equipe' and autor_id = auth.uid());
create policy atendimento_mensagens_marca_lida on public.atendimento_mensagens
  for update to authenticated
  using (public.q_ve_atendimento(atendimento_id)) with check (public.q_ve_atendimento(atendimento_id));
