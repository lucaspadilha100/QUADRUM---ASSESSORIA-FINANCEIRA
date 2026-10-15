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
    confirmation_token text, recovery_token text, email_change_token_new text, email_change text
  );
  create table auth.identities (
    id uuid primary key, user_id uuid references auth.users(id), provider_id text, identity_data jsonb,
    provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
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
await espera("colaborador LÊ as etapas (7)", () => como("authenticated", B, "select * from pipeline_etapas"), false, n(7));
const proposta = await etapa("Proposta apresentada");
const aceito = await etapa("Contrato aceito");
await espera("A arrasta o próprio card para Proposta", () => como("authenticated", M, `update contratos set etapa_id='${proposta}' where numero=1 returning data_aceite`), false, (r) => r.rows.length === 1 && r.rows[0].data_aceite === null);
await espera("B NÃO move card do A (0)", () => como("authenticated", B, `update contratos set etapa_id='${aceito}' where numero=1 returning id`), false, n(0));
await espera("chegar em 'Contrato aceito' grava data_aceite = hoje", () => como("authenticated", M, `update contratos set etapa_id='${aceito}' where numero=1 returning data_aceite = current_date as hoje`), false, (r) => r.rows[0].hoje === true);
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
  const c = r.rows[0].p.colunas.find((x) => x.etapa_id === primeira); return r.rows[0].p.colunas.length === 7 && c.total === 3 && c.cards.length === 2;
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
await espera("os 4 modelos de partida nascem INATIVOS", () => db.query("select count(*) filter (where not ativo) as n from documento_modelos"), false, (r) => Number(r.rows[0].n) === 4);
const modProc = (await db.query("select id from documento_modelos where tipo = 'procuracao'")).rows[0].id;
const modTermo = (await db.query("select id from documento_modelos where tipo = 'termo'")).rows[0].id;
await espera("modelo inativo não gera", () => como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
await espera("colaborador não altera modelo (0)", () => como("authenticated", M, `update documento_modelos set ativo = true where id = '${modProc}' returning id`), false, n(0));
await espera("gestor edita o modelo: versão sobe", () => como("authenticated", G, `update documento_modelos set ativo = true, corpo = corpo || ' ' where id = '${modProc}' returning versao`), false, (r) => r.rows[0].versao === 2);
await sql(`update documento_modelos set ativo = true where id = '${modTermo}'`);
await espera("prévia sem contrato mostra os campos como [rótulo] e acusa campo inexistente", () => como("authenticated", M, "select q_documento_previa('Eu, {{cliente.nome}}, {{cliente.xyz}}') as p"), false, (r) => r.rows[0].p.texto.startsWith("Eu, [Nome / razão social]") && r.rows[0].p.desconhecidas[0] === "cliente.xyz");
await espera("gerar com cadastro incompleto RECUSA e diz o que falta", () => como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
await sql(`update clientes set nacionalidade='brasileira', estado_civil='casado(a)', profissao='motorista', rg='1234567', rg_orgao='SSP/RN',
  logradouro='Rua das Flores', endereco_numero='10', bairro='Centro', cidade='Natal', uf='RN', cep='59000-000' where id = '${clienteDoA}'`);
await sql(`update bancos set nome = 'Banco X'; update contratos set banco_id = (select id from bancos limit 1), linha_credito_id = (select id from linhas_credito limit 1) where id = '${contrato1}'`);
await espera("B não gera documento em contrato do A", () => como("authenticated", B, `select q_documento_gerar('${contrato1}', '${modProc}')`), true);
let docProc;
await espera("A gera a procuração preenchida, com hash", async () => {
  const r = await como("authenticated", M, `select q_documento_gerar('${contrato1}', '${modProc}') as id`);
  docProc = r.rows[0].id;
  return db.query(`select conteudo, conteudo_hash = encode(extensions.digest(convert_to(conteudo, 'UTF8'), 'sha256'), 'hex') as hash_ok, modelo_versao from contrato_documentos where id = '${docProc}'`);
}, false, (r) => r.rows[0].hash_ok && r.rows[0].modelo_versao === 2 && !r.rows[0].conteudo.includes("{{") && r.rows[0].conteudo.includes("Cliente do A, brasileira, casado(a), motorista, portador(a) do RG nº 1234567 SSP/RN, inscrito(a) no CPF sob o nº 123.456.789-01, residente e domiciliado(a) em Rua das Flores 10, Centro, Natal/RN, CEP 59000-000") && r.rows[0].conteudo.includes("Banco X"));
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
await espera("ASSINA: senha certa, nome (sem acento/maiúscula) e aceite", () => comoCliente(`select portal_assinar_documento('${docProc}', 'novasenha9', '  cliente  do a ', true) as r`), false, (r) => r.rows[0].r.ok === true && r.rows[0].r.documento.assinatura.ip === "200.1.2.3");
await espera("a prova fica gravada: IP, navegador, hash do texto, aceite, código", () => db.query(`select a.ip, a.user_agent, a.hash_sha256 = d.conteudo_hash as hash_ok, a.aceite_texto like 'Declaro que li%' as aceite, a.codigo_verificacao ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' as cod, a.visualizado_em is not null as viu, a.assinado_em = d.assinado_em as mesma_hora, a.signatario_documento from documento_assinaturas a join contrato_documentos d on d.id = a.documento_id where d.id = '${docProc}'`), false, (r) => {
  const a = r.rows[0]; return a.ip === "200.1.2.3" && a.user_agent === "NavegadorTeste/1.0" && a.hash_ok && a.aceite && a.cod && a.viu && a.mesma_hora && a.signatario_documento === "12345678901";
});
await espera("não assina duas vezes", () => comoCliente(`select portal_assinar_documento('${docProc}', 'novasenha9', 'Cliente do A', true)`), true);
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
  return comoCliente(`select portal_assinar_documento('${docTermo}', 'novasenha9', 'Cliente do A', true) as r`);
}, false, (r) => r.rows[0].r.ok === false && /tentativas/.test(r.rows[0].r.erro));
await espera("cancelar a pendência: vira evento e sai do portal", async () => {
  await como("authenticated", M, `update contrato_documentos set cancelado_em = now(), cancelado_por = '${M}', motivo_cancelamento = 'gerado errado' where id = '${docTermo}'`);
  return como("authenticated", P, "select portal_contratos() as c");
}, false, (r) => !r.rows[0].c[0].pendencias.some((p) => p.id === docTermo));
await espera("cancelado não volta", () => como("authenticated", M, `update contrato_documentos set cancelado_em = null where id = '${docTermo}'`), true);
await espera("cancelado não se assina", () => comoCliente(`select portal_assinar_documento('${docTermo}', 'novasenha9', 'Cliente do A', true)`), true);
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

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
