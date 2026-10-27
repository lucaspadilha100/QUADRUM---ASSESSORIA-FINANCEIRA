import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CampoData } from "@/components/CampoData";
import { Campo } from "@/components/Bloco";
import { lerMoeda, mostrarMoeda, type DadosContratoDocumento } from "@/hooks/useContratoDocumento";
import { dataBR, documentoValido, formatarDocumento, mascararDocumento, soDigitos } from "@/lib/formato";
import { dataNoMes, mesPadrao, rotuloParcela, somaMeses, type ItemParcela, type Parcela } from "@/hooks/useParcelas";

// O que o contrato definitivo pede além do card (cláusulas 1.3 a 1.6): o
// titular do financiamento, o veículo, o financiamento e o plano escolhido.
// O que falta aqui é o que a geração do contrato recusa. Os campos saem em
// pedaços para a aba Contrato montar as seções dela, com UM Salvar.

const NADA = "nada";
const SEXOS = ["Masculino", "Feminino"];
export const FORMAS_PAGAMENTO = ["Boleto bancário", "PIX", "Cartão de crédito", "Transferência bancária"];
const DIAS = [5, 10, 15, 20, 25, 30];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function useDadosContrato(d: DadosContratoDocumento, { comVeiculo, nomeCliente, parcelas = [] }: { comVeiculo: boolean; nomeCliente?: string; parcelas?: Parcela[] }) {
  const txt = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  const [titularOutro, setTitularOutro] = useState(d.titular_outro);
  const [tNome, setTNome] = useState(txt(d.titular_nome));
  const [tCpf, setTCpf] = useState(formatarDocumento(d.titular_documento));
  const [tRg, setTRg] = useState(txt(d.titular_rg));
  const [tNasc, setTNasc] = useState(txt(d.titular_nascimento));
  const [tSexo, setTSexo] = useState(d.titular_sexo ?? NADA);
  const [tEnd, setTEnd] = useState(txt(d.titular_endereco));
  const [renavam, setRenavam] = useState(txt(d.renavam));
  const [chassi, setChassi] = useState(txt(d.chassi));
  const [noEnd, setNoEnd] = useState(d.veiculo_no_endereco == null ? NADA : d.veiculo_no_endereco ? "sim" : "nao");
  const [saldo, setSaldo] = useState(mostrarMoeda(d.saldo_devedor));
  const [parcela, setParcela] = useState(mostrarMoeda(d.valor_parcela));
  const [balao, setBalao] = useState(mostrarMoeda(d.parcela_balao));
  const [qtd, setQtd] = useState(txt(d.qtd_parcelas));
  const [pagas, setPagas] = useState(txt(d.parcelas_pagas));
  const [atrasadas, setAtrasadas] = useState(txt(d.parcelas_atrasadas));
  const [ultima, setUltima] = useState(txt(d.ultima_parcela_paga));
  const [pTotal, setPTotal] = useState(mostrarMoeda(d.plano_valor_total));
  const [pEntrada, setPEntrada] = useState(mostrarMoeda(d.plano_entrada));
  const [pParcelas, setPParcelas] = useState(txt(d.plano_parcelas));
  const [pValor, setPValor] = useState(mostrarMoeda(d.plano_valor_parcela));
  const [pVenc, setPVenc] = useState(txt(d.plano_primeiro_vencimento));
  const [pForma, setPForma] = useState(d.plano_forma ?? NADA);

  // As parcelas: a 1ª no "1º vencimento", as demais num dia fixo do mês a
  // partir do mês escolhido. Cada data pode ser trocada à mão; mudar a regra
  // (1º vencimento, dia, mês) refaz as datas. Paga não muda.
  const segunda = parcelas.filter((p) => !p.pago_em).sort((a, b) => a.numero - b.numero)[1] ?? parcelas[1];
  const [dia, setDia] = useState(String(d.plano_dia_vencimento ?? (segunda ? Number(segunda.vencimento.slice(8, 10)) : 10)));
  const [inicio, setInicio] = useState(segunda ? segunda.vencimento.slice(0, 7) : "");
  const [datas, setDatas] = useState<Record<number, string>>(() => Object.fromEntries(parcelas.filter((p) => !p.pago_em).map((p) => [p.numero, p.vencimento])));
  const quitadas = useMemo(() => new Map(parcelas.filter((p) => p.pago_em).map((p) => [p.numero, p])), [parcelas]);
  const regra = (f: (v: string) => void) => (v: string) => { f(v); setDatas({}); };

  const inteiro = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));

  const cronograma = useMemo(() => {
    const n = inteiro(pParcelas);
    const vEntrada = lerMoeda(pEntrada);
    const vParcela = lerMoeda(pValor);
    if (!pVenc || n == null || vParcela == null || Number.isNaN(vParcela) || Number.isNaN(vEntrada ?? 0)) return null;
    const itens: { numero: number; valor: number }[] = [
      ...(vEntrada && vEntrada > 0 ? [{ numero: 0, valor: vEntrada }] : []),
      ...Array.from({ length: n }, (_, i) => ({ numero: i + 1, valor: vParcela })),
    ];
    const diaN = Number(dia);
    const mes0 = inicio && inicio > pVenc.slice(0, 7) ? inicio : mesPadrao(pVenc, diaN);
    const linhas = itens.map((it, i) => {
      const paga = quitadas.get(it.numero);
      if (paga) return { numero: it.numero, valor: Number(paga.valor), vencimento: paga.vencimento, paga };
      const padrao = i === 0 ? pVenc : dataNoMes(somaMeses(mes0, i - 1), diaN);
      return { numero: it.numero, valor: it.valor, vencimento: datas[it.numero] ?? padrao, paga: null as Parcela | null };
    });
    // Parcela paga que saiu da conta continua no plano (o banco não deixa tirar).
    for (const p of quitadas.values()) if (!linhas.some((l) => l.numero === p.numero)) linhas.push({ numero: p.numero, valor: Number(p.valor), vencimento: p.vencimento, paga: p });
    return { linhas: linhas.sort((a, b) => a.numero - b.numero), mes0, total: n };
  }, [pParcelas, pEntrada, pValor, pVenc, dia, inicio, datas, quitadas]); // eslint-disable-line react-hooks/exhaustive-deps

  /** O que mandar ao banco, ou nulo quando não há o que mudar. */
  const parcelasParaGravar = (): ItemParcela[] | null => {
    const novas: ItemParcela[] = (cronograma?.linhas ?? []).map((l) => ({ numero: l.numero, valor: l.valor, vencimento: l.vencimento }));
    const atuais = parcelas.map((p) => ({ numero: p.numero, valor: Number(p.valor), vencimento: p.vencimento })).sort((a, b) => a.numero - b.numero);
    if (!cronograma && parcelas.length === 0) return null;
    return JSON.stringify(novas) === JSON.stringify(atuais) ? null : novas;
  };
  const restantes = inteiro(qtd) != null && inteiro(pagas) != null ? (inteiro(qtd)! - inteiro(pagas)!) : null;
  const conta = (vs: string[]) => vs.filter((v) => !v.trim() || v === NADA).length;
  const faltam = {
    titular: titularOutro ? conta([tNome, tCpf, tRg, tNasc, tSexo, tEnd]) : 0,
    veiculo: comVeiculo ? conta([renavam, chassi, noEnd]) : 0,
    financiamento: conta([saldo, parcela, balao, qtd, pagas, atrasadas, ultima]),
    plano: conta([pTotal, pParcelas, pValor, pVenc, pForma]),
  };

  /** Os campos para gravar, ou o motivo de não dar. */
  const campos = (): Record<string, unknown> | string => {
    const moedas = [saldo, parcela, balao, pTotal, pEntrada, pValor];
    if (moedas.some((v) => Number.isNaN(lerMoeda(v)))) return "Valor em reais inválido. Use 1.295,00.";
    if (titularOutro && tCpf.trim() && !(documentoValido(tCpf) && soDigitos(tCpf).length === 11)) return "CPF do titular tem 11 dígitos.";
    if (restantes != null && restantes < 0) return "Parcelas pagas passam do total.";
    const vazio = (s: string) => s.trim() || null;
    return {
      titular_outro: titularOutro,
      titular_nome: vazio(tNome), titular_documento: soDigitos(tCpf) || null, titular_rg: vazio(tRg),
      titular_nascimento: tNasc || null, titular_sexo: tSexo === NADA ? null : tSexo, titular_endereco: vazio(tEnd),
      renavam: soDigitos(renavam) || null, chassi: vazio(chassi)?.toUpperCase() ?? null,
      veiculo_no_endereco: noEnd === NADA ? null : noEnd === "sim",
      saldo_devedor: lerMoeda(saldo), valor_parcela: lerMoeda(parcela), parcela_balao: lerMoeda(balao),
      qtd_parcelas: inteiro(qtd), parcelas_pagas: inteiro(pagas), parcelas_atrasadas: inteiro(atrasadas),
      ultima_parcela_paga: ultima || null,
      plano_valor_total: lerMoeda(pTotal), plano_entrada: lerMoeda(pEntrada), plano_parcelas: inteiro(pParcelas),
      plano_valor_parcela: lerMoeda(pValor), plano_primeiro_vencimento: pVenc || null, plano_forma: pForma === NADA ? null : pForma,
      // Só com a migração 20261030000000 (a linha lida traz a coluna).
      ...("plano_dia_vencimento" in d ? { plano_dia_vencimento: Number(dia) } : {}),
    };
  };

  const ano = new Date().getFullYear();
  const num = { inputMode: "numeric" as const };
  const reais = { inputMode: "decimal" as const, placeholder: "0,00" };

  const titular = (
    <>
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3">
        <Label htmlFor="tit-outro" className="text-sm">{titularOutro ? "Outra pessoa" : nomeCliente ?? "O próprio cliente"}</Label>
        <Switch id="tit-outro" checked={titularOutro} onCheckedChange={setTitularOutro} aria-label="Titular é outra pessoa" />
      </div>
      {titularOutro && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" className="sm:col-span-2"><Input value={tNome} onChange={(e) => setTNome(e.target.value)} /></Campo>
          <Campo rotulo="CPF"><Input {...num} value={tCpf} onChange={(e) => setTCpf(mascararDocumento(e.target.value))} placeholder="000.000.000-00" /></Campo>
          <Campo rotulo="RG (com órgão)"><Input value={tRg} onChange={(e) => setTRg(e.target.value)} placeholder="0000000 SSP RN" /></Campo>
          <Campo rotulo="Data de nascimento"><CampoData valor={tNasc} onChange={setTNasc} anoMax={ano} /></Campo>
          <Campo rotulo="Sexo"><Escolha valor={tSexo} onChange={setTSexo} opcoes={SEXOS} /></Campo>
          <Campo rotulo="Endereço" className="sm:col-span-2"><Input value={tEnd} onChange={(e) => setTEnd(e.target.value)} /></Campo>
        </div>
      )}
    </>
  );

  const veiculo = (
    <>
      <Campo rotulo="RENAVAM"><Input {...num} value={renavam} onChange={(e) => setRenavam(e.target.value)} /></Campo>
      <Campo rotulo="Chassi"><Input value={chassi} onChange={(e) => setChassi(e.target.value.toUpperCase())} /></Campo>
      <Campo rotulo="No endereço do financiamento"><Escolha valor={noEnd} onChange={setNoEnd} opcoes={[["sim", "Sim"], ["nao", "Não"]]} /></Campo>
    </>
  );

  const financiamento = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Campo rotulo="Saldo devedor (R$)"><Input {...reais} value={saldo} onChange={(e) => setSaldo(e.target.value)} /></Campo>
      <Campo rotulo="Valor da parcela (R$)"><Input {...reais} value={parcela} onChange={(e) => setParcela(e.target.value)} /></Campo>
      <Campo rotulo="Parcela balão (R$)"><Input {...reais} value={balao} onChange={(e) => setBalao(e.target.value)} /></Campo>
      <Campo rotulo="Vencimento da última paga"><CampoData valor={ultima} onChange={setUltima} anoMax={ano} /></Campo>
      <Campo rotulo="Parcelas"><Input {...num} value={qtd} onChange={(e) => setQtd(soDigitos(e.target.value))} /></Campo>
      <Campo rotulo="Pagas"><Input {...num} value={pagas} onChange={(e) => setPagas(soDigitos(e.target.value))} /></Campo>
      <Campo rotulo="Atrasadas"><Input {...num} value={atrasadas} onChange={(e) => setAtrasadas(soDigitos(e.target.value))} /></Campo>
      <Campo rotulo="Restantes">
        <p className={`flex h-10 items-center rounded-md border border-dashed border-border px-3 text-sm font-medium ${restantes != null && restantes < 0 ? "text-destructive" : "text-foreground"}`}>{restantes ?? "—"}</p>
      </Campo>
    </div>
  );

  const plano = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo rotulo="Valor total (R$)"><Input {...reais} value={pTotal} onChange={(e) => setPTotal(e.target.value)} /></Campo>
      <Campo rotulo="Entrada (R$)"><Input {...reais} value={pEntrada} onChange={(e) => setPEntrada(e.target.value)} /></Campo>
      <Campo rotulo="Forma de pagamento"><Escolha valor={pForma} onChange={setPForma} opcoes={FORMAS_PAGAMENTO} /></Campo>
      <Campo rotulo="Parcelas"><Input {...num} value={pParcelas} onChange={(e) => setPParcelas(soDigitos(e.target.value))} /></Campo>
      <Campo rotulo="Valor da parcela (R$)"><Input {...reais} value={pValor} onChange={(e) => setPValor(e.target.value)} /></Campo>
      <Campo rotulo="1º vencimento"><CampoData valor={pVenc} onChange={regra(setPVenc)} anoMax={ano + 5} /></Campo>
      {cronograma && (
        <div className="min-w-0 rounded-lg border border-border sm:col-span-2 lg:col-span-3">
          <div className="grid grid-cols-1 gap-3 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Campo rotulo="Demais vencem todo dia">
              <Select value={dia} onValueChange={regra(setDia)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DIAS.map((x) => <SelectItem key={x} value={String(x)}>Dia {x}</SelectItem>)}</SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="A partir de">
              <Select value={cronograma.mes0} onValueChange={regra(setInicio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 6 }, (_, i) => somaMeses(pVenc.slice(0, 7), i + 1)).map((m) => (
                    <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Soma linhas={cronograma.linhas} total={lerMoeda(pTotal)} />
          </div>
          <ul className="divide-y divide-border">
            {cronograma.linhas.map((l) => (
              <li key={l.numero} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[140px_200px_minmax(0,1fr)]">
                <span className="text-sm font-medium">{rotuloParcela(l.numero, cronograma.total)}</span>
                <span className="text-right text-sm tabular-nums sm:order-last sm:text-left">{moeda(l.valor)}</span>
                <div className="col-span-2 sm:col-span-1">
                  {l.paga ? (
                    <p className="flex h-10 items-center gap-1.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> {dataBR(l.vencimento)} · paga</p>
                  ) : (
                    <label className="block">
                      <span className="sr-only">Vencimento — {rotuloParcela(l.numero, cronograma.total)}</span>
                      <CampoData valor={l.vencimento} onChange={(v) => setDatas((x) => ({ ...x, [l.numero]: v }))} anoMax={ano + 6} />
                    </label>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return { faltam, campos, titular, veiculo, financiamento, plano, parcelasParaGravar };
}

function Soma({ linhas, total }: { linhas: { valor: number }[]; total: number | null }) {
  const soma = linhas.reduce((t, l) => t + l.valor, 0);
  const difere = total != null && !Number.isNaN(total) && Math.abs(soma - total) > 0.005;
  return (
    <p className={`text-sm sm:pb-2.5 ${difere ? "text-warning" : "text-muted-foreground"}`}>
      Soma {moeda(soma)}{difere ? ` ≠ total ${moeda(total!)}` : ""}
    </p>
  );
}

function Escolha({ valor, onChange, opcoes }: { valor: string; onChange: (v: string) => void; opcoes: (string | [string, string])[] }) {
  const lista = opcoes.map((o) => (Array.isArray(o) ? o : [o, o] as [string, string]));
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NADA}>Não informado</SelectItem>
        {lista.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
