// Edge Function `carne-pdf` — o CARNÊ: os boletos em aberto de um contrato num
// PDF só (um boleto por folha, na ordem das parcelas). Os PDFs são os do
// PagBank (o navegador não os lê direto: o PagBank não libera CORS), juntados
// aqui. Serve à EQUIPE (admin) e ao CLIENTE (portal), cada um pelo seu login:
//   · equipe  → lê `parcela_cobrancas` (a RLS deixa só a carteira dela);
//   · cliente → lê `portal_pagamentos()` (só os contratos DELE, pela sessão).
// Publicada COM verificação de JWT. Não usa segredo nenhum.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-disposition",
};
const erro = (status: number, msg: string) =>
  new Response(JSON.stringify({ erro: msg }), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Só baixa PDF do PagBank: a função não vira um "baixa qualquer endereço".
const HOST_OK = /(^|\.)(pagseguro\.com\.br|pagbank\.com\.br)$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro(405, "Use POST.");
  const usuario = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: sessao } = await usuario.auth.getUser();
  if (!sessao?.user) return erro(401, "Entre no sistema.");

  let contratoId = "";
  try { contratoId = String((await req.json()).contrato_id ?? ""); } catch { /* corpo inválido */ }
  if (!/^[0-9a-f-]{36}$/i.test(contratoId)) return erro(400, "Contrato inválido.");

  // 1) Equipe: as cobranças de boleto abertas, das parcelas em aberto.
  let urls: { numero: number; url: string }[] = [];
  let numeroContrato: number | null = null;
  const { data: parcelas } = await usuario.from("contrato_parcelas")
    .select("id, numero, pago_em, cancelada_em").eq("contrato_id", contratoId);
  if (parcelas?.length) {
    const abertas = new Map(parcelas.filter((p) => !p.pago_em && !p.cancelada_em).map((p) => [p.id, p.numero as number]));
    const { data: cobs } = await usuario.from("parcela_cobrancas")
      .select("parcela_id, boleto_url, created_at").eq("contrato_id", contratoId).eq("tipo", "boleto")
      .is("encerrada_em", null).order("created_at", { ascending: false });
    const vistos = new Set<string>();
    for (const c of cobs ?? []) {
      if (!c.boleto_url || !abertas.has(c.parcela_id) || vistos.has(c.parcela_id)) continue;
      vistos.add(c.parcela_id);
      urls.push({ numero: abertas.get(c.parcela_id)!, url: c.boleto_url });
    }
    const { data: k } = await usuario.from("contratos").select("numero").eq("id", contratoId).maybeSingle();
    numeroContrato = k?.numero ?? null;
  } else {
    // 2) Cliente do portal: só os contratos dele (a função descobre pela sessão).
    const { data: lista } = await usuario.rpc("portal_pagamentos");
    const k = (lista ?? []).find((x: any) => x.contrato_id === contratoId);
    if (k) {
      numeroContrato = k.numero;
      urls = (k.parcelas ?? []).filter((p: any) => !p.pago_em && p.boleto_url).map((p: any) => ({ numero: p.numero, url: p.boleto_url }));
    }
  }
  urls = urls.filter((u) => { try { return HOST_OK.test(new URL(u.url).hostname); } catch { return false; } })
    .sort((a, b) => a.numero - b.numero);
  if (urls.length === 0) return erro(404, "Nenhum boleto em aberto neste contrato.");

  // Baixa os boletos (em paralelo) e junta, na ordem.
  const pdfs = await Promise.all(urls.map(async (u) => {
    const r = await fetch(u.url);
    if (!r.ok) throw new Error(`Boleto da parcela ${u.numero} indisponível (${r.status}).`);
    return new Uint8Array(await r.arrayBuffer());
  })).catch((e) => e as Error);
  if (pdfs instanceof Error) return erro(502, pdfs.message);

  const carne = await PDFDocument.create();
  carne.setTitle(`Carnê${numeroContrato != null ? ` — contrato ${numeroContrato}` : ""}`);
  for (const bytes of pdfs) {
    const doc = await PDFDocument.load(bytes);
    const paginas = await carne.copyPages(doc, doc.getPageIndices());
    paginas.forEach((p) => carne.addPage(p));
  }
  const saida = await carne.save();
  const nome = `carne-contrato-${numeroContrato ?? "x"}.pdf`;
  return new Response(saida, {
    headers: { ...CORS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nome}"` },
  });
});
