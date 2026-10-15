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
const M = "00000000-0000-0000-0000-00000000000b"; // membro
const C = "00000000-0000-0000-0000-00000000000c"; // cliente do portal (não é equipe)
await sql(`insert into auth.users values ('${G}','g@q'),('${M}','m@q'),('${C}','c@q');
  insert into public.equipe (id,nome,papel) values ('${G}','Gestora','gestor'),('${M}','Membro','membro');`);

let ok = 0, falhas = 0;
async function como(role, uid, q) {
  await sql(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try { return await db.query(q); } finally { await sql("reset role;"); }
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

await espera("anon não lê clientes", () => como("anon", null, "select * from clientes"), true);
await espera("cliente do portal não vê clientes (0 linhas)", () => como("authenticated", C, "select * from clientes"), false, (r) => r.rows.length === 0);
await espera("cliente do portal não cria cliente", () => como("authenticated", C, "insert into clientes (documento,nome) values ('12345678901','X')"), true);
await espera("documento formatado é recusado", () => como("authenticated", M, "insert into clientes (documento,nome) values ('123.456.789-01','X')"), true);
await espera("membro cria cliente (só dígitos)", () => como("authenticated", M, "insert into clientes (documento,nome) values ('12345678901','Fulano') returning tipo_pessoa, created_by"), false, (r) => r.rows[0].tipo_pessoa === "PF" && r.rows[0].created_by === M);
await espera("CNPJ vira PJ", () => como("authenticated", M, "insert into clientes (documento,nome) values ('12345678000199','Empresa') returning tipo_pessoa"), false, (r) => r.rows[0].tipo_pessoa === "PJ");
await espera("membro não cria banco (cadastro é do gestor)", () => como("authenticated", M, "insert into bancos (nome) values ('B')"), true);
await espera("gestor cria banco", () => como("authenticated", G, "insert into bancos (nome) values ('Banco X')"), false);
await espera("membro não apaga cliente (sem policy de DELETE)", () => como("authenticated", M, "delete from clientes returning id"), false, (r) => r.rows.length === 0);
await espera("membro cria contrato com número", () => como("authenticated", M, "insert into contratos (cliente_id) select id from clientes where documento='12345678901' returning numero"), false, (r) => Number(r.rows[0].numero) === 1);
await espera("histórico em nome de OUTRO é recusado", () => como("authenticated", M, `insert into contrato_historico (contrato_id, texto, autor_id) select id, 'x', '${G}' from contratos limit 1`), true);
await espera("histórico no próprio nome", () => como("authenticated", M, "insert into contrato_historico (contrato_id, texto) select id, 'Ligamos para o banco.' from contratos limit 1 returning autor_id"), false, (r) => r.rows[0].autor_id === M);
await espera("membro não corrige histórico (0 linhas)", () => como("authenticated", M, "update contrato_historico set texto='y' returning id"), false, (r) => r.rows.length === 0);
await espera("gestor corrige histórico", () => como("authenticated", G, "update contrato_historico set texto='Ligamos para o banco hoje.' returning id"), false, (r) => r.rows.length === 1);

const abre = `insert into atendimentos (cliente_id, setor_id, titulo)
  select (select id from clientes where documento='12345678901'), (select id from departamentos where nome='Acordo'), 'Quero negociar' returning id`;
await espera("abre atendimento", () => como("authenticated", M, abre), false);
await espera("SEGUNDO atendimento ativo do mesmo cliente é recusado", () => como("authenticated", M, abre), true);
await espera("equipe responde em nome próprio", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'equipe', '${M}', 'Olá!' from atendimentos`), false);
await espera("equipe NÃO escreve como cliente", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'cliente', '${M}', 'fake' from atendimentos`), true);
await espera("mensagem não se reescreve", () => como("authenticated", M, "update atendimento_mensagens set corpo='editado'"), true);
await espera("marcar como lida pode", () => como("authenticated", M, "update atendimento_mensagens set lida_em=now() returning id"), false, (r) => r.rows.length === 1);
await espera("arquiva", () => como("authenticated", M, `update atendimentos set arquivado_em=now(), arquivado_por='${M}' returning id`), false, (r) => r.rows.length === 1);
await espera("arquivado não recebe mensagem", () => como("authenticated", M, `insert into atendimento_mensagens (atendimento_id, autor_tipo, autor_id, corpo) select id, 'equipe', '${M}', 'oi' from atendimentos`), true);
await espera("depois de arquivar, pode abrir outro", () => como("authenticated", M, abre), false);
await espera("membro não se promove a gestor (0 linhas)", () => como("authenticated", M, `update equipe set papel='gestor' where id='${M}' returning id`), false, (r) => r.rows.length === 0);
await sql(`update equipe set ativo=false where id='${M}'`);
await espera("membro DESATIVADO não lê nada", () => como("authenticated", M, "select * from clientes"), false, (r) => r.rows.length === 0);
await espera("anon não executa q_e_equipe()", () => como("anon", null, "select public.q_e_equipe()"), true);
await espera("updated_at anda no update", () => db.query("select updated_at >= created_at as andou from atendimentos limit 1"), false);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
