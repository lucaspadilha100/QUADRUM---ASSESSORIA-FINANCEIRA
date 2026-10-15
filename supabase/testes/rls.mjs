// Testa as regras de acesso (RLS, CHECKs, gatilhos) num Postgres REAL em
// memória (PGlite), sem precisar do Supabase. Aplica TODAS as migrações em
// ordem e confere o que cada papel consegue fazer.
//
//   cd supabase/testes && npm install && npm test
//
// Teste novo de regra entra aqui. Regra que só existe na tela não é regra.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();
const sql = (q) => db.exec(q);

// Ambiente mínimo do Supabase: papéis, auth.users e auth.uid().
await sql(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
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
await sql(`insert into auth.users values ('${G}','g@q'),('${M}','m@q'),('${B}','b@q'),('${C}','c@q');
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

await espera("updated_at anda no update", () => db.query("select updated_at >= created_at as andou from atendimentos limit 1"), false);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
