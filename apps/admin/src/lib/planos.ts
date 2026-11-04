import { dataNoMes, mesPadrao, somaMeses } from "@/hooks/useParcelas";

// Planos de pagamento (migração 20261103000000): a tabela de honorários.
// Cada plano (nível) tem até três opções de preço — à vista, N boletos de
// R$ X, N vezes de R$ Y no cartão — e gera as cobranças do contrato.
//
// ⚠️ Cartão parcelado é UMA cobrança: "8x de R$ 137" = um link de R$ 1.096
// que o cliente divide em até 8x sem juros para ele — nunca 8 links.
// Boleto, PIX e transferência: uma cobrança por parcela.

export const FORMAS = ["Boleto bancário", "PIX", "Cartão de crédito", "Transferência bancária"] as const;
export const CARTAO = "Cartão de crédito";
export const BOLETO = "Boleto bancário";
export const DIAS_VENCIMENTO = [5, 10, 15, 20, 25, 30];
export const MAX_CARTAO = 18;

export type OpcaoPlano = "avista" | "boleto" | "cartao";
export type OpcaoContrato = OpcaoPlano | "personalizado";

export interface PlanoPagamento {
  id: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  ordem: number;
  avista_valor: number | null;
  boleto_parcelas: number | null;
  boleto_valor: number | null;
  cartao_parcelas: number | null;
  cartao_valor: number | null;
  cartao_sem_juros: number | null; // nulo = todas sem juros
  dia_vencimento: number;
}

const CURTA: Record<string, [string, string]> = {
  "Boleto bancário": ["boleto", "boletos"],
  PIX: ["PIX", "PIX"],
  "Cartão de crédito": ["cartão", "cartão"],
  "Transferência bancária": ["transferência", "transferências"],
};
export const formaCurta = (forma: string | null | undefined, plural = false) =>
  forma ? (CURTA[forma]?.[plural ? 1 : 0] ?? forma) : "";

export const reais = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** As opções que o plano oferece, na ordem da tabela (à vista, boleto, cartão). */
export function opcoesDoPlano(p: PlanoPagamento) {
  const out: { opcao: OpcaoPlano; rotulo: string; total: number }[] = [];
  if (p.avista_valor) out.push({ opcao: "avista", rotulo: `À vista ${reais(p.avista_valor)}`, total: Number(p.avista_valor) });
  if (p.boleto_parcelas && p.boleto_valor) {
    out.push({ opcao: "boleto", rotulo: `${p.boleto_parcelas}x de ${reais(p.boleto_valor)} no boleto`, total: p.boleto_parcelas * Number(p.boleto_valor) });
  }
  if (p.cartao_parcelas && p.cartao_valor) {
    out.push({ opcao: "cartao", rotulo: `${p.cartao_parcelas}x de ${reais(p.cartao_valor)} no cartão`, total: p.cartao_parcelas * Number(p.cartao_valor) });
  }
  return out;
}

/** Uma cobrança do plano do contrato (o que vai para `q_parcelas_definir`). */
export interface LinhaPlano {
  numero: number; // 0 = entrada
  valor: number;
  vencimento: string; // AAAA-MM-DD
  forma: string | null;
  cartao_parcelas: number | null;
  cartao_sem_juros: number | null;
}

export interface RegraPlano {
  total: number;
  entrada: number; // 0 = sem entrada
  entradaForma: string | null;
  forma: string; // do restante
  vezes: number; // parcelas (boleto/PIX) ou vezes no cartão
  semJuros: number | null;
  primeiro: string; // 1º vencimento (a entrada, ou a 1ª cobrança se não houver entrada)
  dia: number; // as demais vencem neste dia do mês
  mesInicio?: string; // "AAAA-MM" da 2ª cobrança; padrão: o 1º mês a 30+ dias do 1º vencimento
}

const centavos = (v: number) => Math.round(v * 100);

/** Divide o valor em n partes iguais; os centavos que sobram vão na última. */
export function dividir(valor: number, n: number) {
  const c = centavos(valor);
  const base = Math.floor(c / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? c - base * (n - 1) : base) / 100);
}

/** As cobranças que um plano gera. Datas: a 1ª no 1º vencimento; as demais no dia escolhido, mês a mês. */
export function gerarCronograma(r: RegraPlano): LinhaPlano[] {
  const linhas: LinhaPlano[] = [];
  const restante = Math.max(0, (centavos(r.total) - centavos(r.entrada)) / 100);
  const mes0 = r.mesInicio && r.mesInicio > r.primeiro.slice(0, 7) ? r.mesInicio : mesPadrao(r.primeiro, r.dia);
  const data = (i: number) => (i === 0 ? r.primeiro : dataNoMes(somaMeses(mes0, i - 1), r.dia));
  let i = 0;
  if (r.entrada > 0) {
    linhas.push({ numero: 0, valor: r.entrada, vencimento: data(i++), forma: r.entradaForma ?? r.forma, cartao_parcelas: r.entradaForma === CARTAO ? 1 : null, cartao_sem_juros: null });
  }
  if (restante <= 0) return linhas;
  if (r.forma === CARTAO) {
    // UMA cobrança: o cliente divide no cartão. Com entrada, o cartão vence junto dela.
    const vezes = Math.min(Math.max(1, r.vezes), MAX_CARTAO);
    linhas.push({ numero: 1, valor: restante, vencimento: r.primeiro, forma: CARTAO, cartao_parcelas: vezes,
      cartao_sem_juros: r.semJuros ? Math.min(r.semJuros, vezes) : null });
    return linhas;
  }
  dividir(restante, Math.max(1, r.vezes)).forEach((v, k) => {
    linhas.push({ numero: k + 1, valor: v, vencimento: data(i++), forma: r.forma, cartao_parcelas: null, cartao_sem_juros: null });
  });
  return linhas;
}

/** A regra de cobrança de uma opção do plano (a data e o dia vêm do contrato). */
export function regraDoPlano(p: PlanoPagamento, opcao: OpcaoPlano, formaAvista: string): Omit<RegraPlano, "primeiro" | "dia" | "mesInicio"> | null {
  if (opcao === "avista" && p.avista_valor) {
    return { total: Number(p.avista_valor), entrada: 0, entradaForma: null, forma: formaAvista, vezes: 1, semJuros: null };
  }
  if (opcao === "boleto" && p.boleto_parcelas && p.boleto_valor) {
    return { total: p.boleto_parcelas * Number(p.boleto_valor), entrada: 0, entradaForma: null, forma: BOLETO, vezes: p.boleto_parcelas, semJuros: null };
  }
  if (opcao === "cartao" && p.cartao_parcelas && p.cartao_valor) {
    return { total: p.cartao_parcelas * Number(p.cartao_valor), entrada: 0, entradaForma: null, forma: CARTAO,
      vezes: p.cartao_parcelas, semJuros: p.cartao_sem_juros ?? p.cartao_parcelas };
  }
  return null;
}
