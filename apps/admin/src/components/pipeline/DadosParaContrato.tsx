import { useState, type ReactNode } from "react";
import { FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CampoData } from "@/components/CampoData";
import { useAtualizarContrato } from "@/hooks/usePipeline";
import { lerMoeda, mostrarMoeda, useContratoDocumento, type DadosContratoDocumento } from "@/hooks/useContratoDocumento";
import { documentoValido, formatarDocumento, mascararDocumento, soDigitos } from "@/lib/formato";

// O que o contrato definitivo pede além do card (cláusulas 1.3 a 1.6): o
// titular do financiamento, o veículo, o financiamento e o plano escolhido.
// O que falta aqui é o que a geração do contrato recusa.

const NADA = "nada";
const SEXOS = ["Masculino", "Feminino"];
export const FORMAS_PAGAMENTO = ["Boleto bancário", "PIX", "Cartão de crédito", "Transferência bancária"];

export function DadosParaContrato({ contratoId, nomeCliente, comVeiculo }: { contratoId: string; nomeCliente?: string; comVeiculo: boolean }) {
  const { data } = useContratoDocumento(contratoId);
  if (!data) return null;
  // Reinicia pelos VALORES gravados: a releitura ao vivo não apaga o que está sendo digitado.
  return <Formulario key={JSON.stringify(data)} contratoId={contratoId} d={data} nomeCliente={nomeCliente} comVeiculo={comVeiculo} />;
}

function Formulario({ contratoId, d, nomeCliente, comVeiculo }: { contratoId: string; d: DadosContratoDocumento; nomeCliente?: string; comVeiculo: boolean }) {
  const atualizar = useAtualizarContrato();
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

  const inteiro = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));
  const restantes = inteiro(qtd) != null && inteiro(pagas) != null ? (inteiro(qtd)! - inteiro(pagas)!) : null;
  const obrigatorios: string[] = [
    ...(titularOutro ? [tNome, tCpf, tRg, tNasc, tSexo === NADA ? "" : tSexo, tEnd] : []),
    ...(comVeiculo ? [renavam, chassi, noEnd === NADA ? "" : noEnd] : []),
    saldo, parcela, balao, qtd, pagas, atrasadas, ultima,
    pTotal, pParcelas, pValor, pVenc, pForma === NADA ? "" : pForma,
  ];
  const faltam = obrigatorios.filter((v) => !v.trim()).length;

  const salvar = async () => {
    const moedas = { saldo, parcela, balao, pTotal, pEntrada, pValor };
    if (Object.values(moedas).some((v) => Number.isNaN(lerMoeda(v)))) return toast.error("Valor em reais inválido. Use 1.295,00.");
    if (titularOutro && tCpf.trim() && !(documentoValido(tCpf) && soDigitos(tCpf).length === 11)) return toast.error("CPF do titular tem 11 dígitos.");
    if (restantes != null && restantes < 0) return toast.error("Parcelas pagas passam do total.");
    const vazio = (s: string) => s.trim() || null;
    try {
      await atualizar.mutateAsync({ id: contratoId, campos: {
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
      } });
      toast.success("Dados do contrato salvos.");
    } catch (e) {
      toast.error("Não foi possível salvar.", { description: (e as Error).message });
    }
  };

  const ano = new Date().getFullYear();
  const num = { inputMode: "numeric" as const };
  const reais = { inputMode: "decimal" as const, placeholder: "0,00" };

  return (
    <details className="group rounded-lg border border-border" open={faltam > 0 && faltam < obrigatorios.length}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold">
        <FileSignature className="h-4 w-4 text-q-petrol" />
        Dados para o contrato
        <span className={`ml-auto text-xs font-normal ${faltam ? "text-warning" : "text-success"}`}>{faltam ? `faltam ${faltam}` : "completo"}</span>
      </summary>
      <div className="space-y-5 border-t border-border p-3">
        <Secao titulo="Titular do financiamento">
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3">
            <Label htmlFor="tit-outro" className="text-sm">{titularOutro ? "Outra pessoa" : nomeCliente ?? "O próprio cliente"}</Label>
            <Switch id="tit-outro" checked={titularOutro} onCheckedChange={setTitularOutro} aria-label="Titular é outra pessoa" />
          </div>
          {titularOutro && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Nome" className="sm:col-span-2"><Input value={tNome} onChange={(e) => setTNome(e.target.value)} /></Campo>
              <Campo rotulo="CPF"><Input {...num} value={tCpf} onChange={(e) => setTCpf(mascararDocumento(e.target.value))} placeholder="000.000.000-00" /></Campo>
              <Campo rotulo="RG (com órgão)"><Input value={tRg} onChange={(e) => setTRg(e.target.value)} placeholder="0000000 SSP RN" /></Campo>
              <Campo rotulo="Data de nascimento"><CampoData valor={tNasc} onChange={setTNasc} anoMax={ano} /></Campo>
              <Campo rotulo="Sexo"><Escolha valor={tSexo} onChange={setTSexo} opcoes={SEXOS} /></Campo>
              <Campo rotulo="Endereço" className="sm:col-span-2"><Input value={tEnd} onChange={(e) => setTEnd(e.target.value)} /></Campo>
            </div>
          )}
        </Secao>

        {comVeiculo && (
          <Secao titulo="Veículo">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="RENAVAM"><Input {...num} value={renavam} onChange={(e) => setRenavam(e.target.value)} /></Campo>
              <Campo rotulo="Chassi"><Input value={chassi} onChange={(e) => setChassi(e.target.value.toUpperCase())} /></Campo>
              <Campo rotulo="No endereço do financiamento" className="sm:col-span-2">
                <Escolha valor={noEnd} onChange={setNoEnd} opcoes={[["sim", "Sim"], ["nao", "Não"]]} />
              </Campo>
            </div>
          </Secao>
        )}

        <Secao titulo="Financiamento">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Saldo devedor (R$)"><Input {...reais} value={saldo} onChange={(e) => setSaldo(e.target.value)} /></Campo>
            <Campo rotulo="Valor da parcela (R$)"><Input {...reais} value={parcela} onChange={(e) => setParcela(e.target.value)} /></Campo>
            <Campo rotulo="Parcela balão (R$)"><Input {...reais} value={balao} onChange={(e) => setBalao(e.target.value)} /></Campo>
            <Campo rotulo="Parcelas"><Input {...num} value={qtd} onChange={(e) => setQtd(soDigitos(e.target.value))} /></Campo>
            <Campo rotulo="Pagas"><Input {...num} value={pagas} onChange={(e) => setPagas(soDigitos(e.target.value))} /></Campo>
            <Campo rotulo="Atrasadas"><Input {...num} value={atrasadas} onChange={(e) => setAtrasadas(soDigitos(e.target.value))} /></Campo>
            <Campo rotulo="Vencimento da última paga"><CampoData valor={ultima} onChange={setUltima} anoMax={ano} /></Campo>
            <Campo rotulo="Restantes"><p className={`flex h-10 items-center text-sm font-medium ${restantes != null && restantes < 0 ? "text-destructive" : "text-foreground"}`}>{restantes ?? "—"}</p></Campo>
          </div>
        </Secao>

        <Secao titulo="Plano escolhido">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Valor total (R$)"><Input {...reais} value={pTotal} onChange={(e) => setPTotal(e.target.value)} /></Campo>
            <Campo rotulo="Entrada (R$)"><Input {...reais} value={pEntrada} onChange={(e) => setPEntrada(e.target.value)} /></Campo>
            <Campo rotulo="Parcelas"><Input {...num} value={pParcelas} onChange={(e) => setPParcelas(soDigitos(e.target.value))} /></Campo>
            <Campo rotulo="Valor da parcela (R$)"><Input {...reais} value={pValor} onChange={(e) => setPValor(e.target.value)} /></Campo>
            <Campo rotulo="1º vencimento"><CampoData valor={pVenc} onChange={setPVenc} anoMax={ano + 5} /></Campo>
            <Campo rotulo="Forma de pagamento"><Escolha valor={pForma} onChange={setPForma} opcoes={FORMAS_PAGAMENTO} /></Campo>
          </div>
        </Secao>

        <div className="flex justify-end">
          <Button type="button" onClick={salvar} disabled={atualizar.isPending}>
            {atualizar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar dados do contrato
          </Button>
        </div>
      </div>
    </details>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="q-titulo-marca mb-2 text-[11px] text-muted-foreground">{titulo}</legend>
      {children}
    </fieldset>
  );
}

// O <label> envolve o campo: o rótulo fica ligado a ele (leitor de tela, clique).
function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="block text-sm font-medium leading-none">{rotulo}</span>
      {children}
    </label>
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
