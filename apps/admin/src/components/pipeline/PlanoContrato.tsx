import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CampoData } from "@/components/CampoData";
import { Campo } from "@/components/Bloco";
import { usePlanosPagamento } from "@/hooks/useCadastros";
import { lerMoeda, mostrarMoeda, type DadosContratoDocumento } from "@/hooks/useContratoDocumento";
import { dataNoMes, hojeISO, mesPadrao, somaMeses, type ItemParcela, type Parcela } from "@/hooks/useParcelas";
import { dataBR, soDigitos } from "@/lib/formato";
import {
  BOLETO, CARTAO, DIAS_VENCIMENTO, FORMAS, MAX_CARTAO, formaCurta, gerarCronograma, opcoesDoPlano, reais, regraDoPlano,
  type OpcaoContrato, type OpcaoPlano, type RegraPlano,
} from "@/lib/planos";

// O plano do contrato (migração 20261103000000): escolhe-se o PLANO da tabela
// de honorários e a OPÇÃO (à vista, N boletos, N vezes no cartão), ou
// "personalizado"; as cobranças saem prontas e cada uma se ajusta à mão
// (valor, vencimento, forma; acrescentar ou tirar). Paga não muda.
// ⚠️ Cartão parcelado é UMA cobrança ("em até Nx"), nunca N links.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
const PERSONALIZADO = "personalizado";

interface Linha { numero: number; valor: string; vencimento: string; forma: string; cartao_parcelas: number | null; cartao_sem_juros: number | null }
interface Regra {
  opcao: OpcaoContrato | ""; planoId: string; formaAvista: string; primeiro: string; dia: string; inicio: string;
  total: string; entrada: string; entradaForma: string; forma: string; vezes: string; semJuros: string;
}

const paraLinha = (p: Parcela): Linha => ({
  numero: p.numero, valor: mostrarMoeda(Number(p.valor)), vencimento: p.vencimento, forma: p.forma ?? "",
  cartao_parcelas: p.cartao_parcelas ?? null, cartao_sem_juros: p.cartao_sem_juros ?? null,
});

export function usePlanoContrato(d: DadosContratoDocumento, parcelas: Parcela[]) {
  const { data: planos = [] } = usePlanosPagamento();
  const ativos = planos.filter((p) => p.ativo);
  const quitadas = useMemo(() => parcelas.filter((p) => p.pago_em), [parcelas]);
  const pagos = useMemo(() => new Set(quitadas.map((p) => p.numero)), [quitadas]);
  const abertas = parcelas.filter((p) => !p.pago_em).sort((a, b) => a.numero - b.numero);
  const segunda = abertas[1] ?? parcelas[1];
  const cartaoAtual = parcelas.find((p) => p.forma === CARTAO && (p.cartao_parcelas ?? 1) > 1);

  const [r, setR] = useState<Regra>(() => ({
    opcao: d.plano_opcao ?? (d.plano_valor_total != null || parcelas.length ? PERSONALIZADO : ""),
    planoId: d.plano_id ?? "",
    formaAvista: abertas[0]?.forma || "PIX",
    primeiro: d.plano_primeiro_vencimento ?? "",
    dia: String(d.plano_dia_vencimento ?? (segunda ? Number(segunda.vencimento.slice(8, 10)) : 10)),
    inicio: segunda ? segunda.vencimento.slice(0, 7) : "",
    total: mostrarMoeda(d.plano_valor_total),
    entrada: mostrarMoeda(d.plano_entrada),
    entradaForma: parcelas.find((p) => p.numero === 0)?.forma || "PIX",
    forma: d.plano_forma ?? BOLETO,
    vezes: String(cartaoAtual?.cartao_parcelas ?? d.plano_parcelas ?? 1),
    semJuros: String(cartaoAtual?.cartao_sem_juros ?? cartaoAtual?.cartao_parcelas ?? d.plano_parcelas ?? 1),
  }));
  const [linhas, setLinhas] = useState<Linha[]>(() => abertas.map(paraLinha));

  const plano = planos.find((p) => p.id === r.planoId) ?? null;

  /** A regra das cobranças para o estado `x`, ou nulo se falta algo. */
  const regraDe = (x: Regra): RegraPlano | null => {
    if (!x.primeiro) return null;
    const base = { primeiro: x.primeiro, dia: Number(x.dia) || 10, mesInicio: x.inicio || undefined };
    if (x.opcao === PERSONALIZADO) {
      const total = lerMoeda(x.total), entrada = lerMoeda(x.entrada) ?? 0;
      if (total == null || Number.isNaN(total) || Number.isNaN(entrada) || total <= 0) return null;
      const vezes = Math.max(1, Number.parseInt(x.vezes, 10) || 1);
      return { ...base, total, entrada, entradaForma: x.entradaForma, forma: x.forma, vezes, semJuros: x.forma === CARTAO ? Number(x.semJuros) || vezes : null };
    }
    const p = planos.find((y) => y.id === x.planoId);
    const regra = p && x.opcao ? regraDoPlano(p, x.opcao, x.formaAvista) : null;
    return regra ? { ...base, ...regra } : null;
  };

  /** Muda a regra e REFAZ as cobranças em aberto (as pagas ficam). */
  const mudar = (patch: Partial<Regra>) => {
    const x = { ...r, ...patch };
    if (patch.planoId !== undefined || patch.opcao !== undefined) {
      if (!x.primeiro) x.primeiro = hojeISO();
      const p = planos.find((y) => y.id === x.planoId);
      if (patch.planoId !== undefined && p) {
        x.dia = String(p.dia_vencimento);
        // Âncora de vendas da tabela: o boleto vem primeiro; depois cartão, depois à vista.
        const ops = opcoesDoPlano(p).map((o) => o.opcao);
        if (!x.opcao || x.opcao === PERSONALIZADO || !ops.includes(x.opcao as OpcaoPlano)) x.opcao = (["boleto", "cartao", "avista"] as const).find((o) => ops.includes(o)) ?? "";
      }
    }
    setR(x);
    const regra = regraDe(x);
    if (!regra) return;
    setLinhas(gerarCronograma(regra).filter((l) => !pagos.has(l.numero)).map((l) => ({
      numero: l.numero, valor: mostrarMoeda(l.valor), vencimento: l.vencimento, forma: l.forma ?? "",
      cartao_parcelas: l.cartao_parcelas, cartao_sem_juros: l.cartao_sem_juros,
    })));
  };

  const editar = (numero: number, patch: Partial<Linha>) =>
    setLinhas((xs) => xs.map((l) => (l.numero === numero ? { ...l, ...patch } : l)));

  // Todas as cobranças (pagas + em aberto), na ordem.
  const todas = useMemo(() => {
    const t = [
      ...quitadas.map((p) => ({ ...paraLinha(p), paga: p as Parcela | null })),
      ...linhas.map((l) => ({ ...l, paga: null as Parcela | null })),
    ];
    return t.sort((a, b) => a.numero - b.numero);
  }, [quitadas, linhas]);
  const valorDe = (s: string) => lerMoeda(s);
  const soma = todas.reduce((t, l) => t + (valorDe(l.valor) || 0), 0);
  const demais = todas.filter((l) => l.numero > 0);
  const entradaLinha = todas.find((l) => l.numero === 0);
  const cartaoUnico = demais.length === 1 && demais[0].forma === CARTAO && (demais[0].cartao_parcelas ?? 1) > 1 ? demais[0] : null;

  const acrescentar = () => {
    const ultima = todas[todas.length - 1];
    const numero = Math.max(0, ...todas.map((l) => l.numero)) + 1;
    const falta = (lerMoeda(r.total) ?? 0) - soma;
    const venc = ultima ? dataNoMes(somaMeses(ultima.vencimento.slice(0, 7), 1), Number(r.dia) || 10) : (r.primeiro || hojeISO());
    const forma = ultima?.forma && ultima.forma !== CARTAO ? ultima.forma : BOLETO;
    setLinhas((xs) => [...xs, { numero, valor: falta > 0.004 ? mostrarMoeda(Math.round(falta * 100) / 100) : "", vencimento: venc, forma, cartao_parcelas: null, cartao_sem_juros: null }]);
    if (!r.opcao) setR((x) => ({ ...x, opcao: PERSONALIZADO }));
  };

  /** Personalizado parte do que está na tela (o plano escolhido vira editável). */
  const paraPersonalizado = () => {
    const ref = cartaoUnico ?? demais.find((l) => !l.paga) ?? demais[0];
    setR((x) => ({
      ...x, opcao: PERSONALIZADO, primeiro: x.primeiro || hojeISO(),
      total: soma > 0 ? mostrarMoeda(Math.round(soma * 100) / 100) : x.total,
      entrada: entradaLinha ? entradaLinha.valor : "",
      entradaForma: entradaLinha?.forma || x.entradaForma,
      forma: ref?.forma || x.forma,
      vezes: String(cartaoUnico ? cartaoUnico.cartao_parcelas ?? 1 : demais.length || 1),
      semJuros: String(cartaoUnico?.cartao_sem_juros ?? cartaoUnico?.cartao_parcelas ?? x.semJuros),
    }));
  };

  const faltam = (r.opcao ? 0 : 1) + (todas.length ? 0 : 1) + linhas.filter((l) => !l.vencimento || !(valorDe(l.valor)! > 0) || !l.forma).length;

  /** Os campos do contrato (o texto do contrato lê daqui), ou o motivo de não dar. */
  const campos = (): Record<string, unknown> | string => {
    for (const l of linhas) {
      const v = valorDe(l.valor);
      if (v == null || Number.isNaN(v) || v <= 0) return "Valor de cobrança inválido. Use 1.295,00.";
      if (!l.vencimento) return "Toda cobrança precisa de vencimento.";
    }
    const primeiroVenc = todas.map((l) => l.vencimento).filter(Boolean).sort()[0] ?? null;
    return {
      plano_valor_total: todas.length ? Math.round(soma * 100) / 100 : null,
      plano_entrada: entradaLinha ? valorDe(entradaLinha.valor) : todas.length ? 0 : null,
      plano_parcelas: cartaoUnico ? cartaoUnico.cartao_parcelas : demais.length || null,
      plano_valor_parcela: cartaoUnico
        ? Math.round(((valorDe(cartaoUnico.valor) ?? 0) / (cartaoUnico.cartao_parcelas ?? 1)) * 100) / 100
        : demais[0] ? valorDe(demais[0].valor) : null,
      plano_primeiro_vencimento: primeiroVenc,
      plano_forma: (demais[0]?.forma || entradaLinha?.forma) || null,
      ...("plano_dia_vencimento" in d ? { plano_dia_vencimento: Number(r.dia) || null } : {}),
      // Só com a migração 20261103000000 (a linha lida traz as colunas).
      ...("plano_id" in d ? { plano_id: r.opcao && r.opcao !== PERSONALIZADO ? r.planoId || null : null, plano_opcao: r.opcao || null } : {}),
    };
  };

  /** O que mandar ao banco, ou nulo quando não há o que mudar. */
  const parcelasParaGravar = (): ItemParcela[] | null => {
    const item = (l: Linha): ItemParcela => ({
      numero: l.numero, valor: valorDe(l.valor) ?? 0, vencimento: l.vencimento, forma: l.forma || null,
      cartao_parcelas: l.forma === CARTAO ? l.cartao_parcelas ?? 1 : null,
      cartao_sem_juros: l.forma === CARTAO ? l.cartao_sem_juros : null,
    });
    const novas = todas.map(item);
    const atuais = [...parcelas].sort((a, b) => a.numero - b.numero).map((p) => item(paraLinha(p)));
    if (novas.length === 0 && parcelas.length === 0) return null;
    return JSON.stringify(novas) === JSON.stringify(atuais) ? null : novas;
  };

  const ano = new Date().getFullYear();
  const opcoes = plano ? opcoesDoPlano(plano) : [];
  const personalizado = r.opcao === PERSONALIZADO;
  const vezesN = Math.max(1, Number.parseInt(r.vezes, 10) || 1);
  // "Demais vencem todo dia" só quando a regra gera mais de uma cobrança mensal (boleto em N, entrada + parcelas).
  const regraAtual = regraDe(r);
  const usaDia = !!regraAtual && regraAtual.forma !== CARTAO && (regraAtual.vezes > 1 || regraAtual.entrada > 0);
  const mes0 = r.primeiro ? (r.inicio && r.inicio > r.primeiro.slice(0, 7) ? r.inicio : mesPadrao(r.primeiro, Number(r.dia) || 10)) : "";

  const jsx = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Plano">
          <Select value={personalizado ? PERSONALIZADO : r.planoId || undefined} onValueChange={(v) => (v === PERSONALIZADO ? paraPersonalizado() : mudar({ planoId: v }))}>
            <SelectTrigger><SelectValue placeholder="Escolher plano…" /></SelectTrigger>
            <SelectContent>
              {ativos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}{p.padrao ? " · padrão" : ""}</SelectItem>)}
              <SelectItem value={PERSONALIZADO}>Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="1º vencimento">
          <CampoData valor={r.primeiro} onChange={(v) => mudar({ primeiro: v })} anoMax={ano + 5} />
        </Campo>
        {!r.opcao && ativos.some((p) => p.padrao) && (
          <div className="flex items-end">
            <Button type="button" variant="outline" className="w-full" onClick={() => mudar({ planoId: ativos.find((p) => p.padrao)!.id })}>
              <Star className="mr-1.5 h-4 w-4" /> Plano padrão
            </Button>
          </div>
        )}
      </div>

      {plano && !personalizado && opcoes.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Opção do plano">
          {opcoes.map((o) => {
            const sel = r.opcao === o.opcao;
            return (
              <button key={o.opcao} type="button" role="radio" aria-checked={sel} onClick={() => mudar({ opcao: o.opcao as OpcaoPlano })}
                className={`min-h-12 rounded-lg border px-3 py-2 text-left transition-colors ${sel ? "border-q-gold bg-q-gold/10 ring-1 ring-q-gold" : "border-border bg-card hover:bg-muted"}`}>
                <span className="block text-sm font-semibold text-foreground">{o.rotulo}</span>
                <span className="block text-xs text-muted-foreground">total {reais(o.total)}</span>
              </button>
            );
          })}
        </div>
      )}

      {personalizado && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Valor total (R$)"><Input inputMode="decimal" placeholder="0,00" value={r.total} onChange={(e) => mudar({ total: e.target.value })} /></Campo>
          <Campo rotulo="Entrada (R$)"><Input inputMode="decimal" placeholder="0,00" value={r.entrada} onChange={(e) => mudar({ entrada: e.target.value })} /></Campo>
          {(lerMoeda(r.entrada) ?? 0) > 0 ? (
            <Campo rotulo="Forma da entrada"><EscolhaForma valor={r.entradaForma} onChange={(v) => mudar({ entradaForma: v })} /></Campo>
          ) : <div className="hidden lg:block" />}
          <Campo rotulo={(lerMoeda(r.entrada) ?? 0) > 0 ? "Forma do restante" : "Forma"}><EscolhaForma valor={r.forma} onChange={(v) => mudar({ forma: v })} /></Campo>
          <Campo rotulo={r.forma === CARTAO ? "Em até (vezes no cartão)" : "Parcelas"}>
            <Input inputMode="numeric" value={r.vezes} onChange={(e) => mudar({ vezes: soDigitos(e.target.value).slice(0, r.forma === CARTAO ? 2 : 3) })} />
          </Campo>
          {r.forma === CARTAO && (
            <Campo rotulo="Sem juros até">
              <Select value={String(Math.min(Number(r.semJuros) || vezesN, vezesN))} onValueChange={(v) => mudar({ semJuros: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: Math.min(vezesN, MAX_CARTAO) }, (_, i) => i + 1).map((x) => <SelectItem key={x} value={String(x)}>{x}x</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>
      )}

      {r.opcao === "avista" && !personalizado && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Forma"><EscolhaForma valor={r.formaAvista} onChange={(v) => mudar({ formaAvista: v })} /></Campo>
        </div>
      )}

      {todas.length > 0 && (
        <div className="min-w-0 overflow-hidden rounded-lg border border-foreground/15">
          <div className="grid grid-cols-1 gap-3 border-b border-foreground/10 bg-muted/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            {usaDia && r.primeiro ? (
              <>
                <Campo rotulo="Demais vencem todo dia">
                  <Select value={r.dia} onValueChange={(v) => mudar({ dia: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DIAS_VENCIMENTO.map((x) => <SelectItem key={x} value={String(x)}>Dia {x}</SelectItem>)}</SelectContent>
                  </Select>
                </Campo>
                <Campo rotulo="A partir de">
                  <Select value={mes0} onValueChange={(v) => mudar({ inicio: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 6 }, (_, i) => somaMeses(r.primeiro.slice(0, 7), i + 1)).map((m) => (
                        <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              </>
            ) : <div className="hidden sm:col-span-2 sm:block" />}
            <Soma soma={soma} total={personalizado ? lerMoeda(r.total) : null} />
          </div>
          <ul className="divide-y divide-border">
            {todas.map((l) => (
              <li key={l.numero} className="grid grid-cols-2 items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,9rem)_2.25rem]">
                <span className="text-sm font-medium">
                  {l.numero === 0 ? "Entrada" : cartaoUnico ? "Cartão" : `Parcela ${l.numero}/${demais.length}`}
                </span>
                {l.paga ? (
                  <p className="col-span-2 flex min-h-10 items-center gap-1.5 text-sm text-success sm:col-span-3">
                    <CheckCircle2 className="h-4 w-4" /> {reais(Number(l.paga.valor))} · {dataBR(l.vencimento)} · paga
                  </p>
                ) : (
                  <>
                    <div className="col-span-2 flex min-w-0 gap-2 sm:col-span-1">
                      <div className="min-w-0 flex-1">
                        <span className="sr-only">Forma</span>
                        <EscolhaForma valor={l.forma} onChange={(v) => editar(l.numero, {
                          forma: v, cartao_parcelas: v === CARTAO ? l.cartao_parcelas ?? 1 : null, cartao_sem_juros: v === CARTAO ? l.cartao_sem_juros : null,
                        })} />
                      </div>
                      {l.forma === CARTAO && (
                        <div className="w-24 shrink-0">
                          <Select value={String(l.cartao_parcelas ?? 1)} onValueChange={(v) => editar(l.numero, {
                            cartao_parcelas: Number(v), cartao_sem_juros: l.cartao_sem_juros ? Math.min(l.cartao_sem_juros, Number(v)) : null,
                          })}>
                            <SelectTrigger aria-label="Vezes no cartão"><SelectValue /></SelectTrigger>
                            <SelectContent>{Array.from({ length: MAX_CARTAO }, (_, i) => i + 1).map((x) => <SelectItem key={x} value={String(x)}>até {x}x</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <label className="col-span-2 block sm:col-span-1">
                      <span className="sr-only">Vencimento</span>
                      <CampoData valor={l.vencimento} onChange={(v) => editar(l.numero, { vencimento: v })} anoMax={ano + 6} />
                    </label>
                    <label className="block">
                      <span className="sr-only">Valor</span>
                      <Input inputMode="decimal" placeholder="0,00" value={l.valor} onChange={(e) => editar(l.numero, { valor: e.target.value })} className="text-right tabular-nums" />
                    </label>
                    <Button type="button" variant="ghost" size="icon" className="h-10 w-10 justify-self-end text-muted-foreground"
                      onClick={() => setLinhas((xs) => xs.filter((x) => x.numero !== l.numero))} aria-label="Tirar esta cobrança" title="Tirar esta cobrança">
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" onClick={acrescentar}><Plus className="mr-1 h-4 w-4" /> Acrescentar cobrança</Button>
          </div>
        </div>
      )}
      {todas.length === 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={acrescentar}><Plus className="mr-1 h-4 w-4" /> Acrescentar cobrança</Button>
      )}
      {cartaoUnico && (
        <p className="text-sm text-muted-foreground">
          {formaCurta(CARTAO)} em até {cartaoUnico.cartao_parcelas}x de {reais((valorDe(cartaoUnico.valor) ?? 0) / (cartaoUnico.cartao_parcelas ?? 1))}
          {cartaoUnico.cartao_sem_juros && cartaoUnico.cartao_sem_juros < (cartaoUnico.cartao_parcelas ?? 1) ? ` · ${cartaoUnico.cartao_sem_juros}x sem juros` : " · sem juros"}
        </p>
      )}
    </div>
  );

  return { faltam, campos, parcelasParaGravar, jsx };
}

function Soma({ soma, total }: { soma: number; total: number | null }) {
  const difere = total != null && !Number.isNaN(total) && Math.abs(soma - total) > 0.005;
  return (
    <p className={`text-sm font-medium sm:pb-2.5 ${difere ? "text-warning" : "text-foreground"}`}>
      Total {reais(soma)}{difere ? ` ≠ ${reais(total!)}` : ""}
    </p>
  );
}

function EscolhaForma({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <Select value={valor || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Forma" /></SelectTrigger>
      <SelectContent>{FORMAS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
    </Select>
  );
}
