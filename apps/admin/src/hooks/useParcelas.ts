import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";
import { comprimirComprovante } from "@/lib/comprimirImagem";

// As parcelas do plano (migração 20261030000000). Só se escreve pelas funções
// do banco: definir o plano, pagar, desfazer pagamento (gestor).

export interface Parcela {
  id: string;
  contrato_id: string;
  numero: number; // 0 = entrada
  valor: number;
  vencimento: string; // AAAA-MM-DD
  pago_em: string | null;
  pago_forma: string | null;
  pago_obs: string | null;
  pago_registrado_em: string | null;
  pago_registrado_por: string | null;
  boleto_url: string | null;
  boleto_linha_digitavel: string | null;
  pix_copia_cola: string | null;
  comprovante_path?: string | null;
  // Migração 20261103000000: a forma da cobrança e, no cartão, em até quantas vezes.
  forma?: string | null;
  cartao_parcelas?: number | null;
  cartao_sem_juros?: number | null;
}

export interface ItemParcela {
  numero: number; valor: number; vencimento: string;
  forma?: string | null; cartao_parcelas?: number | null; cartao_sem_juros?: number | null;
}

/** Dinheiro, PIX… — o que a equipe registra ao marcar como pago. */
export const FORMAS_RECEBIMENTO = ["Dinheiro", "PIX", "Boleto bancário", "Cartão de crédito", "Cartão de débito", "Transferência bancária"];

export const rotuloParcela = (numero: number, total: number) => (numero === 0 ? "Entrada" : `Parcela ${numero}/${total}`);

/** As parcelas em vigor (sem as canceladas), na ordem. */
export function useParcelas(contratoId: string | null) {
  return useQuery({
    queryKey: ["contrato", contratoId, "parcelas"],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("contrato_parcelas").select("*")
        .eq("contrato_id", contratoId!).is("cancelada_em", null).order("numero");
      if (error) throw new Error(mensagemDeErro(error));
      return (data ?? []) as Parcela[];
    },
  });
}

function useRpc<V>(fn: string, args: (v: V) => Record<string, unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const { data, error } = await supabase.rpc(fn, args(v));
      if (error) throw new Error(mensagemDeErro(error));
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contrato"] });
      qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

export const useDefinirParcelas = () =>
  useRpc<{ contratoId: string; itens: ItemParcela[] }>("q_parcelas_definir", (v) => ({ p_contrato: v.contratoId, p_parcelas: v.itens }));

export const usePagarParcela = () =>
  useRpc<{ id: string; pagoEm: string; forma: string; obs: string }>("q_parcela_pagar",
    (v) => ({ p_parcela: v.id, p_pago_em: v.pagoEm, p_forma: v.forma, p_obs: v.obs || null }));

/**
 * O comprovante: reduz a foto no navegador, sobe para o bucket privado na
 * pasta <contrato>/<parcela>/ e liga à parcela (o banco confere a pasta).
 * Nome novo a cada envio: nada é sobrescrito.
 */
export function useAnexarComprovante() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parcela, arquivo }: { parcela: Pick<Parcela, "id" | "contrato_id">; arquivo: File }) => {
      const blob = await comprimirComprovante(arquivo);
      const ext = blob.type === "application/pdf" ? "pdf" : blob.type === "image/webp" ? "webp" : "jpg";
      const caminho = `${parcela.contrato_id}/${parcela.id}/${crypto.randomUUID()}.${ext}`;
      const { error: e1 } = await supabase.storage.from("comprovantes").upload(caminho, blob, { contentType: blob.type, upsert: false });
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.rpc("q_parcela_comprovante", { p_parcela: parcela.id, p_path: caminho });
      if (e2) throw new Error(mensagemDeErro(e2));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contrato"] }),
  });
}

/** Abre o comprovante numa aba nova (link que vale 5 minutos: o bucket é privado). */
export async function abrirComprovante(caminho: string) {
  // A aba abre NO CLIQUE: aberta depois do await, o navegador a bloquearia.
  const aba = window.open("", "_blank");
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(caminho, 300);
  if (error || !data) { aba?.close(); throw new Error(error?.message ?? "Comprovante indisponível."); }
  if (aba) aba.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export const useDesfazerPagamento = () =>
  useRpc<{ id: string; motivo: string }>("q_parcela_desfazer_pagamento", (v) => ({ p_parcela: v.id, p_motivo: v.motivo }));

// ── As datas ────────────────────────────────────────────────────────────────

const doisDigitos = (n: number) => String(n).padStart(2, "0");
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
};

/** "AAAA-MM" + dia → "AAAA-MM-DD", com o dia cortado no fim do mês (30 em fevereiro = 28/29). */
export function dataNoMes(mes: string, dia: number) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${a}-${doisDigitos(m)}-${doisDigitos(Math.min(dia, ultimo))}`;
}

/** "AAAA-MM" somado de n meses. */
export function somaMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${doisDigitos((t % 12) + 1)}`;
}

/**
 * O mês da 2ª cobrança, se ninguém escolher: o primeiro em que o dia padrão
 * cai a 30 dias ou mais da 1ª. Pagou dia 27/10 → próxima dia 10/12 ("se pagar
 * hoje, a segunda vem só em dezembro").
 */
export function mesPadrao(primeiro: string, dia: number) {
  const limite = new Date(`${primeiro}T12:00:00`);
  limite.setDate(limite.getDate() + 30);
  let mes = somaMeses(primeiro.slice(0, 7), 1);
  while (new Date(`${dataNoMes(mes, dia)}T12:00:00`) < limite) mes = somaMeses(mes, 1);
  return mes;
}

// ── PagBank (migração 20261102000000 + Edge Function `pagbank`) ─────────────

export type TipoCobranca = "boleto" | "pix" | "link";

/** Uma cobrança emitida no PagBank para uma parcela. Só a função grava. */
export interface Cobranca {
  id: string;
  parcela_id: string;
  tipo: TipoCobranca;
  ambiente: "sandbox" | "producao";
  status: string;
  valor: number;
  vencimento: string | null;
  expira_em: string | null;
  boleto_url: string | null;
  boleto_linha_digitavel: string | null;
  pix_copia_cola: string | null;
  pix_qr_url: string | null;
  link_url: string | null;
  pago_em: string | null;
  encerrada_em: string | null;
  created_at: string;
}

/** As cobranças EM ABERTO do contrato (a mais nova de cada tipo por parcela). */
export function useCobrancas(contratoId: string | null) {
  return useQuery({
    queryKey: ["contrato", contratoId, "cobrancas"],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("parcela_cobrancas")
        .select("id, parcela_id, tipo, ambiente, status, valor, vencimento, expira_em, boleto_url, boleto_linha_digitavel, pix_copia_cola, pix_qr_url, link_url, pago_em, encerrada_em, created_at")
        .eq("contrato_id", contratoId!).is("encerrada_em", null).order("created_at", { ascending: false });
      // Sem a migração a tabela não existe: a aba continua funcionando, só sem PagBank.
      if (error) return [] as Cobranca[];
      return (data ?? []) as Cobranca[];
    },
  });
}

/** Erro da Edge Function: o corpo traz `{ erro }` em português. */
async function erroDaFuncao(error: unknown) {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try { const j = await ctx.json(); if (j?.erro) return String(j.erro); } catch { /* sem corpo */ }
  }
  const msg = (error as Error).message ?? "";
  if (/Failed to send|fetch/i.test(msg)) return "A integração com o PagBank ainda não está publicada.";
  return msg || "Falha ao falar com o PagBank.";
}

async function chamarPagBank(corpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("pagbank", { body: corpo });
  if (error) throw new Error(await erroDaFuncao(error));
  return data;
}

export function useEmitirCobranca() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { parcelaId: string; tipo: TipoCobranca }) => chamarPagBank({ acao: "emitir", parcela_id: v.parcelaId, tipo: v.tipo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contrato"] }),
  });
}

/** Pergunta ao PagBank o estado da cobrança (se o aviso automático não chegou). */
export function useConsultarCobranca() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chamarPagBank({ acao: "consultar", cobranca_id: id }) as Promise<{ status: string }>,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contrato"] }); qc.invalidateQueries({ queryKey: ["painel"] }); },
  });
}
