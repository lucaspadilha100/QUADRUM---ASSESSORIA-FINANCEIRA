// Edge Function `pagbank-webhook` — o PagBank AVISA aqui quando uma cobrança
// muda (paga, cancelada, expirada). Publicada SEM verificação de JWT (quem
// chama é o PagBank), e por isso a porta é a ASSINATURA:
//   x-authenticity-token = sha256("{PAGBANK_TOKEN}-{corpo cru}")
// Corpo que não bate é guardado (prova) e recusado.
//
// Segredos: PAGBANK_TOKEN (o mesmo da função `pagbank`).

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("PAGBANK_TOKEN") ?? "";
const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256hex(texto: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Acha a NOSSA cobrança: pelo reference_id (é o id dela) ou pelos ids do PagBank. */
async function acharCobranca(candidatos: unknown[], chargeId?: string, checkoutId?: string) {
  for (const c of candidatos) {
    if (typeof c === "string" && UUID.test(c)) {
      const { data } = await servico.from("parcela_cobrancas").select("id").eq("id", c).maybeSingle();
      if (data) return data.id as string;
    }
  }
  if (chargeId) {
    const { data } = await servico.from("parcela_cobrancas").select("id").eq("pagbank_charge_id", chargeId).maybeSingle();
    if (data) return data.id as string;
  }
  if (checkoutId) {
    const { data } = await servico.from("parcela_cobrancas").select("id").eq("pagbank_checkout_id", checkoutId).maybeSingle();
    if (data) return data.id as string;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!TOKEN) return new Response("PAGBANK_TOKEN não configurado", { status: 500 });

  const corpo = await req.text(); // CRU: a assinatura é sobre o texto exato
  const recebida = (req.headers.get("x-authenticity-token") ?? "").toLowerCase();
  const ok = !!recebida && iguais(recebida, await sha256hex(`${TOKEN}-${corpo}`));
  const origem = req.headers.get("x-product-origin");
  const { data: evento } = await servico.rpc("q_pagbank_evento_log", { p_assinatura_ok: ok, p_origem: origem, p_corpo: corpo });
  if (!ok) return new Response("assinatura inválida", { status: 401 });

  const registrar = (cob: string | null, resultado: string) =>
    servico.rpc("q_pagbank_evento_resultado", { p_evento: evento, p_cobranca: cob, p_resultado: resultado });

  let j: any;
  try { j = JSON.parse(corpo); } catch {
    // Evento pós-transação (saldo disponível, devolução, chargeback) vem como
    // formulário (notificationCode=…). Fica guardado; não muda parcela.
    await registrar(null, "pos_transacao");
    return new Response("ok");
  }

  // Aviso do link (checkout) mudando de estado: expirou/inativou.
  if (typeof j.id === "string" && j.id.startsWith("CHEC_")) {
    const cob = await acharCobranca([j.reference_id, ...(j.items ?? []).map((i: any) => i.reference_id)], undefined, j.id);
    if (cob && ["EXPIRED", "INACTIVE"].includes(j.status)) {
      const { data } = await servico.rpc("q_pagbank_evento", { p_cobranca: cob, p_status: "EXPIRED", p_pago_em: null, p_metodo: null, p_charge_id: null, p_order_id: null });
      await registrar(cob, String(data));
    } else await registrar(cob, `checkout:${j.status}`);
    return new Response("ok");
  }

  // Pedido (boleto, PIX ou o pagamento feito pelo link): uma ou mais cobranças.
  const resultados: string[] = [];
  let ultima: string | null = null;
  for (const ch of j.charges ?? []) {
    const cob = await acharCobranca(
      [ch.reference_id, j.reference_id, ...(j.items ?? []).map((i: any) => i.reference_id)],
      ch.id,
    );
    if (!cob) { resultados.push(`sem_cobranca:${ch.id}`); continue; }
    ultima = cob;
    const { data, error } = await servico.rpc("q_pagbank_evento", {
      p_cobranca: cob, p_status: ch.status, p_pago_em: ch.paid_at ?? null,
      p_metodo: ch.payment_method?.type ?? null, p_charge_id: ch.id, p_order_id: j.id ?? null,
    });
    resultados.push(error ? `erro:${error.message}` : String(data));
  }
  await registrar(ultima, resultados.join(",") || "sem_cobranca");
  return new Response("ok");
});
