// Testa as regras de acesso (RLS, CHECKs, gatilhos) num Postgres REAL em
// memória (PGlite), sem precisar do Supabase. Aplica TODAS as migrações em
// ordem e confere o que cada papel consegue fazer.
//
//   cd supabase/testes && npm install && npm test
//
// Teste novo de regra entra aqui. Regra que só existe na tela não é regra.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite({ extensions: { pgcrypto } });
const sql = (q) => db.exec(q);

// Ambiente mínimo do Supabase: papéis, auth.users e auth.uid().
await sql(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create schema extensions; create extension pgcrypto schema extensions;
  -- As colunas que o Auth do Supabase tem e que a q_portal_definir_senha grava.
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz, banned_until timestamptz,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
    last_sign_in_at timestamptz
  );
  create table auth.identities (
    id uuid primary key, user_id uuid references auth.users(id), provider_id text, identity_data jsonb,
    provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Storage mínimo: o bucket, os objetos (com RLS) e a função das pastas.
  create schema storage; grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated; grant select on storage.buckets to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  -- O Supabase já nasce com a publicação do Realtime (vazia).
  create publication supabase_realtime;
`);

const pasta = new URL("../migrations/", import.meta.url).pathname;
for (const f of readdirSync(pasta).filter((n) => n.endsWith(".sql")).sort()) {
  await sql(readFileSync(join(pasta, f), "utf8"));
  console.log("aplicada:", f);
}

const G = "00000000-0000-0000-0000-00000000000a"; // gestor
const M = "00000000-0000-0000-0000-00000000000b"; // colaborador A
const B = "00000000-0000-0000-0000-00000000000d"; // colaborador B
const C = "00000000-0000-0000-0000-00000000000c"; // cliente do portal (não é equipe)
await sql(`insert into auth.users (id, email) values ('${G}','g@q'),('${M}','m@q'),('${B}','b@q'),('${C}','c@q');
  insert into public.perfis (id,nome,papel) values ('${G}','Gestora','gestor'),('${M}','Colab A','colaborador'),('${B}','Colab B','colaborador');`);

let ok = 0, falhas = 0;
async function como(role, uid, q) {
  await sql(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  // Limpa o "login" no fim: sem isso o próximo comando de administrador ainda
  // carrega o usuário simulado, e as travas (com razão) o tratam como ele.
  try { return await db.query(q); } finally { await sql("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
async function espera(desc, fn, deveFalhar, conferir) {
  try {
    const r = await fn();
    if (deveFalhar) { falhas++; console.log("✗", desc, "— passou e devia falhar"); return; }
    if (conferir && !conferir(r)) { falhas++; console.log("✗", desc, "— resultado", JSON.stringify(r.rows)); return; }
    ok++; console.log("✓", desc);
  } catch (e) {
    if (deveFalhar) { ok++; console.log("✓", desc, "→", e.message); }
    else { falhas++; console.log("✗", desc, "→", e.message); }
  }
}
const n = (k) => (r) => r.rows.length === k;

// ── portas de fora
await espera("anon não executa NENHUMA função do public (nem as puras e de gatilho)", () => db.query("select coalesce(string_agg(p.proname, ', ' order by p.proname), '') as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')"), false, (r) => r.rows[0].f === "");
await espera("nenhuma view do public ignora a RLS (security_invoker)", () => db.query("select coalesce(string_agg(c.relname, ', '), '') as v from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> array['security_invoker=true'], false)"), false, (r) => r.rows[0].v === "");
await espera("toda tabela do public tem RLS ligada", () => db.query("select coalesce(string_agg(c.relname, ', '), '') as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"), false, (r) => r.rows[0].t === "");
await espera("toda função SECURITY DEFINER tem search_path fixo", () => db.query("select coalesce(string_agg(p.proname, ', '), '') as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')"), false, (r) => r.rows[0].f === "");
await espera("anon não lê clientes", () => como("anon", null, "select * from clientes"), true);
await espera("anon não executa q_e_equipe()", () => como("anon", null, "select public.q_e_equipe()"), true);
await espera("cliente do portal não vê perfis (0)", () => como("authenticated", C, "select * from perfis"), false, n(0));
await espera("cliente do portal não cria cliente", () => como("authenticated", C, "insert into clientes (documento,nome) values ('12345678901','X')"), true);

// ── cadastro de cliente e a regra do documento
await espera("documento formatado é recusado", () => como("authenticated", M, "insert into clientes (documento,nome) values ('123.456.789-01','X')"), true);
await espera("colaborador A cadastra cliente e vira o consultor", () => como("authenticated", M, "insert into clientes (documento,nome) values ('12345678901','Cliente do A') returning tipo_pessoa, consultor_id, created_by"), false, (r) => r.rows[0].tipo_pessoa === "PF" && r.rows[0].consultor_id === M && r.rows[0].created_by === M);
await espera("colaborador B cadastra CNPJ (PJ)", () => como("authenticated", B, "insert into clientes (documento,nome) values ('12345678000199','Empresa do B') returning tipo_pessoa"), false, (r) => r.rows[0].tipo_pessoa === "PJ");
await espera("colaborador NÃO cadastra cliente em nome de outro", () => como("authenticated", M, `insert into clientes (documento,nome,consultor_id) values ('98765432100','X','${B}')`), true);

// ── gestor × colaborador: visibilidade
await espera("A vê só o próprio cliente (1)", () => como("authenticated", M, "select nome from clientes"), false, (r) => r.rows.length === 1 && r.rows[0].nome === "Cliente do A");
await espera("B vê só o próprio cliente (1)", () => como("authenticated", B, "select nome from clientes"), false, (r) => r.rows.length === 1 && r.rows[0].nome === "Empresa do B");
await espera("gestor vê todos (2)", () => como("authenticated", G, "select * from clientes"), false, n(2));
await espera("A não altera cliente do B (0)", () => como("authenticated", M, "update clientes set nome='hack' where documento='12345678000199' returning id"), false, n(0));
await espera("A NÃO transfere o próprio cliente para B", () => como("authenticated", M, `update clientes set consultor_id='${B}' where documento='12345678901'`), true);
await espera("gestor transfere cliente", () => como("authenticated", G, `update clientes set consultor_id='${M}' where documento='12345678000199' returning id`), false, n(1));
await espera("depois da transferência, A vê 2 e B vê 0", async () => {
  const a = await como("authenticated", M, "select * from clientes");
  const b = await como("authenticated", B, "select * from clientes");
  return { rows: [a.rows.length, b.rows.length] };
}, false, (r) => r.rows[0] === 2 && r.rows[1] === 0);
await espera("ninguém apaga cliente (sem policy de DELETE)", () => como("authenticated", G, "delete from clientes returning id"), false, n(0));

// ── cadastros de apoio
await espera("colaborador não cria banco (cadastro é do gestor)", () => como("authenticated", M, "insert into bancos (nome) values ('B')"), true);
await espera("gestor cria banco", () => como("authenticated", G, "insert into bancos (nome) values ('Banco X')"), false);
await espera("colaborador LÊ os cadastros (4 setores)", () => como("authenticated", M, "select * from departamentos"), false, n(4));

// ── contratos e histórico seguem o cliente
await espera("A cria contrato do próprio cliente (#1)", () => como("authenticated", M, "insert into contratos (cliente_id) select id from clientes where documento='12345678901' returning numero"), false, (r) => Number(r.rows[0].numero) === 1);
await espera("B não vê o contrato do A (0)", () => como("authenticated", B, "select * from contratos"), false, n(0));
const clienteDoA = (await db.query("select id from clientes where documento='12345678901'")).rows[0].id;
await espera("B não cria contrato para cliente do A (nem se pondo de consultor)", () => como("authenticated", B, `insert into contratos (cliente_id, consultor_id) values ('${clienteDoA}', '${B}')`), true);
await espera("histórico em nome de OUTRO é recusado", () => como("authenticated", M, `insert into contrato_historico (contrato_id, texto, autor_id) select id, 'x', '${G}' from contratos limit 1`), true);
await espera("A lança histórico no próprio nome", () => como("authenticated", M, "insert into contrato_historico (contrato_id, texto) select id, 'Ligamos para o banco.' from contratos limit 1 returning autor_id"), false, (r) => r.rows[0].autor_id === M);
await espera("B não vê o histórico do contrato do A (0)", () => como("authenticated", B, "select * from contrato_historico"), false, n(0));
await espera("colaborador não corrige histórico (0)", () => como("authenticated", M, "update contrato_historico set texto='y' returning id"), false, n(0));
await espera("gestor corrige histórico", () => como("authenticated", G, "update contrato_historico set texto='Ligamos para o banco hoje.' returning id"), false, n(1));

// ── atendimento
const abre = `insert into atendimentos (cliente_id, setor_id, titulo)
  select (select id from clientes where documento='12345678901'), (select id from departamentos where nome='Acordo'), 'Quero negociar' returning id`;
await espera("A abre atendimento do próprio cliente", () => como("authenticated", M, abre), false);
await espera("SEGUNDO atendimento ativo do mesmo cliente é recusado", () => como("authenticated", M, abre), true);
await espera("B não vê o atendimento (0)", () => como("authenticated", B, "select * from atendimentos"), false, n(0));
await espera("gestor põe B como responsável", () => como("authenticated", G, `update atendimentos set responsavel_id='${B}' returning id`), false, n(1));
await espera("responsável B passa a ver o atendimento (1)", () => como("authenticated", B, "select * from atendimentos"), false, n(1));
await espera("B responde em nome próprio", () => como("authenticated", B, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'equipe', '${B}', 'Olá!' from atendimentos`), false);
await espera("equipe NÃO escreve como cliente", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'cliente', '${M}', 'fake' from atendimentos`), true);
await espera("mensagem não se reescreve", () => como("authenticated", M, "update atendimento_mensagens set corpo='editado'"), true);
await espera("marcar como lida pode", () => como("authenticated", M, "update atendimento_mensagens set lida_em=now() returning id"), false, n(1));
await espera("arquiva", () => como("authenticated", M, `update atendimentos set arquivado_em=now(), arquivado_por='${M}' returning id`), false, n(1));
await espera("arquivado não recebe mensagem", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'equipe', '${M}', 'oi' from atendimentos`), true);
await espera("depois de arquivar, pode abrir outro", () => como("authenticated", M, abre), false);

// ── perfil: cada um edita o seu, ninguém muda o próprio nível
await espera("colaborador edita o PRÓPRIO nome e cargo", () => como("authenticated", M, `update perfis set nome='Colab A Silva', cargo='Consultor' where id='${M}' returning id`), false, n(1));
await espera("colaborador NÃO se promove a gestor", () => como("authenticated", M, `update perfis set papel='gestor' where id='${M}'`), true);
await espera("colaborador NÃO se reativa/desativa", () => como("authenticated", M, `update perfis set ativo=false where id='${M}'`), true);
await espera("colaborador não edita perfil de OUTRO (0)", () => como("authenticated", M, `update perfis set nome='x' where id='${B}' returning id`), false, n(0));
await espera("colaborador vê a equipe (3 perfis)", () => como("authenticated", M, "select * from perfis"), false, n(3));
await espera("gestor muda o nível de alguém", () => como("authenticated", G, `update perfis set papel='gestor' where id='${B}' returning id`), false, n(1));
await espera("gestor desativa alguém", () => como("authenticated", G, `update perfis set ativo=false where id='${M}' returning id`), false, n(1));
await espera("colaborador DESATIVADO não lê nada", () => como("authenticated", M, "select * from clientes"), false, n(0));
// ── pipeline: o card é o contrato
const etapa = async (nome) => (await db.query(`select id from pipeline_etapas where nome = '${nome}'`)).rows[0].id;
await espera("contrato novo cai na PRIMEIRA etapa", () => db.query(`select e.nome from contratos k join pipeline_etapas e on e.id = k.etapa_id order by k.numero limit 1`), false, (r) => r.rows[0].nome === "Novo contato");
await espera("antes do aceite, data_aceite é nula", () => db.query("select data_aceite from contratos order by numero limit 1"), false, (r) => r.rows[0].data_aceite === null);
await sql(`update perfis set ativo=true, papel='colaborador' where id in ('${M}','${B}')`);
await espera("colaborador não cria etapa (cadastro é do gestor)", () => como("authenticated", B, "insert into pipeline_etapas (nome) values ('X')"), true);
await espera("colaborador LÊ as etapas (9)", () => como("authenticated", B, "select * from pipeline_etapas"), false, n(9));
await espera("as colunas na ordem pedida (22/10)", () => db.query("select string_agg(nome, ' · ' order by ordem) as s from pipeline_etapas where ativo"), false, (r) => r.rows[0].s === "Novo contato · Reunião · Proposta apresentada · Criar Perfil no Portal · Em negociação · Enviar link de pagamento · Enviado · Acordo fechado · Concluído");
const proposta = await etapa("Proposta apresentada");
const aceito = await etapa("Criar Perfil no Portal");
await espera("A arrasta o próprio card para Proposta", () => como("authenticated", M, `update contratos set etapa_id='${proposta}' where numero=1 returning data_aceite`), false, (r) => r.rows.length === 1 && r.rows[0].data_aceite === null);
await espera("B NÃO move card do A (0)", () => como("authenticated", B, `update contratos set etapa_id='${aceito}' where numero=1 returning id`), false, n(0));
await espera("chegar em 'Criar Perfil no Portal' grava data_aceite = hoje", () => como("authenticated", M, `update contratos set etapa_id='${aceito}' where numero=1 returning data_aceite = current_date as hoje`), false, (r) => r.rows[0].hoje === true);
await espera("voltar de etapa NÃO apaga o aceite", () => como("authenticated", M, `update contratos set etapa_id='${proposta}' where numero=1 returning data_aceite`), false, (r) => r.rows[0].data_aceite !== null);
await espera("etapa_desde anda na troca de etapa", () => db.query("select etapa_desde >= created_at as andou from contratos where numero=1"), false, (r) => r.rows[0].andou === true);
await espera("contrato sem etapa é impossível", () => db.query("update contratos set etapa_id = null where numero=1"), true);

// ── portal do cliente: o cliente só lê o que é dele, por funções
await sql(`update perfis set ativo=true, papel='colaborador' where id in ('${M}','${B}')`);
await espera("colaborador gera a senha do portal do PRÓPRIO cliente", () => como("authenticated", M, `select q_portal_definir_senha('${clienteDoA}', 'segredo123') as email`), false, (r) => r.rows[0].email === "12345678901@portal.quadrum.example");
await espera("a conta nasce no Auth com senha bcrypt e tokens vazios (não nulos)", () => db.query(`select u.encrypted_password = extensions.crypt('segredo123', u.encrypted_password) as ok, u.confirmation_token = '' as tk, (select count(*) from auth.identities i where i.user_id = u.id) as ids from auth.users u where email = '12345678901@portal.quadrum.example'`), false, (r) => r.rows[0].ok && r.rows[0].tk && Number(r.rows[0].ids) === 1);
await espera("senha curta é recusada", () => como("authenticated", M, `select q_portal_definir_senha('${clienteDoA}', '123')`), true);
await espera("B NÃO gera senha para cliente do A", () => como("authenticated", B, `select q_portal_definir_senha('${clienteDoA}', 'outrasenha1')`), true);
await espera("redefinir troca a senha da MESMA conta", async () => {
  await como("authenticated", M, `select q_portal_definir_senha('${clienteDoA}', 'novasenha9')`);
  return db.query(`select count(*) as n, bool_and(encrypted_password = extensions.crypt('novasenha9', encrypted_password)) as ok from auth.users where email like '12345678901@%'`);
}, false, (r) => Number(r.rows[0].n) === 1 && r.rows[0].ok);
const P = (await db.query(`select user_id from clientes where id = '${clienteDoA}'`)).rows[0].user_id;
await espera("o cliente NÃO lê a tabela de contratos direto (0)", () => como("authenticated", P, "select * from contratos"), false, n(0));
await espera("o cliente NÃO gera senha (nem para si)", () => como("authenticated", P, `select q_portal_definir_senha('${clienteDoA}', 'hackeado1')`), true);
await espera("portal_eu devolve o cliente logado", () => como("authenticated", P, "select portal_eu() as eu"), false, (r) => r.rows[0].eu?.nome === "Cliente do A");
await espera("portal_eu é nulo para a equipe", () => como("authenticated", G, "select portal_eu() as eu"), false, (r) => r.rows[0].eu === null);
const depUrg = (await db.query(`insert into departamentos (nome, urgente) values ('Jurídico', true) returning id`)).rows[0].id;
await sql(`insert into contrato_historico (contrato_id, texto, autor_id, departamento_id) select id, 'TEXTO URGENTE', '${M}', '${depUrg}' from contratos where numero = 1`);
await espera("portal_contratos: só os ACEITOS, com histórico e marca de urgente", () => como("authenticated", P, "select portal_contratos() as c"), false, (r) => {
  const c = r.rows[0].c; return c.length === 1 && c[0].numero === 1 && c[0].urgente_nao_lido === true && c[0].historico.length >= 1;
});
await espera("o TEXTO urgente não sai do banco", () => como("authenticated", P, "select portal_contratos()::text as t"), false, (r) => !r.rows[0].t.includes("TEXTO URGENTE"));
await espera("abrir 'Meus Contratos' marca o histórico como lido", async () => {
  await como("authenticated", P, "select portal_marcar_historico_lido()");
  return como("authenticated", P, "select portal_contratos() as c");
}, false, (r) => r.rows[0].c[0].urgente_nao_lido === false);
await espera("outro login (cliente sem cadastro) não vê contrato nenhum", () => como("authenticated", C, "select portal_contratos() as c"), false, (r) => r.rows[0].c.length === 0);
// Fecha o atendimento aberto pelos testes de equipe, para o cliente abrir o dele.
await sql(`update atendimentos set arquivado_em = now()`);
const setor = (await db.query("select id from departamentos where nome = 'Acordo'")).rows[0].id;
const contrato1 = (await db.query("select id from contratos where numero = 1")).rows[0].id;
await espera("o robô abre o atendimento com as 8 falas do roteiro", () => como("authenticated", P, `select portal_abrir_atendimento('${contrato1}', '${setor}', 'Quero renegociar as parcelas') as a`), false, (r) => {
  const a = r.rows[0].a; return a.mensagens.length === 8 && a.titulo === "Quero renegociar as parcelas" && a.mensagens[0].autor_tipo === "robo" && a.mensagens[6].corpo === "Quero renegociar as parcelas";
});
await espera("SEGUNDO atendimento aberto é recusado", () => como("authenticated", P, `select portal_abrir_atendimento('${contrato1}', '${setor}', 'outro')`), true);
await espera("o atendimento nasce com o CONSULTOR do contrato como responsável", () => db.query("select responsavel_id from atendimentos where arquivado_em is null"), false, (r) => r.rows[0].responsavel_id === M);
const atd = (await db.query("select id from atendimentos where arquivado_em is null")).rows[0].id;
await espera("o cliente envia mensagem", () => como("authenticated", P, `select portal_enviar_mensagem('${atd}', 'Alguma novidade?') as a`), false, (r) => r.rows[0].a.mensagens.length === 9);
await espera("o cliente NÃO escreve em atendimento de outro", () => como("authenticated", C, `select portal_enviar_mensagem('${atd}', 'intruso')`), true);
await espera("a equipe (consultor) responde", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) values ('${atd}', 'equipe', '${M}', 'Já pedimos ao banco.') returning id`), false, n(1));
await espera("aviso 'Novas mensagens no chat!' acende", () => como("authenticated", P, "select portal_avisos() as a"), false, (r) => r.rows[0].a.chat_nao_lido === true);
await espera("ler o chat apaga o aviso", async () => {
  await como("authenticated", P, `select portal_marcar_chat_lido('${atd}')`);
  return como("authenticated", P, "select portal_avisos() as a");
}, false, (r) => r.rows[0].a.chat_nao_lido === false);
await espera("a resposta da equipe chega com o primeiro nome", () => como("authenticated", P, "select portal_chat_ativo() as a"), false, (r) => r.rows[0].a.mensagens.at(-1).autor === "Colab");
await sql(`update atendimentos set arquivado_em = now() where id = '${atd}'`);
await espera("arquivado: o cliente lê, mas não escreve", async () => {
  const lido = await como("authenticated", P, `select portal_chat('${atd}') as a`);
  if (!lido.rows[0].a?.arquivado) throw new Error("não leu o arquivado");
  return como("authenticated", P, `select portal_enviar_mensagem('${atd}', 'oi')`);
}, true);
await espera("anon não chama função do portal", () => como("anon", null, "select portal_contratos()"), true);
await espera("ninguém chama a função interna do chat", () => como("authenticated", P, `select q_portal_chat_json('${atd}')`), true);

// ── usuários da equipe: só o gestor cria e redefine; sempre sobra um gestor
await espera("colaborador NÃO cria usuário", () => como("authenticated", M, "select q_equipe_criar_usuario('novo@q.com', 'Novo', 'colaborador', 'senha1234')"), true);
await espera("gestor cria usuário (login + perfil)", () => como("authenticated", G, "select q_equipe_criar_usuario('Novo@Q.com ', 'Novo Colega', 'colaborador', 'senha1234', 'Consultor') as id"), false, (r) => !!r.rows[0].id);
await espera("o perfil nasce com e-mail minúsculo, cargo e nível", () => db.query("select p.email, p.cargo, p.papel, u.encrypted_password = extensions.crypt('senha1234', u.encrypted_password) as ok, u.confirmation_token = '' as tk from perfis p join auth.users u on u.id = p.id where p.email = 'novo@q.com'"), false, (r) => r.rows[0]?.cargo === "Consultor" && r.rows[0].papel === "colaborador" && r.rows[0].ok && r.rows[0].tk);
await espera("e-mail repetido é recusado", () => como("authenticated", G, "select q_equipe_criar_usuario('novo@q.com', 'Outro', 'colaborador', 'senha1234')"), true);
await espera("e-mail de CLIENTE do portal é recusado", () => como("authenticated", G, "select q_equipe_criar_usuario('12345678901@portal.quadrum.example', 'X', 'colaborador', 'senha1234')"), true);
await espera("e-mail inválido é recusado", () => como("authenticated", G, "select q_equipe_criar_usuario('sem-arroba', 'X', 'colaborador', 'senha1234')"), true);
const novo = (await db.query("select id from perfis where email = 'novo@q.com'")).rows[0].id;
await espera("gestor redefine a senha", async () => {
  await como("authenticated", G, `select q_equipe_definir_senha('${novo}', 'outra5678')`);
  return db.query(`select encrypted_password = extensions.crypt('outra5678', encrypted_password) as ok from auth.users where id = '${novo}'`);
}, false, (r) => r.rows[0].ok);
await espera("colaborador NÃO redefine senha de ninguém", () => como("authenticated", M, `select q_equipe_definir_senha('${novo}', 'hackeado1')`), true);
await sql(`update perfis set papel = 'colaborador' where id <> '${G}'`);
await espera("o ÚLTIMO gestor não se rebaixa", () => como("authenticated", G, `update perfis set papel = 'colaborador' where id = '${G}'`), true);
await espera("o ÚLTIMO gestor não se desativa", () => como("authenticated", G, `update perfis set ativo = false where id = '${G}'`), true);
await espera("com outro gestor ativo, rebaixar pode", async () => {
  await como("authenticated", G, `update perfis set papel = 'gestor' where id = '${novo}'`);
  await como("authenticated", G, `update perfis set papel = 'colaborador' where id = '${G}'`);
  return db.query(`select papel from perfis where id = '${G}'`);
}, false, (r) => r.rows[0].papel === "colaborador");
await sql(`select set_config('request.jwt.claim.sub', '', false); update perfis set papel = 'gestor' where id = '${G}'`);

// ── caixa de atendimentos: última mensagem, não lidas e a MESMA regra de quem vê
await espera("gestor vê a caixa: última mensagem e as 4 do cliente sem leitura", () => como("authenticated", G, `select * from atendimentos_caixa where id = '${atd}'`), false, (r) => r.rows[0]?.ultima_corpo === "Já pedimos ao banco." && r.rows[0].nao_lidas === 4 && r.rows[0].contrato_numero === 1);
await espera("atendimento sem mensagem aparece com última = nula (não some)", () => como("authenticated", G, "select count(*) as n from atendimentos_caixa where ultima_em is null"), false, (r) => Number(r.rows[0].n) >= 1);
await espera("a caixa respeita a carteira: B só vê o atendimento de que é responsável", () => como("authenticated", B, `select * from atendimentos_caixa where responsavel_id is distinct from '${B}'`), false, n(0));
await espera("responsável por cliente de OUTRA carteira vê o atendimento (sem os dados do cliente)", () => como("authenticated", B, `select * from atendimentos_caixa where responsavel_id = '${B}'`), false, (r) => r.rows.length >= 1 && r.rows.every((x) => x.cliente_nome === "Cliente de outra carteira" && x.cliente_documento === ""));
await espera("cliente do portal não lê a caixa", () => como("authenticated", P, "select * from atendimentos_caixa"), false, n(0));
await espera("anon não lê a caixa", () => como("anon", null, "select * from atendimentos_caixa"), true);

await espera("updated_at anda no update", () => db.query("select updated_at >= created_at as andou from atendimentos limit 1"), false);


// ════ ESCALA (20261017000000): busca, páginas e pipeline no banco ════════════
await espera("busca sem acento e por palavra", () => db.query("select q_casa_busca(q_busca('Maria das Graças Oliveira 12345678901'), 'graca OLIV') as a, q_casa_busca(q_busca('Maria das Graças'), 'graça souza') as b, q_casa_busca('12345678901', '123.456') as c, q_casa_busca('x', '  ') as d"), false, (r) => r.rows[0].a && !r.rows[0].b && r.rows[0].c && r.rows[0].d);
await espera("q_clientes_pagina: A vê os 2 dele e acha 'empresa'", () => como("authenticated", M, "select q_clientes_pagina('empresa') as p, q_clientes_pagina() as t"), false, (r) => r.rows[0].t.contagem.todos === 2 && r.rows[0].p.linhas.length === 1 && r.rows[0].p.linhas[0].nome === "Empresa do B" && !("busca" in r.rows[0].p.linhas[0]));
await espera("q_clientes_pagina: B não vê nenhum", () => como("authenticated", B, "select q_clientes_pagina() as p"), false, (r) => r.rows[0].p.contagem.todos === 0 && r.rows[0].p.linhas.length === 0);
await espera("q_clientes_pagina: o cliente do portal não vê nada", () => como("authenticated", P, "select q_clientes_pagina() as p"), false, (r) => r.rows[0].p.contagem.todos === 0);
await espera("q_clientes_pagina: filtro do portal (com/sem acesso)", () => como("authenticated", M, "select q_clientes_pagina('', 'com') as p"), false, (r) => r.rows[0].p.contagem.com === 1 && r.rows[0].p.linhas.length === 1 && r.rows[0].p.linhas[0].contratos_ativos === 1);
for (let i = 0; i < 3; i++) await como("authenticated", M, `insert into contratos (cliente_id) values ('${clienteDoA}')`);
await espera("q_contratos_pagina pagina de verdade (por=2: 2 + 2)", () => como("authenticated", M, "select q_contratos_pagina('', null, null, 'todos', 1, 2) as a, q_contratos_pagina('', null, null, 'todos', 2, 2) as b, q_contratos_pagina('', null, null, 'todos', 9, 2) as c"), false, (r) => r.rows[0].a.contagem.todos === 4 && r.rows[0].a.linhas.length === 2 && r.rows[0].b.linhas.length === 2 && r.rows[0].c.linhas.length === 0 && r.rows[0].a.linhas[0].numero > r.rows[0].b.linhas[0].numero);
await espera("q_contratos_pagina: situação e busca por nº", () => como("authenticated", M, "select q_contratos_pagina('#1') as a, q_contratos_pagina('', null, null, 'portal') as b"), false, (r) => r.rows[0].a.linhas.some((l) => l.numero === 1) && r.rows[0].b.contagem.portal === 1 && r.rows[0].b.linhas.length === 1);
await espera("q_contratos_pagina: B não vê contrato (0)", () => como("authenticated", B, "select q_contratos_pagina() as p"), false, (r) => r.rows[0].p.contagem.todos === 0);
await espera("q_contratos_pagina: 'por' passa de 100 vira 100 (sem erro)", () => como("authenticated", G, "select jsonb_array_length(q_contratos_pagina('', null, null, 'todos', 1, 100000) -> 'linhas') as n"), false, (r) => r.rows[0].n >= 4);
const primeira = await etapa("Novo contato");
await espera("q_pipeline traz N por coluna e o TOTAL", () => como("authenticated", M, "select q_pipeline('', false, 2) as p"), false, (r) => {
  const c = r.rows[0].p.colunas.find((x) => x.etapa_id === primeira); return r.rows[0].p.colunas.length === 9 && c.total === 3 && c.cards.length === 2;
});
await espera("q_pipeline: 'carregar mais' aumenta só uma coluna", () => como("authenticated", M, `select q_pipeline('', false, 2, '{"${primeira}": 10}') as p`), false, (r) => r.rows[0].p.colunas.find((x) => x.etapa_id === primeira).cards.length === 3);
await espera("q_pipeline: B não vê card (0)", () => como("authenticated", B, "select q_pipeline() as p"), false, (r) => r.rows[0].p.colunas.every((c) => c.total === 0));
await espera("q_caixa_pagina: contagem por aba", () => como("authenticated", G, "select q_caixa_pagina('', null, 'arquivados') as p"), false, (r) => r.rows[0].p.contagem.arquivados >= 2 && r.rows[0].p.linhas.length === r.rows[0].p.contagem.arquivados);
await espera("anon não chama as páginas", () => como("anon", null, "select q_contratos_pagina()"), true);

// ════ MODELOS E ASSINATURA (20261017010000) ═════════════════════════════════
await espera("o catálogo de campos é o MESMO dos valores", async () => {
  const cat = await como("authenticated", G, "select array_agg(x->>'chave' order by x->>'chave') as k from jsonb_array_elements(q_documento_catalogo()) x");
  const val = await db.query("select array_agg(k order by k) as k from jsonb_object_keys(q_documento_variaveis(null)) k");
  return { rows: [cat.rows[0].k.join(","), val.rows[0].k.join(",")] };
}, false, (r) => r.rows[0] === r.rows[1] && r.rows[0].includes("cliente.qualificacao"));
await espera("modelos de partida INATIVOS (3) e o contrato real ATIVO", () => db.query("select count(*) filter (where not ativo) as n, count(*) filter (where ativo and tipo = 'contrato' and corpo like '%{{empresa.nome}}%') as c from documento_modelos"), false, (r) => Number(r.rows[0].n) === 3 && Number(r.rows[0].c) === 1);
const modProc = (await db.query("select id from documento_modelos where tipo = 'procuracao'")).rows[0].id;
const modTermo = (await db.query("select id from documento_modelos where tipo = 'termo'")).rows[0].id;
await espera("modelo inativo não gera", () => como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
await espera("colaborador não altera modelo (0)", () => como("authenticated", M, `update documento_modelos set ativo = true where id = '${modProc}' returning id`), false, n(0));
await espera("gestor edita o modelo: versão sobe", () => como("authenticated", G, `update documento_modelos set ativo = true, corpo = corpo || ' ' where id = '${modProc}' returning versao`), false, (r) => r.rows[0].versao === 3);  // 1 → 2 na troca de nome (20261028)
await sql(`update documento_modelos set ativo = true where id = '${modTermo}'`);
await espera("prévia sem contrato mostra os campos como [rótulo] e acusa campo inexistente", () => como("authenticated", M, "select q_documento_previa('Eu, {{cliente.nome}}, {{cliente.xyz}}') as p"), false, (r) => r.rows[0].p.texto.startsWith("Eu, [Nome / razão social]") && r.rows[0].p.desconhecidas[0] === "cliente.xyz");
await espera("gerar com cadastro incompleto RECUSA e diz o que falta", () => como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
await sql(`update clientes set nacionalidade='brasileira', estado_civil='casado(a)', profissao='motorista', rg='1234567', rg_orgao='SSP/RN',
  logradouro='Rua das Flores', endereco_numero='10', bairro='Centro', cidade='Natal', uf='RN', cep='59000-000' where id = '${clienteDoA}'`);
await sql(`update bancos set nome = 'Banco X'; update contratos set banco_id = (select id from bancos limit 1), linha_credito_id = (select id from linhas_credito limit 1) where id = '${contrato1}'`);
await espera("B não gera documento em contrato do A", () => como("authenticated", B, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
let docProc;
// A OUTORGADA vem de Dados da empresa (20261028): sem CNPJ e sede, não gera.
await sql("update empresa set cnpj = '11222333000181', endereco = 'Natal/RN'");
await espera("A gera a procuração preenchida, com hash", async () => {
  const r = await como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}') as id`);
  docProc = r.rows[0].id;
  return db.query(`select conteudo, conteudo_hash = encode(extensions.digest(convert_to(conteudo, 'UTF8'), 'sha256'), 'hex') as hash_ok, modelo_versao from contrato_documentos where id = '${docProc}'`);
}, false, (r) => r.rows[0].hash_ok && r.rows[0].modelo_versao === 3 && !r.rows[0].conteudo.includes("{{") && r.rows[0].conteudo.includes("Cliente do A, brasileira, casado(a), motorista, portador(a) do RG nº 1234567 SSP/RN, inscrito(a) no CPF sob o nº 123.456.789-01, residente e domiciliado(a) em Rua das Flores 10, Centro, Natal/RN, CEP 59000-000") && r.rows[0].conteudo.includes("Banco X"));
await espera("o evento 'gerado' fica registrado", () => db.query(`select count(*) as n from documento_eventos where documento_id = '${docProc}' and tipo = 'gerado' and ator_id = '${M}'`), false, (r) => Number(r.rows[0].n) === 1);
await espera("segundo do mesmo tipo pendente é recusado", () => como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
await espera("ninguém grava documento com texto por fora da geração", () => como("authenticated", M, `insert into contrato_documentos (contrato_id, tipo, conteudo) values ('${contrato1}', 'termo', 'texto forjado')`), true);
await espera("o texto gerado não muda", () => como("authenticated", M, `update contrato_documentos set conteudo = 'outro' where id = '${docProc}'`), true);
await espera("a equipe NÃO marca como assinado o documento do sistema", () => como("authenticated", M, `update contrato_documentos set assinado_em = now() where id = '${docProc}'`), true);
await espera("o portal mostra a pendência como 'assinar no portal'", () => como("authenticated", P, "select portal_contratos() as c"), false, (r) => r.rows[0].c[0].pendencias.some((p) => p.id === docProc && p.no_sistema === true));
await espera("outro login não abre o documento", () => como("authenticated", C, `select portal_documento('${docProc}')`), true);
const CAB = `{"x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "NavegadorTeste/1.0"}`;
async function comoCliente(q) {
  await sql(`reset role; select set_config('request.jwt.claim.sub', '${P}', false); select set_config('request.headers', '${CAB}', false); set role authenticated;`);
  try { return await db.query(q); } finally { await sql("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);"); }
}
await espera("o cliente lê o documento, e a leitura vira evento com IP", async () => {
  const r = await comoCliente(`select portal_documento('${docProc}') as d`);
  if (!r.rows[0].d.conteudo.includes("PROCURAÇÃO")) throw new Error("sem texto");
  return db.query(`select ip, user_agent from documento_eventos where documento_id = '${docProc}' and tipo = 'visualizado'`);
}, false, (r) => r.rows[0]?.ip === "200.1.2.3" && r.rows[0].user_agent === "NavegadorTeste/1.0");
await espera("assinar com a senha ERRADA não assina e registra a tentativa", async () => {
  const r = await comoCliente(`select portal_assinar_documento('${docProc}', 'errada', 'Cliente do A', true) as r`);
  if (r.rows[0].r.ok !== false) throw new Error("assinou com senha errada");
  return db.query(`select (select count(*) from documento_eventos where documento_id = '${docProc}' and tipo = 'senha_incorreta') as n, (select assinado_em from contrato_documentos where id = '${docProc}') as a`);
}, false, (r) => Number(r.rows[0].n) === 1 && r.rows[0].a === null);
await espera("sem marcar o aceite não assina", () => comoCliente(`select portal_assinar_documento('${docProc}', 'novasenha9', 'Cliente do A', false)`), true);
await espera("nome diferente do cadastro não assina", () => comoCliente(`select portal_assinar_documento('${docProc}', 'novasenha9', 'Fulano', true)`), true);
// ── senha provisória: a que a equipe gerou não assina; o cliente cria a dele
await espera("senha gerada pela equipe é PROVISÓRIA", () => comoCliente("select q_senha_provisoria() as p"), false, (r) => r.rows[0].p === true);
await espera("com senha provisória o documento NÃO se assina (nem com a senha certa)", () => comoCliente(`select portal_assinar_documento('${docProc}', 'novasenha9', 'Cliente do A', true)`), true);
await espera("senha fraca é recusada (ok:false, com o motivo)", () => comoCliente("select q_trocar_minha_senha(null, 'abcdefgh') as r"), false, (r) => r.rows[0].r.ok === false && /letras e números/.test(r.rows[0].r.erro));
await espera("senha com o próprio CPF é recusada", () => comoCliente("select q_trocar_minha_senha(null, 'x12345678901') as r"), false, (r) => r.rows[0].r.ok === false && /CPF/.test(r.rows[0].r.erro));
await espera("a nova não pode ser a provisória", () => comoCliente("select q_trocar_minha_senha(null, 'novasenha9') as r"), false, (r) => r.rows[0].r.ok === false && /provisória/.test(r.rows[0].r.erro));
await espera("o cliente cria a própria senha (sem pedir a provisória de novo)", () => comoCliente("select q_trocar_minha_senha(null, 'MinhaSenha2026') as r"), false, (r) => r.rows[0].r.ok === true);
await espera("…e ela deixa de ser provisória, e é a que vale", async () => {
  const a = await comoCliente("select q_senha_provisoria() as p");
  const b = await db.query(`select encrypted_password = extensions.crypt('MinhaSenha2026', encrypted_password) as ok from auth.users where email like '12345678901@%'`);
  return { rows: [a.rows[0].p, b.rows[0].ok] };
}, false, (r) => r.rows[0] === false && r.rows[1] === true);
await espera("depois disso, trocar de novo PEDE a senha atual", () => comoCliente("select q_trocar_minha_senha('errada', 'OutraSenha2027') as r"), false, (r) => r.rows[0].r.ok === false && /atual/.test(r.rows[0].r.erro));
await espera("o login (update sem mudar a senha) não muda a marca", async () => {
  await db.query(`update auth.users set last_sign_in_at = now() where email like '12345678901@%'`);
  return comoCliente("select q_senha_provisoria() as p");
}, false, (r) => r.rows[0].p === false);
await espera("ASSINA: senha certa, nome (sem acento/maiúscula) e aceite", () => comoCliente(`select portal_assinar_documento('${docProc}', 'MinhaSenha2026', '  cliente  do a ', true) as r`), false, (r) => r.rows[0].r.ok === true && r.rows[0].r.documento.assinatura.ip === "200.1.2.3");
await espera("a prova fica gravada: IP, navegador, hash do texto, aceite, código", () => db.query(`select a.ip, a.user_agent, a.hash_sha256 = d.conteudo_hash as hash_ok, a.aceite_texto like 'Declaro que li%' as aceite, a.codigo_verificacao ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' as cod, a.visualizado_em is not null as viu, a.assinado_em = d.assinado_em as mesma_hora, a.signatario_documento from documento_assinaturas a join contrato_documentos d on d.id = a.documento_id where d.id = '${docProc}'`), false, (r) => {
  const a = r.rows[0]; return a.ip === "200.1.2.3" && a.user_agent === "NavegadorTeste/1.0" && a.hash_ok && a.aceite && a.cod && a.viu && a.mesma_hora && a.signatario_documento === "12345678901";
});
await espera("não assina duas vezes", () => comoCliente(`select portal_assinar_documento('${docProc}', 'MinhaSenha2026', 'Cliente do A', true)`), true);
await espera("a assinatura não se desfaz (nem o gestor)", () => como("authenticated", G, `update contrato_documentos set assinado_em = null where id = '${docProc}'`), true);
await espera("documento assinado não se cancela", () => como("authenticated", G, `update contrato_documentos set cancelado_em = now() where id = '${docProc}'`), true);
await espera("ninguém escreve evento ou assinatura por fora", async () => {
  for (const q of [`insert into documento_eventos (documento_id, tipo, ator_tipo) values ('${docProc}', 'assinado', 'cliente')`,
                   `delete from documento_assinaturas`, `update documento_assinaturas set ip = '1.1.1.1'`]) {
    try { const r = await como("authenticated", G, q); if (r.affectedRows) throw new Error("passou: " + q); } catch (e) { if (String(e.message).startsWith("passou")) throw e; }
  }
  return db.query("select count(*) as n from documento_assinaturas where ip = '200.1.2.3'");
}, false, (r) => Number(r.rows[0].n) === 1);
await espera("a equipe do contrato lê a assinatura; B não", async () => {
  const a = await como("authenticated", M, "select * from documento_assinaturas");
  const b = await como("authenticated", B, "select * from documento_assinaturas");
  return { rows: [a.rows.length, b.rows.length] };
}, false, (r) => r.rows[0] === 1 && r.rows[1] === 0);
await espera("no portal: sai das pendências e entra nos assinados", () => como("authenticated", P, "select portal_contratos() as c"), false, (r) => !r.rows[0].c[0].pendencias.some((p) => p.id === docProc) && r.rows[0].c[0].documentos.some((d) => d.id === docProc));
let docTermo;
await espera("5 senhas erradas travam por 15 minutos (nem a certa passa)", async () => {
  docTermo = (await como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modTermo}') as id`)).rows[0].id;
  for (let i = 0; i < 5; i++) await comoCliente(`select portal_assinar_documento('${docTermo}', 'errada${i}', 'Cliente do A', true)`);
  return comoCliente(`select portal_assinar_documento('${docTermo}', 'MinhaSenha2026', 'Cliente do A', true) as r`);
}, false, (r) => r.rows[0].r.ok === false && /tentativas/.test(r.rows[0].r.erro));
await espera("cancelar a pendência: vira evento e sai do portal", async () => {
  await como("authenticated", M, `update contrato_documentos set cancelado_em = now(), cancelado_por = '${M}', motivo_cancelamento = 'gerado errado' where id = '${docTermo}'`);
  return como("authenticated", P, "select portal_contratos() as c");
}, false, (r) => !r.rows[0].c[0].pendencias.some((p) => p.id === docTermo));
await espera("cancelado não volta", () => como("authenticated", M, `update contrato_documentos set cancelado_em = null where id = '${docTermo}'`), true);
await espera("cancelado não se assina", () => comoCliente(`select portal_assinar_documento('${docTermo}', 'MinhaSenha2026', 'Cliente do A', true)`), true);
await espera("documento de LINK continua marcável à mão (e vira evento)", async () => {
  const id = (await como("authenticated", M, `insert into contrato_documentos (contrato_id, tipo, link_assinatura) values ('${contrato1}', 'declaracao', 'https://x') returning id`)).rows[0].id;
  await como("authenticated", M, `update contrato_documentos set assinado_em = now() where id = '${id}'`);
  return db.query(`select count(*) as n from documento_eventos where documento_id = '${id}' and tipo = 'marcado_assinado'`);
}, false, (r) => Number(r.rows[0].n) === 1);
await espera("q_documentos_pagina conta por situação", () => como("authenticated", M, "select q_documentos_pagina('', 'todos') as p"), false, (r) => r.rows[0].p.contagem.assinado === 2 && r.rows[0].p.contagem.cancelado === 1 && r.rows[0].p.linhas.length === r.rows[0].p.contagem.todos);
await espera("q_painel conta no banco (gestor)", () => como("authenticated", G, "select q_painel() as p"), false, (r) => r.rows[0].p.andamento + r.rows[0].p.portal === 4 && typeof r.rows[0].p.por_etapa === "object");
await espera("q_painel do colaborador B é vazio", () => como("authenticated", B, "select q_painel() as p"), false, (r) => r.rows[0].p.andamento === 0 && r.rows[0].p.portal === 0);
await espera("anon não chama o painel", () => como("anon", null, "select q_painel()"), true);
await espera("cliente do portal não gera documento", () => como("authenticated", P, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);

// ── ao vivo: as tabelas que o admin escuta estão na publicação do Realtime
const AO_VIVO = ["atendimento_mensagens", "atendimentos", "clientes", "contrato_documentos", "contrato_historico", "contrato_movimentos", "contrato_parcelas", "contratos", "documento_assinaturas", "documento_eventos"];
await espera("as tabelas do ao vivo estão na publicação supabase_realtime", () => db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1"), false, (r) => JSON.stringify(r.rows.map((x) => x.tablename)) === JSON.stringify(AO_VIVO));
await espera("a migração do ao vivo roda de novo sem erro (idempotente)", () => sql(readFileSync(join(pasta, "20261018000000_ao_vivo.sql"), "utf8")), false);
await espera("as tabelas do useAoVivo são as da publicação", async () => {
  const fonte = readFileSync(new URL("../../apps/admin/src/hooks/useAoVivo.tsx", import.meta.url), "utf8");
  const bloco = fonte.slice(fonte.indexOf("const AFETA"), fonte.indexOf("export const TABELAS_AO_VIVO"));
  return { rows: [...bloco.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort() };
}, false, (r) => JSON.stringify(r.rows) === JSON.stringify(AO_VIVO));

// ── senha provisória da EQUIPE
let novoEq;
await espera("usuário criado pelo gestor nasce com senha provisória", async () => {
  novoEq = (await como("authenticated", G, "select q_equipe_criar_usuario('novo@quadrum.com.br', 'Novo da Equipe', 'colaborador', 'Gerada!2026x') as id")).rows[0].id;
  return como("authenticated", novoEq, "select q_senha_provisoria() as p");
}, false, (r) => r.rows[0].p === true);
await espera("o gestor vê quem está com senha provisória (a equipe e os clientes)", () => como("authenticated", G, "select count(*) as n from senha_provisoria"), false, (r) => Number(r.rows[0].n) >= 1);
await espera("o colaborador B não vê a marca do cliente do A nem da equipe", () => como("authenticated", B, "select count(*) as n from senha_provisoria"), false, (r) => Number(r.rows[0].n) === 0);
await espera("o cliente do portal não lê a tabela", () => como("authenticated", P, "select count(*) as n from senha_provisoria"), false, (r) => Number(r.rows[0].n) === 0);
await espera("ninguém escreve na marca pelo PostgREST", () => como("authenticated", G, `delete from senha_provisoria where user_id = '${novoEq}'`), true);
await espera("a pessoa cria a senha dela e a marca sai", async () => {
  const r = await como("authenticated", novoEq, "select q_trocar_minha_senha(null, 'Forte2026abc') as r");
  if (!r.rows[0].r.ok) throw new Error(r.rows[0].r.erro);
  return como("authenticated", novoEq, "select q_senha_provisoria() as p");
}, false, (r) => r.rows[0].p === false);
await espera("o gestor redefine a senha → volta a ser provisória", async () => {
  await como("authenticated", G, `select q_equipe_definir_senha('${novoEq}', 'Redefinida99')`);
  return como("authenticated", novoEq, "select q_senha_provisoria() as p");
}, false, (r) => r.rows[0].p === true);
await espera("anon não troca senha", () => como("anon", null, "select q_trocar_minha_senha(null, 'Qualquer123')"), true);

// ── notificações: o banco avisa, cada um lê só as suas
const notif = async (uid) => (await como("authenticated", uid, "select q_minhas_notificacoes(50) as n")).rows[0].n;
await espera("documento assinado avisa o CONSULTOR do contrato", async () => ({ rows: (await notif(M)).itens }), false, (r) => r.rows.some((i) => i.tipo === "documento_assinado" && i.link.startsWith("/documentos/")));
await espera("documento novo avisa o CLIENTE (contrato no portal)", async () => ({ rows: (await notif(P)).itens }), false, (r) => r.rows.some((i) => i.tipo === "documento_novo"));
await espera("o colaborador B não vê aviso da carteira do A", async () => ({ rows: (await notif(B)).itens }), false, (r) => !r.rows.some((i) => i.tipo === "documento_assinado"));
await espera("ninguém lê a tabela de avisos direto (nem o dono)", () => como("authenticated", M, "select * from notificacoes"), true);
await espera("ninguém grava aviso pela API", () => como("authenticated", M, `insert into notificacoes (destinatario, tipo, titulo) values ('${M}', 'x', 'falso')`), true);
await espera("anon não lê avisos", () => como("anon", null, "select q_minhas_notificacoes(10)"), true);
let atA;
await espera("mensagens do cliente viram UM aviso só para o responsável (agrupa)", async () => {
  await como("authenticated", M, "select q_marcar_notificacoes_lidas(null)");
  atA = (await db.query(`select id from atendimentos where cliente_id = '${clienteDoA}' and arquivado_em is null`)).rows[0]?.id;
  if (!atA) {
    const setor = (await db.query("select id from departamentos where atende_chat limit 1")).rows[0].id;
    atA = (await db.query(`insert into atendimentos (cliente_id, contrato_id, setor_id, titulo, responsavel_id) values ('${clienteDoA}', '${contrato1}', '${setor}', 'Teste', '${M}') returning id`)).rows[0].id;
  }
  await db.query(`update atendimentos set responsavel_id = '${M}' where id = '${atA}'`);
  for (const t of ["oi", "tudo bem?", "mandei o RG"]) await db.query(`insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) values ('${atA}', 'cliente', '${clienteDoA}', '${t}')`);
  const n = await notif(M);
  return { rows: [n.nao_lidas, n.itens.filter((i) => i.tipo === "mensagem_cliente" && !i.lida_em)] };
}, false, (r) => r.rows[0] === 1 && r.rows[1].length === 1 && r.rows[1][0].corpo === "mandei o RG");
await espera("resposta da equipe avisa o cliente", async () => {
  await db.query(`insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) values ('${atA}', 'equipe', '${M}', 'Recebido!')`);
  return { rows: (await notif(P)).itens };
}, false, (r) => r.rows.some((i) => i.tipo === "mensagem_equipe" && i.link === "/chat"));
await espera("marcar como lidas zera o contador (só as minhas)", async () => {
  const antesP = (await notif(P)).nao_lidas;
  await como("authenticated", M, "select q_marcar_notificacoes_lidas(null)");
  return { rows: [(await notif(M)).nao_lidas, (await notif(P)).nao_lidas, antesP] };
}, false, (r) => r.rows[0] === 0 && r.rows[1] === r.rows[2] && r.rows[2] > 0);
await espera("histórico URGENTE: o cliente recebe o aviso, nunca o texto", async () => {
  const dep = (await db.query("insert into departamentos (nome, urgente) values ('Jurídico urgente teste', true) returning id")).rows[0].id;
  await como("authenticated", M, `insert into contrato_historico (contrato_id, departamento_id, texto) values ('${contrato1}', '${dep}', 'SEGREDO-INTERNO')`);
  return { rows: (await notif(P)).itens };
}, false, (r) => r.rows.some((i) => i.tipo === "historico_urgente") && !JSON.stringify(r.rows).includes("SEGREDO-INTERNO"));

// ── departamento no perfil: só o gestor muda
const depX = (await db.query("select id from departamentos limit 1")).rows[0].id;
await espera("colaborador não muda o próprio departamento", () => como("authenticated", M, `update perfis set departamento_id = '${depX}' where id = '${M}'`), true);
await espera("gestor muda o departamento de alguém", async () => {
  await como("authenticated", G, `update perfis set departamento_id = '${depX}' where id = '${M}'`);
  return db.query(`select departamento_id from perfis where id = '${M}'`);
}, false, (r) => r.rows[0].departamento_id === depX);
await espera("colaborador ainda edita nome e foto do próprio perfil", () => como("authenticated", M, `update perfis set nome = 'Colab A Silva', avatar_url = 'https://x/y.webp' where id = '${M}' returning id`), false, (r) => r.rows.length === 1);

// ── fotos: cada um na PRÓPRIA pasta, só a equipe
await espera("o bucket de fotos existe e é público", () => db.query("select public from storage.buckets where id = 'avatares'"), false, (r) => r.rows[0]?.public === true);
await espera("a pessoa envia foto na própria pasta", () => como("authenticated", M, `insert into storage.objects (bucket_id, name) values ('avatares', '${M}/1.webp') returning id`), false, (r) => r.rows.length === 1);
await espera("não envia na pasta de outra pessoa", () => como("authenticated", M, `insert into storage.objects (bucket_id, name) values ('avatares', '${B}/1.webp')`), true);
await espera("cliente do portal não envia foto", () => como("authenticated", P, `insert into storage.objects (bucket_id, name) values ('avatares', '${P}/1.webp')`), true);

// ── linha do tempo de etapas: o banco registra quem moveu, de onde para onde
const etapas = (await db.query("select id, nome from pipeline_etapas where ativo order by ordem")).rows;
await espera("contrato novo nasce com o movimento 'criado'", () => db.query(`select tipo, para_etapa_id from contrato_movimentos where contrato_id = '${contrato1}' order by created_at, id limit 1`), false, (r) => r.rows[0]?.tipo === "criado");
await espera("mover o card registra de → para e QUEM moveu", async () => {
  const atual = (await db.query(`select etapa_id from contratos where id = '${contrato1}'`)).rows[0].etapa_id;
  const outra = etapas.find((e) => e.id !== atual).id;
  await db.query(`update contrato_movimentos set created_at = created_at - interval '3 days' where contrato_id = '${contrato1}'`);
  await como("authenticated", M, `update contratos set etapa_id = '${outra}' where id = '${contrato1}'`);
  return db.query(`select tipo, de_etapa_id, para_etapa_id, autor_id from contrato_movimentos where contrato_id = '${contrato1}' order by created_at desc, id desc limit 1`);
}, false, (r) => r.rows[0].tipo === "etapa" && r.rows[0].autor_id === M && r.rows[0].de_etapa_id !== r.rows[0].para_etapa_id);
await espera("perder e reabrir também entram na linha do tempo", async () => {
  await como("authenticated", M, `update contratos set cancelado_em = now(), motivo_cancelamento = 'desistiu' where id = '${contrato1}'`);
  await como("authenticated", M, `update contratos set cancelado_em = null, motivo_cancelamento = null where id = '${contrato1}'`);
  return db.query(`select tipo, motivo from contrato_movimentos where contrato_id = '${contrato1}' and tipo in ('perdido','reaberto') order by created_at, id`);
}, false, (r) => r.rows.length === 2 && r.rows[0].tipo === "perdido" && r.rows[0].motivo === "desistiu" && r.rows[1].tipo === "reaberto");
await espera("a equipe do contrato lê a linha do tempo; o colaborador B não", async () => {
  const a = await como("authenticated", M, `select count(*) as n from contrato_movimentos where contrato_id = '${contrato1}'`);
  const b = await como("authenticated", B, `select count(*) as n from contrato_movimentos where contrato_id = '${contrato1}'`);
  return { rows: [Number(a.rows[0].n), Number(b.rows[0].n)] };
}, false, (r) => r.rows[0] >= 4 && r.rows[1] === 0);
await espera("ninguém escreve na linha do tempo pela API", () => como("authenticated", G, `insert into contrato_movimentos (contrato_id, tipo) values ('${contrato1}', 'etapa')`), true);
await espera("tempo médio por etapa: a passagem de ~3 dias aparece", () => como("authenticated", M, "select q_tempo_por_etapa(90) as t"), false, (r) => r.rows[0].t.some((x) => Number(x.media_dias) >= 1 && x.passagens >= 1));
await espera("o colaborador B mede só a carteira dele (vazio)", () => como("authenticated", B, "select q_tempo_por_etapa(90) as t"), false, (r) => r.rows[0].t.length === 0);

// ── LGPD: termo de privacidade
await espera("sem termo ativo, o portal não pede aceite", () => como("authenticated", P, "select portal_privacidade() as t"), false, (r) => r.rows[0].t === null);
const termo0 = (await db.query("select id from privacidade_termos order by versao limit 1")).rows[0].id;
await espera("termo de partida com [PREENCHER] não publica", () => como("authenticated", G, `select q_privacidade_publicar('${termo0}')`), true);
let termo1;
await espera("gestor cria versão completa e publica", async () => {
  termo1 = (await como("authenticated", G, "insert into privacidade_termos (titulo, texto) values ('Política', '# POLÍTICA\n\nTexto completo v1.') returning id")).rows[0].id;
  await como("authenticated", G, `select q_privacidade_publicar('${termo1}')`);
  return db.query("select id from privacidade_termos where ativo");
}, false, (r) => r.rows.length === 1 && r.rows[0].id === termo1);
await espera("colaborador não publica nem cria termo", () => como("authenticated", M, `select q_privacidade_publicar('${termo1}')`), true);
await espera("colaborador não cria versão", () => como("authenticated", M, "insert into privacidade_termos (titulo, texto) values ('x', 'y')"), true);
await espera("o texto de uma versão não muda (nem pelo dono do banco)", () => db.query(`update privacidade_termos set texto = 'outro' where id = '${termo1}'`), true);
await espera("o cliente vê o termo pendente", () => como("authenticated", P, "select portal_privacidade() as t"), false, (r) => r.rows[0].t?.id === termo1 && r.rows[0].t.aceito_em === null);
await espera("o cliente aceita: fica a prova (IP, navegador, hash do texto)", async () => {
  await comoCliente(`select portal_aceitar_privacidade('${termo1}')`);
  await comoCliente(`select portal_aceitar_privacidade('${termo1}')`);
  return db.query(`select count(*) as n, max(ip) as ip, max(user_agent) as ua, max(texto_hash) as h from privacidade_aceites where termo_id = '${termo1}'`);
}, false, (r) => Number(r.rows[0].n) === 1 && r.rows[0].ip === "200.1.2.3" && r.rows[0].ua === "NavegadorTeste/1.0" && r.rows[0].h.length === 64);
await espera("aceito, o portal não pede de novo", () => como("authenticated", P, "select portal_privacidade() as t"), false, (r) => r.rows[0].t.aceito_em !== null);
await espera("o consultor vê o aceite do cliente dele; B não", async () => {
  const a = await como("authenticated", M, "select count(*) as n from privacidade_aceites");
  const b = await como("authenticated", B, "select count(*) as n from privacidade_aceites");
  return { rows: [Number(a.rows[0].n), Number(b.rows[0].n)] };
}, false, (r) => r.rows[0] === 1 && r.rows[1] === 0);
await espera("ninguém grava aceite pela API", () => como("authenticated", P, `insert into privacidade_aceites (termo_id, cliente_id, user_id, texto_hash) values ('${termo1}', '${clienteDoA}', '${P}', 'x')`), true);
await espera("termo que saiu de vigor não se aceita", async () => {
  const t2 = (await como("authenticated", G, "insert into privacidade_termos (titulo, texto) values ('Política', 'Texto v2.') returning id")).rows[0].id;
  await como("authenticated", G, `select q_privacidade_publicar('${t2}')`);
  return comoCliente(`select portal_aceitar_privacidade('${termo1}')`);
}, true);
await espera("versão nova publicada → o cliente aceita de novo", () => como("authenticated", P, "select portal_privacidade() as t"), false, (r) => r.rows[0].t.aceito_em === null && r.rows[0].t.id !== termo1);

// ── LGPD: exportar os dados de um cliente
await espera("gestor exporta tudo do cliente (e fica registrado)", async () => {
  const r = await como("authenticated", G, `select q_cliente_exportar('${clienteDoA}') as d`);
  const n = await db.query(`select count(*) as n from lgpd_exportacoes where cliente_id = '${clienteDoA}'`);
  return { rows: [r.rows[0].d, Number(n.rows[0].n)] };
}, false, (r) => r.rows[0].cliente.documento === "12345678901" && r.rows[0].contratos.length >= 1 && r.rows[0].contratos[0].movimentos.length >= 1
  && r.rows[0].atendimentos.some((a) => a.mensagens.length > 0) && r.rows[0].privacidade_aceites.length === 1 && !("busca" in r.rows[0].cliente) && r.rows[1] === 1);
await espera("colaborador não exporta (nem cliente da própria carteira)", () => como("authenticated", M, `select q_cliente_exportar('${clienteDoA}')`), true);
await espera("o cliente não exporta pela função da equipe", () => como("authenticated", P, `select q_cliente_exportar('${clienteDoA}')`), true);

// ── ADMINISTRADOR: acima do gestor, invisível para os outros
const ADM = "00000000-0000-0000-0000-0000000000ad";
await espera("o admin nasce pelo SQL Editor (sem usuário na sessão)", async () => {
  await db.query(`insert into auth.users (id, email, encrypted_password) values ('${ADM}', 'dono@quadrum.com.br', extensions.crypt('x', extensions.gen_salt('bf')))`);
  return db.query(`insert into perfis (id, nome, email, papel) values ('${ADM}', 'Dono', 'dono@quadrum.com.br', 'admin') returning id`);
}, false, (r) => r.rows.length === 1);
await espera("admin vale como gestor (vê a carteira inteira)", () => como("authenticated", ADM, "select q_e_gestor() as g, q_e_admin() as a, (select count(*) from clientes) as n"), false, (r) => r.rows[0].g && r.rows[0].a && Number(r.rows[0].n) > 0);
await espera("o gestor NÃO vê o admin na lista de perfis", () => como("authenticated", G, `select count(*) as n from perfis where id = '${ADM}'`), false, (r) => Number(r.rows[0].n) === 0);
await espera("o colaborador também não", () => como("authenticated", M, `select count(*) as n from perfis where id = '${ADM}'`), false, (r) => Number(r.rows[0].n) === 0);
await espera("o admin vê a si mesmo e a equipe toda", () => como("authenticated", ADM, "select count(*) as n from perfis"), false, (r) => Number(r.rows[0].n) >= 4);
await espera("gestor não rebaixa nem desativa o admin", async () => {
  await como("authenticated", G, `update perfis set ativo = false where id = '${ADM}'`);
  return db.query(`select ativo from perfis where id = '${ADM}'`);
}, false, (r) => r.rows[0].ativo === true);
await espera("gestor não dá o nível admin a ninguém", () => como("authenticated", G, `update perfis set papel = 'admin' where id = '${M}'`), true);
await espera("gestor não cria perfil admin", () => como("authenticated", G, `insert into perfis (id, nome, papel) values ('${B}', 'x', 'admin')`), true);
await espera("o admin edita o próprio perfil", () => como("authenticated", ADM, `update perfis set nome = 'Dono do Sistema' where id = '${ADM}' returning nome`), false, (r) => r.rows[0]?.nome === "Dono do Sistema");

// ── acessos: cada login fica registrado; só o admin vê
await espera("o login registra o acesso com IP e navegador (equipe)", async () => {
  await sql(`reset role; select set_config('request.jwt.claim.sub', '${M}', false); select set_config('request.headers', '{"x-forwarded-for":"177.1.1.1, 10.0.0.1","user-agent":"Chrome Teste"}', false); set role authenticated;`);
  try { await db.query("select q_registrar_acesso('admin')"); } finally { await sql("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);"); }
  return db.query(`select app, ip, user_agent from acessos where user_id = '${M}'`);
}, false, (r) => r.rows[0]?.app === "admin" && r.rows[0].ip === "177.1.1.1" && r.rows[0].user_agent === "Chrome Teste");
await espera("o cliente do portal também registra", async () => { await comoCliente("select q_registrar_acesso('portal')"); return db.query(`select count(*) as n from acessos where user_id = '${P}' and app = 'portal'`); }, false, (r) => Number(r.rows[0].n) === 1);
await espera("app desconhecido é recusado", () => como("authenticated", M, "select q_registrar_acesso('outro')"), true);
await espera("anon não registra acesso", () => como("anon", null, "select q_registrar_acesso('admin')"), true);
await espera("ninguém lê a tabela de acessos direto (nem o gestor)", () => como("authenticated", G, "select * from acessos"), true);
await espera("o admin vê todos, equipe e clientes, com o último acesso", () => como("authenticated", ADM, "select q_acessos_pessoas('', 'todos', 'todos', 1, 100) as p"), false, (r) => {
  const p = r.rows[0].p; const m = p.linhas.find((x) => x.user_id === M);
  return p.contagem.equipe >= 4 && p.contagem.clientes >= 1 && m?.ip === "177.1.1.1" && m.acessos_30d === 1 && p.linhas[0].ultimo_acesso !== null;
});
await espera("filtro de clientes e busca sem acento", () => como("authenticated", ADM, "select q_acessos_pessoas('cliente do a', 'clientes', 'todos', 1, 20) as p"), false, (r) => r.rows[0].p.linhas.length === 1 && r.rows[0].p.linhas[0].tipo === "cliente");
await espera("o resumo conta quem entrou hoje e os logins do dia", () => como("authenticated", ADM, "select q_acessos_pessoas() as p"), false, (r) => {
  const p = r.rows[0].p; return p.resumo.hoje >= 2 && p.resumo.logins_hoje >= 2 && p.resumo.d7 >= p.resumo.hoje && p.resumo.d30 >= p.resumo.d7 && p.resumo.pessoas === p.contagem.todos;
});
await espera("14 dias de logins, o de hoje por último", () => como("authenticated", ADM, "select q_acessos_pessoas() as p"), false, (r) => {
  const d = r.rows[0].p.por_dia; return d.length === 14 && d[13].logins >= 2 && d[13].pessoas >= 2 && d[0].logins === 0;
});
await espera("filtro 'nunca entrou' e a situação de cada um", () => como("authenticated", ADM, "select q_acessos_pessoas('', 'todos', 'nunca', 1, 100) as p, q_acessos_pessoas('', 'equipe', 'hoje', 1, 100) as h"), false, (r) => {
  const p = r.rows[0].p, h = r.rows[0].h;
  return p.linhas.every((x) => x.status === "nunca" && x.ultimo_acesso === null) && p.total === p.resumo.nunca
    && h.linhas.some((x) => x.user_id === M && x.status === "hoje" && x.user_agent === "Chrome Teste") && h.linhas.every((x) => x.tipo === "equipe");
});
await espera("o resumo segue o tipo (equipe não conta cliente)", () => como("authenticated", ADM, "select q_acessos_pessoas('', 'equipe') as e, q_acessos_pessoas('', 'clientes') as c, q_acessos_pessoas() as t"), false, (r) => r.rows[0].e.resumo.pessoas + r.rows[0].c.resumo.pessoas === r.rows[0].t.resumo.pessoas);
await espera("os acessos de uma pessoa", () => como("authenticated", ADM, `select q_acessos_de('${M}', 10) as a`), false, (r) => r.rows[0].a.length === 1 && r.rows[0].a[0].ip === "177.1.1.1");
await espera("o gestor não vê a tela de acessos", () => como("authenticated", G, "select q_acessos_pessoas('', 'todos', 'todos', 1, 20)"), true);
await espera("o colaborador também não", () => como("authenticated", M, `select q_acessos_de('${M}', 10)`), true);


// ── CPF/CNPJ só na entrada do portal (20261023000000)
await espera("contrato nasce SÓ com o nome (cliente sem documento)", () => como("authenticated", M, "insert into clientes (nome) values ('Sem Documento Souza') returning documento, busca"), false, (r) => r.rows[0].documento === null && r.rows[0].busca.includes("souza"));
const semDoc = (await db.query("select id from clientes where nome = 'Sem Documento Souza'")).rows[0].id;
await espera("a busca por nome acha o cliente sem documento", () => como("authenticated", M, "select q_clientes_pagina('documento souza') as p"), false, (r) => r.rows[0].p.linhas.length === 1);
await espera("dois clientes sem documento convivem (UNIQUE deixa nulos)", () => como("authenticated", M, "insert into clientes (nome) values ('Outro Sem Doc') returning id"), false, n(1));
const primeiraEtapa = await etapa("Novo contato");
await espera("contrato do cliente sem documento entra em Novo contato", () => como("authenticated", M, `insert into contratos (cliente_id, etapa_id) values ('${semDoc}', '${primeiraEtapa}') returning numero`), false, n(1));
const ctSemDoc = (await db.query(`select id from contratos where cliente_id = '${semDoc}'`)).rows[0].id;
await espera("sem documento, NÃO entra em 'Criar Perfil no Portal'", () => como("authenticated", M, `update contratos set etapa_id='${aceito}' where id='${ctSemDoc}'`), true);
await espera("sem documento, nem NASCE na etapa do portal", () => como("authenticated", M, `insert into contratos (cliente_id, etapa_id) values ('${semDoc}', '${aceito}')`), true);
await espera("sem documento, não cria acesso ao portal", () => como("authenticated", M, `select q_portal_definir_senha('${semDoc}', 'segredo123')`), true);
await espera("as outras etapas seguem livres sem documento", () => como("authenticated", M, `update contratos set etapa_id='${proposta}' where id='${ctSemDoc}' returning id`), false, n(1));
await espera("informar o documento depois", () => como("authenticated", M, `update clientes set documento='11122233344' where id='${semDoc}' returning tipo_pessoa, busca`), false, (r) => r.rows[0].tipo_pessoa === "PF" && r.rows[0].busca.includes("11122233344"));
await espera("com documento, entra na etapa do portal (data_aceite)", () => como("authenticated", M, `update contratos set etapa_id='${aceito}' where id='${ctSemDoc}' returning data_aceite is not null as ok`), false, (r) => r.rows[0].ok);
await espera("com contrato no portal, o documento não some", () => como("authenticated", M, `update clientes set documento=null where id='${semDoc}'`), true);
await espera("ainda sem acesso ao portal, o documento pode ser CORRIGIDO", () => como("authenticated", M, `update clientes set documento='11122233355' where id='${semDoc}' returning id`), false, n(1));
await espera("cria o acesso ao portal", () => como("authenticated", M, `select q_portal_definir_senha('${semDoc}', 'segredo123') as email`), false, (r) => r.rows[0].email === "11122233355@portal.quadrum.example");
await espera("com acesso ao portal, o documento (o login) não muda", () => como("authenticated", G, `update clientes set documento='99988877766' where id='${semDoc}'`), true);
await espera("mudar outro campo do cliente segue livre", () => como("authenticated", M, `update clientes set telefone='84999990000' where id='${semDoc}' returning id`), false, n(1));


// ── carteira de cada pessoa da equipe (20261026000000)
await espera("o gestor vê a carteira de cada um", () => como("authenticated", G, "select q_equipe_carteira() as c"), false, (r) => {
  const c = r.rows[0].c; return c[M] && c[M].clientes >= 1 && c[M].andamento + c[M].portal >= 1 && c[M].ultimo_acesso === null && !c[ADM];
});
await espera("o admin vê a si mesmo e o último acesso de cada um", () => como("authenticated", ADM, "select q_equipe_carteira() as c"), false, (r) => {
  const c = r.rows[0].c; return !!c[ADM] && c[M].ultimo_acesso !== null;
});
await espera("o colaborador não vê a carteira da equipe", () => como("authenticated", M, "select q_equipe_carteira()"), true);
await espera("o cliente do portal também não", () => comoCliente("select q_equipe_carteira()"), true);


// ── o contrato real e os campos que ele pede (20261027000000)
const modContrato = (await db.query("select id, corpo from documento_modelos where tipo = 'contrato'")).rows[0];
await espera("o contrato real não usa campo inexistente", () => como("authenticated", M, `select q_documento_previa($q$${modContrato.corpo}$q$) as p`), false, (r) => r.rows[0].p.desconhecidas.length === 0);
await espera("colaborador não altera os dados da empresa (0)", () => como("authenticated", M, "update empresa set cnpj = '11111111111111' returning id"), false, n(0));
await espera("a empresa tem UMA linha só", () => como("authenticated", G, "insert into empresa (id, nome) values (false, 'X')"), true);
await espera("gestor preenche os dados da empresa", () => como("authenticated", G, "update empresa set cnpj = '11222333000181', endereco = 'Natal/RN', telefones = '(84) 3000-0000', email = 'contato@quadrum.com.br' returning nome"), false, (r) => r.rows[0]?.nome === "TRICONECTA");
await espera("a equipe lê a empresa; o cliente do portal não", async () => {
  const a = await como("authenticated", M, "select count(*) as n from empresa"); const c = await comoCliente("select count(*) as n from empresa");
  return { rows: [Number(a.rows[0].n), Number(c.rows[0].n)] };
}, false, (r) => r.rows[0] === 1 && r.rows[1] === 0);
await sql("insert into unidades (nome, cidade, uf) select 'Matriz', 'Natal', 'RN' where not exists (select 1 from unidades)");
const ctReal = (await como("authenticated", M, `insert into contratos (cliente_id, banco_id, placa, veiculo, ano_modelo, unidade_id) values ('${clienteDoA}', (select id from bancos limit 1), 'ABC1D23', 'Carro Teste 1.0', '2020/2021', (select id from unidades limit 1)) returning id`)).rows[0].id;
await espera("parcelas pagas maiores que o total são recusadas", () => como("authenticated", M, `update contratos set qtd_parcelas = 10, parcelas_pagas = 11 where id = '${ctReal}'`), true);
await sql(`update unidades set cidade = 'Natal', uf = 'RN'; update clientes set sexo = 'Masculino', data_nascimento = '1990-01-15', telefone = '(84) 90000-0000' where id = '${clienteDoA}'`);
await espera("o contrato preenchido: nada falta, valores e cálculos certos", async () => {
  await como("authenticated", M, `update contratos set renavam = '12345678900', chassi = '9XXZZZ00000000001', veiculo_no_endereco = true,
    saldo_devedor = 32375, valor_parcela = 1295, parcela_balao = 0, qtd_parcelas = 48, parcelas_pagas = 23, parcelas_atrasadas = 1,
    ultima_parcela_paga = (current_date - interval '5 months')::date,
    plano_valor_total = 2400, plano_entrada = 400, plano_parcelas = 10, plano_valor_parcela = 200, plano_primeiro_vencimento = '2026-11-10', plano_forma = 'Boleto bancário'
    where id = '${ctReal}'`);
  return como("authenticated", M, `select q_documento_previa($q$${modContrato.corpo}$q$, '${ctReal}') as p`);
}, false, (r) => {
  const p = r.rows[0].p; const t = p.texto;
  return p.faltando.length === 0 && t.includes("Saldo devedor atual: R$ 32.375,00") && t.includes("Parcela balão: R$ 0,00")
    && t.includes("parcelas restantes: 25") && t.includes("último pagamento: 5") && t.includes("endereço do financiamento: SIM")
    && t.includes("Valor total de R$ 2.400,00, sendo entrada de R$ 400,00 e 10 parcelas de R$ 200,00, com primeiro vencimento em 10/11/2026, por boleto bancário.")
    && t.includes("CNPJ sob o nº 11.222.333/0001-81") && t.includes("- Natal, RN") && t.includes("Nome: Cliente do A\nData de nascimento: 15/01/1990");
});
await espera("titular OUTRO: os dados dele entram, e faltando ele RECUSA", async () => {
  await como("authenticated", M, `update contratos set titular_outro = true, titular_nome = 'Maria Titular', titular_documento = '98765432100' where id = '${ctReal}'`);
  return como("authenticated", M, `select q_documento_previa($q$${modContrato.corpo}$q$, '${ctReal}') as p`);
}, false, (r) => { const p = r.rows[0].p; const f = p.faltando.map((x) => x.chave);
  return p.texto.includes("Nome: Maria Titular") && p.texto.includes("CPF: 987.654.321-00") && f.includes("titular.endereco") && f.includes("titular.rg") && !f.includes("cliente.rg"); });


// ── a empresa virou TriConecta (20261028000000)
await espera("o robô fala TriConecta, e Quadrum nenhuma", () => db.query("select pg_get_functiondef('portal_abrir_atendimento(uuid, uuid, text)'::regprocedure) as d"), false,
  (r) => r.rows[0].d.includes("atendimento da TriConecta.") && r.rows[0].d.includes("contato com a TriConecta.") && !r.rows[0].d.includes("Quadrum"));
await espera("o robô continua fechado para anon", () => como("anon", null, `select portal_abrir_atendimento('${contrato1}', '${setor}', 'x')`), true);
await espera("nenhum modelo cita a Quadrum, e todos usam só campos que existem", async () => {
  const m = (await db.query("select corpo from documento_modelos")).rows;
  const prev = await Promise.all(m.map((x) => como("authenticated", G, `select q_documento_previa($q$${x.corpo}$q$) as p`)));
  return { rows: [m.some((x) => /quadrum/i.test(x.corpo)), prev.every((p) => p.rows[0].p.desconhecidas.length === 0)] };
}, false, (r) => r.rows[0] === false && r.rows[1] === true);
await espera("a procuração preenche a OUTORGADA com os Dados da empresa", async () => {
  const c = (await db.query("select corpo from documento_modelos where tipo = 'procuracao'")).rows[0].corpo;
  return como("authenticated", G, `select q_documento_previa($q$${c}$q$, '${ctReal}') as p`);
}, false, (r) => r.rows[0].p.texto.includes("TRICONECTA, inscrita no CNPJ sob o nº 11.222.333/0001-81, com sede em Natal/RN"));
await espera("termo de privacidade: versão NOVA, rascunho, com o nome novo", () => db.query("select texto, ativo from privacidade_termos where texto like '%TRICONECTA%'"), false,
  (r) => r.rows.length === 1 && r.rows[0].ativo === false && r.rows[0].texto.includes("A TRICONECTA ASSESSORIA") && r.rows[0].texto.includes('("TriConecta")') && !/quadrum/i.test(r.rows[0].texto));
await espera("a versão antiga do termo não mudou", () => db.query("select count(*) filter (where texto like '%QUADRUM%') as n from privacidade_termos"), false, (r) => Number(r.rows[0].n) === 1);
await espera("triconecta123 é senha fraca", () => db.query("select q_senha_fraca('triconecta123') as m"), false, (r) => r.rows[0].m?.includes("comum"));
await espera("rodar a migração de novo não muda nada", async () => {
  const antes = (await db.query("select count(*) as n from privacidade_termos")).rows[0].n;
  await db.exec(readFileSync(pasta + "20261028000000_triconecta.sql", "utf8"));
  return { rows: [antes, (await db.query("select count(*) as n from privacidade_termos")).rows[0].n] };
}, false, (r) => r.rows[0] === r.rows[1]);


// ── o contrato editado pela TriConecta (20261029000000)
await espera("o contrato v3: sediada na, assinatura da empresa e do contratante, e a 13.3 continua", async () => {
  const m = (await db.query("select corpo, versao from documento_modelos where tipo = 'contrato' and ativo")).rows;
  const p = await como("authenticated", M, `select q_documento_previa($q$${m[0].corpo}$q$, '${ctReal}') as p`);
  return { rows: [m.length, m[0].versao, p.rows[0].p.texto, p.rows[0].p.desconhecidas.length] };
}, false, (r) => r.rows[0] === 1 && r.rows[1] === 3 && r.rows[3] === 0
  && r.rows[2].includes("CNPJ sob o nº 11.222.333/0001-81, sediada na Natal/RN, telefone:")
  && r.rows[2].includes("**TRICONECTA**\nCNPJ: 11.222.333/0001-81\n\n**CONTRATANTE:** Cliente do A\nCPF: 123.456.789-01")
  && r.rows[2].includes("13.3 As partes concordam"));
await espera("Dados da empresa: CNPJ e sede entram só onde estavam VAZIOS", async () => {
  await sql("update empresa set nome = 'TRICONECTA ASSESSORIA', cnpj = null, endereco = 'Outra rua, 1'");
  await db.exec(readFileSync(pasta + "20261029000000_contrato_triconecta.sql", "utf8"));
  return db.query("select nome, cnpj, endereco from empresa");
}, false, (r) => r.rows[0].nome === "TRICONECTA" && r.rows[0].cnpj === "43082428000133" && r.rows[0].endereco === "Outra rua, 1");
await espera("rodar a migração do contrato de novo não muda nada", async () => {
  await db.exec(readFileSync(pasta + "20261029000000_contrato_triconecta.sql", "utf8"));
  return db.query("select versao from documento_modelos where tipo = 'contrato' and ativo");
}, false, (r) => r.rows[0].versao === 3);


// ── parcelas e pagamentos; unidade e linha padrão (20261030000000)
await espera("uma unidade e uma linha de crédito PADRÃO", () => db.query("select (select count(*) from unidades where padrao) as u, (select count(*) from linhas_credito where padrao) as l"), false,
  (r) => Number(r.rows[0].u) === 1 && Number(r.rows[0].l) === 1);
let ctPag;
await espera("contrato novo nasce com a unidade e a linha padrão", async () => {
  const r = await como("authenticated", M, `insert into contratos (cliente_id) values ('${clienteDoA}') returning id, unidade_id, linha_credito_id`);
  ctPag = r.rows[0].id;
  return db.query(`select k.unidade_id = (select id from unidades where padrao) as u, k.linha_credito_id = (select id from linhas_credito where padrao) as l from contratos k where k.id = '${ctPag}'`);
}, false, (r) => r.rows[0].u && r.rows[0].l);
await espera("esvaziar a unidade volta à padrão", async () => {
  await como("authenticated", M, `update contratos set unidade_id = null where id = '${ctPag}'`);
  return db.query(`select unidade_id is not null as ok from contratos where id = '${ctPag}'`);
}, false, (r) => r.rows[0].ok);
await espera("nenhum contrato sem unidade nem linha", () => db.query("select count(*) as n from contratos where unidade_id is null or linha_credito_id is null"), false, (r) => Number(r.rows[0].n) === 0);
await sql(`update contratos set etapa_id = (select id from pipeline_etapas where aceita limit 1) where id = '${ctPag}'`);
const plano = (itens) => `select q_parcelas_definir('${ctPag}', '${JSON.stringify(itens)}'::jsonb) as n`;
const hoje = (await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text as d")).rows[0].d;
await espera("o consultor define o plano: entrada + 3 parcelas", () => como("authenticated", M, plano([
  { numero: 0, valor: 100, vencimento: hoje }, { numero: 1, valor: 200, vencimento: "2026-12-10" },
  { numero: 2, valor: 200, vencimento: "2027-01-10" }, { numero: 3, valor: 200, vencimento: "2027-02-10" }])), false, (r) => r.rows[0].n === 4);
await espera("o colaborador de OUTRA carteira não define o plano", () => como("authenticated", B, plano([{ numero: 1, valor: 1, vencimento: hoje }])), true);
await espera("o cliente do portal não define o plano", () => comoCliente(plano([{ numero: 1, valor: 1, vencimento: hoje }])), true);
await espera("ninguém grava parcela direto na tabela", () => como("authenticated", G, `insert into contrato_parcelas (contrato_id, numero, valor, vencimento) values ('${ctPag}', 9, 1, '${hoje}')`), true);
await espera("parcela repetida ou sem valor é recusada", () => como("authenticated", M, plano([{ numero: 1, valor: 200, vencimento: hoje }, { numero: 1, valor: 200, vencimento: hoje }])), true);
await espera("refazer o plano: a 3 sai (cancelada, não apagada) e a 1 muda de data", async () => {
  await como("authenticated", M, plano([{ numero: 0, valor: 100, vencimento: hoje }, { numero: 1, valor: 200, vencimento: "2026-12-15" }, { numero: 2, valor: 200, vencimento: "2027-01-10" }]));
  return db.query(`select (select count(*) from contrato_parcelas where contrato_id = '${ctPag}' and cancelada_em is null) as ativas,
    (select count(*) from contrato_parcelas where contrato_id = '${ctPag}') as todas,
    (select vencimento::text from contrato_parcelas where contrato_id = '${ctPag}' and numero = 1 and cancelada_em is null) as venc,
    (select string_agg(tipo, ',' order by tipo) from parcela_eventos where contrato_id = '${ctPag}' and tipo <> 'criada') as ev`);
}, false, (r) => Number(r.rows[0].ativas) === 3 && Number(r.rows[0].todas) === 4 && r.rows[0].venc === "2026-12-15" && r.rows[0].ev === "alterada,cancelada");
const parc = async (num) => (await db.query(`select id from contrato_parcelas where contrato_id = '${ctPag}' and numero = ${num} and cancelada_em is null`)).rows[0].id;
await espera("a equipe marca a entrada como paga (dinheiro)", async () => como("authenticated", M, `select q_parcela_pagar('${await parc(0)}', '${hoje}', 'Dinheiro', 'recebido na loja')`), false);
await espera("o cliente é avisado do pagamento", async () => ({ rows: (await notif(P)).itens }), false, (r) => r.rows.some((i) => i.tipo === "pagamento_confirmado" && i.link === "/pagamentos"));
await espera("pagar de novo é recusado", async () => como("authenticated", M, `select q_parcela_pagar('${await parc(0)}', '${hoje}', 'PIX')`), true);
await espera("pagamento no futuro é recusado", async () => como("authenticated", M, `select q_parcela_pagar('${await parc(1)}', '2099-01-01', 'PIX')`), true);
await espera("sem forma de pagamento é recusado", async () => como("authenticated", M, `select q_parcela_pagar('${await parc(1)}', '${hoje}', '  ')`), true);
await espera("o plano não muda a parcela PAGA", () => como("authenticated", M, plano([{ numero: 0, valor: 150, vencimento: hoje }, { numero: 1, valor: 200, vencimento: "2026-12-15" }, { numero: 2, valor: 200, vencimento: "2027-01-10" }])), true);
await espera("nem tira a parcela paga do plano", () => como("authenticated", M, plano([{ numero: 1, valor: 200, vencimento: "2026-12-15" }])), true);
await espera("o colaborador não desfaz pagamento", async () => como("authenticated", M, `select q_parcela_desfazer_pagamento('${await parc(0)}', 'engano')`), true);
await espera("o gestor desfaz, com motivo, e fica na trilha", async () => {
  await como("authenticated", G, `select q_parcela_desfazer_pagamento('${await parc(0)}', 'lançado no contrato errado')`);
  return db.query(`select p.pago_em, (select dados->>'motivo' from parcela_eventos e where e.parcela_id = p.id and e.tipo = 'pagamento_desfeito') as motivo from contrato_parcelas p where p.id = '${await parc(0)}'`);
}, false, (r) => r.rows[0].pago_em === null && r.rows[0].motivo === "lançado no contrato errado");
await como("authenticated", M, `select q_parcela_pagar('${await parc(0)}', '${hoje}', 'PIX', 'interno')`);
await espera("o portal mostra as parcelas, sem a observação interna", () => comoCliente("select portal_pagamentos() as p"), false, (r) => {
  const k = r.rows[0].p.find((x) => x.contrato_id === ctPag);
  return k && k.parcelas.length === 3 && k.parcelas[0].pago_forma === "PIX" && !JSON.stringify(k).includes("interno") && !("pago_obs" in k.parcelas[0]);
});
await espera("o colaborador A vê as parcelas; o B não", async () => {
  const a = await como("authenticated", M, `select count(*) as n from contrato_parcelas where contrato_id = '${ctPag}'`);
  const b = await como("authenticated", B, `select count(*) as n from contrato_parcelas where contrato_id = '${ctPag}'`);
  return { rows: [Number(a.rows[0].n), Number(b.rows[0].n)] };
}, false, (r) => r.rows[0] === 4 && r.rows[1] === 0);
await espera("o cliente não lê a tabela de parcelas", () => comoCliente("select count(*) as n from contrato_parcelas"), false, (r) => Number(r.rows[0].n) === 0);
await espera("anon não chama portal_pagamentos nem q_parcela_pagar", async () => {
  const a = await como("anon", null, "select portal_pagamentos()").then(() => "ok", () => "erro");
  const b = await como("anon", null, `select q_parcela_pagar('${await parc(1)}', '${hoje}', 'PIX')`).then(() => "ok", () => "erro");
  return { rows: [a, b] };
}, false, (r) => r.rows[0] === "erro" && r.rows[1] === "erro");
await espera("exportar os dados do cliente (LGPD) leva as parcelas", () => como("authenticated", G, `select q_cliente_exportar('${clienteDoA}') as j`), false,
  (r) => r.rows[0].j.contratos.some((k) => (k.parcelas ?? []).length === 4));
// ── comprovante na parcela (20261031000000)
const p1 = await parc(1);
await como("authenticated", M, `select q_parcela_pagar('${p1}', '${hoje}', 'PIX')`);
const pasta1 = `${ctPag}/${p1}`;
await espera("o bucket de comprovantes é PRIVADO", () => db.query("select public from storage.buckets where id = 'comprovantes'"), false, (r) => r.rows[0]?.public === false);
await espera("o consultor envia o comprovante na pasta do contrato dele", () => como("authenticated", M, `insert into storage.objects (bucket_id, name) values ('comprovantes', '${pasta1}/a.webp') returning id`), false, n(1));
await espera("o colaborador de OUTRA carteira não envia nem lê", async () => {
  const e = await como("authenticated", B, `insert into storage.objects (bucket_id, name) values ('comprovantes', '${pasta1}/b.webp')`).then(() => "ok", () => "erro");
  const l = await como("authenticated", B, `select count(*) as n from storage.objects where bucket_id = 'comprovantes'`);
  return { rows: [e, Number(l.rows[0].n)] };
}, false, (r) => r.rows[0] === "erro" && r.rows[1] === 0);
await espera("o cliente não envia comprovante", () => comoCliente(`insert into storage.objects (bucket_id, name) values ('comprovantes', '${pasta1}/c.webp')`), true);
await espera("ninguém troca nem apaga o arquivo", async () => {
  const u = await como("authenticated", G, `update storage.objects set name = name || 'x' where bucket_id = 'comprovantes' returning id`);
  const d = await como("authenticated", G, `delete from storage.objects where bucket_id = 'comprovantes' returning id`);
  return { rows: [u.rows.length, d.rows.length] };
}, false, (r) => r.rows[0] === 0 && r.rows[1] === 0);
await espera("anexar arquivo de FORA da pasta da parcela é recusado", () => como("authenticated", M, `select q_parcela_comprovante('${p1}', '${ctPag}/outra/a.webp')`), true);
await espera("anexar arquivo que não está no bucket é recusado", () => como("authenticated", M, `select q_parcela_comprovante('${p1}', '${pasta1}/nao-existe.webp')`), true);
await espera("o consultor anexa, e fica na trilha", async () => {
  await como("authenticated", M, `select q_parcela_comprovante('${p1}', '${pasta1}/a.webp')`);
  return db.query(`select p.comprovante_path, (select count(*) from parcela_eventos e where e.parcela_id = p.id and e.tipo = 'comprovante') as ev from contrato_parcelas p where p.id = '${p1}'`);
}, false, (r) => r.rows[0].comprovante_path === `${pasta1}/a.webp` && Number(r.rows[0].ev) === 1);
await espera("o colaborador B não anexa na parcela do A", () => como("authenticated", B, `select q_parcela_comprovante('${p1}', '${pasta1}/a.webp')`), true);
await espera("o portal mostra o comprovante, e o cliente lê o arquivo dele", async () => {
  const pg = await comoCliente("select portal_pagamentos() as p");
  const l = await comoCliente(`select count(*) as n from storage.objects where bucket_id = 'comprovantes'`);
  const k = pg.rows[0].p.find((x) => x.contrato_id === ctPag);
  return { rows: [k.parcelas.find((x) => x.numero === 1).comprovante, Number(l.rows[0].n)] };
}, false, (r) => r.rows[0] === `${pasta1}/a.webp` && r.rows[1] === 1);
await espera("o cliente não lê comprovante de contrato de OUTRO cliente", async () => {
  const outro = (await db.query(`select k.id from contratos k where k.cliente_id <> '${clienteDoA}' limit 1`)).rows[0]?.id;
  await sql(`insert into storage.objects (bucket_id, name) values ('comprovantes', '${outro}/x/y.webp')`);
  return comoCliente(`select count(*) as n from storage.objects where bucket_id = 'comprovantes' and name like '${outro}/%'`);
}, false, (r) => Number(r.rows[0].n) === 0);
await espera("anon não lê comprovante nem anexa", async () => {
  const a = await como("anon", null, "select count(*) as n from storage.objects where bucket_id = 'comprovantes'").then((r) => Number(r.rows[0].n), () => 0);
  const b = await como("anon", null, `select q_parcela_comprovante('${p1}', '${pasta1}/a.webp')`).then(() => "ok", () => "erro");
  return { rows: [a, b] };
}, false, (r) => r.rows[0] === 0 && r.rows[1] === "erro");
await espera("contrato perdido não recebe plano", async () => {
  await sql(`update contratos set cancelado_em = now(), motivo_cancelamento = 'teste' where id = '${ctPag}'`);
  return como("authenticated", M, plano([]));
}, true);
await espera("rodar a migração das parcelas de novo não muda nada", async () => {
  await db.exec(readFileSync(pasta + "20261030000000_parcelas_e_pagamentos.sql", "utf8"));
  await db.exec(readFileSync(pasta + "20261031000000_comprovantes.sql", "utf8"));
  return db.query("select (select count(*) from unidades where padrao) as u, (select count(*) from contrato_parcelas) as p");
}, false, (r) => Number(r.rows[0].u) === 1 && Number(r.rows[0].p) === 4);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
