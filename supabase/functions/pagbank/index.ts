// Edge Function `pagbank` — a equipe EMITE cobrança de uma parcela no PagBank
// (boleto, PIX ou link de cartão) e CONSULTA o estado de uma cobrança.
// Documentação: docs/integracao-pagbank.md.
//
// Segredos (Supabase → Edge Functions → Secrets):
//   PAGBANK_TOKEN      o token da conta (sandbox ou produção)
//   PAGBANK_AMBIENTE   "sandbox" | "producao" — troca a URL; nada mais muda
//
// Segurança: quem pede é a pessoa LOGADA (o token dela vai junto). Os dados da
// parcela são lidos COM o login dela (`q_parcela_dados_cobranca` recusa quem
// não vê o contrato). Gravar a cobrança é da service_role, aqui dentro: pela
// API ninguém grava cobrança nem marca pagamento.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("PAGBANK_TOKEN") ?? "";
const AMBIENTE = Deno.env.get("PAGBANK_AMBIENTE") === "producao" ? "producao" : "sandbox";
const API = AMBIENTE === "producao" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// O endereço do aviso; PAGBANK_WEBHOOK_URL só para teste fora do Supabase.
const WEBHOOK = Deno.env.get("PAGBANK_WEBHOOK_URL") ?? `${SUPABASE_URL}/functions/v1/pagbank-webhook`;

// Contrato, cláusula 9.3: multa de 10% e juros de 1% ao mês após o vencimento.
// Em "centavos de percentual" (PagBank): 10% = 1000, 1% = 100.
const MULTA = 1000;
const JUROS = 100;
const DIAS_BOLETO_PAGAVEL = 30; // depois do vencimento, com multa e juros
const PARCELAS_CARTAO = "12";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UF_NOME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const maisDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Boleto aceita no máximo 30 letras no nome: primeiro + último nome, e corta se ainda passar. */
function nomeBoleto(nome: string) {
  const n = semAcento(nome).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (n.length <= 30) return n;
  const p = n.split(" ");
  const curto = `${p[0]} ${p[p.length - 1]}`;
  return curto.length <= 30 ? curto : curto.slice(0, 30);
}

/** Celular brasileiro (DDD + 9 dígitos começando com 9), senão nulo. */
function celular(tel: unknown) {
  let d = digitos(tel);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length !== 11 || d[2] !== "9") return null;
  return { country: "55", area: d.slice(0, 2), number: d.slice(2) };
}

function erroPagBank(j: any) {
  const e = j?.error_messages?.[0];
  if (!e) return "Recusado pelo PagBank.";
  return [e.description ?? e.message, e.parameter_name].filter(Boolean).join(" — ");
}

async function pagbank(metodo: "GET" | "POST", caminho: string, corpo?: unknown) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* corpo não-JSON */ }
  return { ok: r.ok, status: r.status, json, texto };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta(405, { erro: "Use POST." });
  if (!TOKEN) return resposta(500, { erro: "PAGBANK_TOKEN não configurado nos segredos da função." });

  const auth = req.headers.get("Authorization") ?? "";
  const usuario = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: sessao } = await usuario.auth.getUser();
  if (!sessao?.user) return resposta(401, { erro: "Entre no sistema." });
  const servico = createClient(SUPABASE_URL, SERVICE);

  let corpo: any;
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "Corpo inválido." }); }

  if (corpo.acao === "emitir") return emitir(usuario, servico, sessao.user.id, corpo.parcela_id, corpo.tipo);
  if (corpo.acao === "consultar") return consultar(usuario, servico, corpo.cobranca_id);
  return resposta(400, { erro: "Ação desconhecida." });
});

// ── Emitir ──────────────────────────────────────────────────────────────────

async function emitir(usuario: any, servico: any, autor: string, parcelaId: string, tipo: string) {
  if (!["boleto", "pix", "link"].includes(tipo)) return resposta(400, { erro: "Tipo de cobrança inválido." });
  const { data: d, error } = await usuario.rpc("q_parcela_dados_cobranca", { p_parcela: parcelaId });
  if (error) return resposta(403, { erro: error.message });

  const p = d.parcela, c = d.cliente, k = d.contrato;
  if (p.pago) return resposta(400, { erro: "Esta parcela já está paga." });
  if (p.cancelada || k.cancelado) return resposta(400, { erro: "Parcela ou contrato cancelado." });

  // O PagBank exige nome, CPF/CNPJ e e-mail em TODA cobrança; o boleto, o endereço.
  const falta: string[] = [];
  const doc = digitos(c.documento);
  if (!c.nome?.trim()) falta.push("nome");
  if (doc.length !== 11 && doc.length !== 14) falta.push("CPF/CNPJ");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email ?? "")) falta.push("e-mail");
  const cep = digitos(c.cep), uf = String(c.uf ?? "").toUpperCase();
  if (tipo === "boleto") {
    if (!c.logradouro?.trim()) falta.push("rua");
    if (!c.bairro?.trim()) falta.push("bairro");
    if (!c.cidade?.trim()) falta.push("cidade");
    if (!UF_NOME[uf]) falta.push("UF");
    if (cep.length !== 8) falta.push("CEP");
  }
  if (falta.length) return resposta(400, { erro: `Falta no cadastro do cliente: ${falta.join(", ")}.`, falta });

  const id = crypto.randomUUID(); // a cobrança nossa = reference_id no PagBank
  const valor = Math.round(Number(p.valor) * 100);
  const rotulo = p.numero === 0 ? "Entrada" : `Parcela ${p.numero}/${d.total_parcelas}`;
  const descricao = `${rotulo} - contrato ${k.numero}`;
  const hoje = hojeBR();
  // Vencimento no passado não é aceito; o BOLETO não aceita nem hoje (medido
  // no sandbox: due_date de hoje = invalid_parameter) — vence amanhã.
  const minimo = tipo === "boleto" ? maisDias(hoje, 1) : hoje;
  const venc = p.vencimento < minimo ? minimo : p.vencimento;
  const fone = celular(c.telefone);
  const customer: any = { name: c.nome.trim().slice(0, 120), email: c.email.trim(), tax_id: doc };
  const item = { reference_id: id, name: descricao, quantity: 1, unit_amount: valor };

  let r;
  if (tipo === "link") {
    r = await pagbank("POST", "/checkouts", {
      reference_id: id,
      expiration_date: `${venc}T23:59:00-03:00`,
      ...(fone ? { customer: { ...customer, phone: fone }, customer_modifiable: false } : {}),
      items: [item],
      payment_methods: [{ type: "CREDIT_CARD" }],
      payment_methods_configs: [{ type: "CREDIT_CARD", config_options: [{ option: "INSTALLMENTS_LIMIT", value: PARCELAS_CARTAO }] }],
      soft_descriptor: "TRICONECTA",
      notification_urls: [WEBHOOK],
      payment_notification_urls: [WEBHOOK],
    });
  } else {
    const charge: any = { reference_id: id, description: descricao.slice(0, 64), amount: { value: valor, currency: "BRL" } };
    if (tipo === "boleto") {
      const depois = maisDias(venc, 1);
      charge.payment_instructions = { fine: { date: depois, value: MULTA }, interest: { date: depois, value: JUROS } };
      charge.payment_method = {
        type: "BOLETO",
        boleto: {
          template: "COBRANCA",
          due_date: venc,
          days_until_expiration: String(DIAS_BOLETO_PAGAVEL),
          instruction_lines: { line_1: "Apos o vencimento: multa de 10% e juros de 1% ao mes", line_2: descricao.slice(0, 75) },
          holder: {
            name: nomeBoleto(c.nome), tax_id: doc, email: c.email.trim(),
            address: {
              street: c.logradouro.trim().slice(0, 160), number: (c.numero ?? "").trim() || "S/N",
              ...(c.complemento?.trim() ? { complement: c.complemento.trim().slice(0, 40) } : {}),
              locality: c.bairro.trim().slice(0, 60), city: c.cidade.trim().slice(0, 90),
              region: UF_NOME[uf], region_code: uf, country: "Brasil", postal_code: cep,
            },
          },
        },
      };
    } else {
      // PIX vale até o fim do dia do vencimento: depois disso vale o boleto (com multa).
      charge.payment_method = { type: "PIX", pix: { expiration_date: `${venc}T23:59:00-03:00` } };
    }
    r = await pagbank("POST", "/orders", {
      reference_id: id,
      customer: fone ? { ...customer, phones: [{ ...fone, type: "MOBILE" }] } : customer,
      items: [item],
      charges: [charge],
      notification_urls: [WEBHOOK],
    });
  }
  if (!r.ok) return resposta(400, { erro: `PagBank: ${erroPagBank(r.json)}`, detalhe: r.json ?? r.texto });

  const j = r.json;
  const ch = j.charges?.[0];
  const link = (rel: string, media?: string) =>
    (j.links ?? ch?.links ?? []).concat(ch?.links ?? []).find((l: any) => l.rel === rel && (!media || l.media === media))?.href ?? null;
  const dados = {
    status: tipo === "link" ? "WAITING" : ch?.status ?? "WAITING",
    order_id: tipo === "link" ? null : j.id,
    charge_id: ch?.id ?? null,
    checkout_id: tipo === "link" ? j.id : null,
    boleto_url: tipo === "boleto" ? (ch?.links ?? []).find((l: any) => l.media === "application/pdf")?.href ?? null : null,
    boleto_linha_digitavel: ch?.payment_method?.boleto?.formatted_barcode ?? null,
    pix_copia_cola: ch?.qr_code?.text ?? j.qr_codes?.[0]?.text ?? null,
    pix_qr_url: link("QRCODE.PNG"),
    link_url: tipo === "link" ? link("PAY") : null,
    vencimento: venc,
    expira_em: tipo === "pix" || tipo === "link" ? `${venc}T23:59:00-03:00` : null,
    resposta: j,
  };
  if (dados.status === "DECLINED") return resposta(400, { erro: "O PagBank recusou a cobrança (análise de risco)." });

  const { error: e2 } = await servico.rpc("q_cobranca_registrar", {
    p_id: id, p_parcela: parcelaId, p_tipo: tipo, p_ambiente: AMBIENTE, p_criada_por: autor, p_dados: dados,
  });
  if (e2) return resposta(500, { erro: `Emitido no PagBank, mas não gravado: ${e2.message}`, pagbank: j.id });
  return resposta(200, { id, ambiente: AMBIENTE, ...dados, resposta: undefined });
}

// ── Consultar (rede de segurança se o aviso não chegou) ─────────────────────

async function consultar(usuario: any, servico: any, cobrancaId: string) {
  // Lida com o login da pessoa: a RLS só devolve cobrança da carteira dela.
  const { data: cob } = await usuario.from("parcela_cobrancas").select("*").eq("id", cobrancaId).maybeSingle();
  if (!cob) return resposta(404, { erro: "Cobrança não encontrada." });

  const pedidos: any[] = [];
  if (cob.tipo === "link") {
    const r = await pagbank("GET", `/checkouts/${cob.pagbank_checkout_id}`);
    if (!r.ok) return resposta(400, { erro: `PagBank: ${erroPagBank(r.json)}` });
    if (["EXPIRED", "INACTIVE"].includes(r.json.status) && !(r.json.orders ?? []).length) {
      await servico.rpc("q_pagbank_evento", { p_cobranca: cob.id, p_status: "EXPIRED", p_pago_em: null, p_metodo: null, p_charge_id: null, p_order_id: null });
      return resposta(200, { status: "EXPIRED" });
    }
    for (const o of r.json.orders ?? []) {
      const ro = await pagbank("GET", `/orders/${o.id ?? o}`);
      if (ro.ok) pedidos.push(ro.json);
    }
  } else {
    const r = await pagbank("GET", `/orders/${cob.pagbank_order_id}`);
    if (!r.ok) return resposta(400, { erro: `PagBank: ${erroPagBank(r.json)}` });
    pedidos.push(r.json);
  }

  let status = cob.status;
  for (const o of pedidos) {
    for (const ch of o.charges ?? []) {
      status = ch.status;
      await servico.rpc("q_pagbank_evento", {
        p_cobranca: cob.id, p_status: ch.status, p_pago_em: ch.paid_at ?? null,
        p_metodo: ch.payment_method?.type ?? null, p_charge_id: ch.id, p_order_id: o.id,
      });
      if (ch.status === "PAID") break;
    }
  }
  return resposta(200, { status });
}
