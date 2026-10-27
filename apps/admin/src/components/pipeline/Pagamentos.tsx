import { useRef, useState } from "react";
import { CheckCircle2, CircleDollarSign, ExternalLink, Loader2, Paperclip, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pedirTexto } from "@/shell";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe } from "@/hooks/useCadastros";
import {
  FORMAS_RECEBIMENTO, abrirComprovante, hojeISO, rotuloParcela, useAnexarComprovante, useDesfazerPagamento, useParcelas,
  usePagarParcela, type Parcela,
} from "@/hooks/useParcelas";
import type { ContratoPipeline } from "@/hooks/usePipeline";
import { Bloco, Campo } from "@/components/Bloco";
import { CampoData } from "@/components/CampoData";
import { Carregando } from "@/components/Estados";
import { dataBR, dataHoraBR } from "@/lib/formato";

// A aba Pagamentos do card: as parcelas do plano, o que entrou e o que está em
// atraso. A equipe registra o pagamento (dinheiro, PIX…) com o comprovante
// (foto reduzida no navegador, ou PDF), e o cliente vê os dois no portal;
// desfazer é do gestor, com motivo (fica na trilha do banco).

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function AbaPagamentos({ c, onPlano }: { c: ContratoPipeline; onPlano: () => void }) {
  const { data: parcelas = [], isLoading, error } = useParcelas(c.id);
  const [pagando, setPagando] = useState<Parcela | null>(null);
  if (isLoading) return <Carregando />;
  if (error) return <p className="text-sm text-destructive">Não foi possível carregar as parcelas: {(error as Error).message}</p>;
  if (parcelas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma parcela.</p>
        {!c.cancelado_em && <Button type="button" variant="outline" onClick={onPlano}>Definir o plano</Button>}
      </div>
    );
  }

  const hoje = hojeISO();
  const total = parcelas.reduce((t, p) => t + Number(p.valor), 0);
  const pagas = parcelas.filter((p) => p.pago_em);
  const atrasadas = parcelas.filter((p) => !p.pago_em && p.vencimento < hoje);
  const pago = pagas.reduce((t, p) => t + Number(p.valor), 0);
  const nParcelas = parcelas.filter((p) => p.numero > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="Total do plano" valor={reais(total)} extra={`${parcelas.length} cobrança${parcelas.length === 1 ? "" : "s"}`} />
        <Numero rotulo="Pago" valor={reais(pago)} extra={`${pagas.length} de ${parcelas.length}`} cor="text-success" />
        <Numero rotulo="Em aberto" valor={reais(total - pago)} extra={`${parcelas.length - pagas.length} cobrança${parcelas.length - pagas.length === 1 ? "" : "s"}`} />
        <Numero rotulo="Em atraso" valor={reais(atrasadas.reduce((t, p) => t + Number(p.valor), 0))} extra={`${atrasadas.length} cobrança${atrasadas.length === 1 ? "" : "s"}`} cor={atrasadas.length ? "text-destructive" : undefined} />
      </div>

      <Bloco titulo="Parcelas" icone={<CircleDollarSign className="h-4 w-4 text-q-petrol" />}>
        <ul className="-mx-4 -my-4 divide-y divide-border">
          {parcelas.map((p) => (
            <Linha key={p.id} p={p} total={nParcelas} hoje={hoje} onPagar={() => setPagando(p)} cancelado={!!c.cancelado_em} />
          ))}
        </ul>
      </Bloco>

      <RegistrarPagamento parcela={pagando} total={nParcelas} onFechar={() => setPagando(null)} />
    </div>
  );
}

function Numero({ rotulo, valor, extra, cor }: { rotulo: string; valor: string; extra: string; cor?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 truncate text-lg font-semibold tabular-nums ${cor ?? "text-foreground"}`}>{valor}</p>
      <p className="text-xs text-muted-foreground">{extra}</p>
    </div>
  );
}

function Linha({ p, total, hoje, onPagar, cancelado }: { p: Parcela; total: number; hoje: string; onPagar: () => void; cancelado: boolean }) {
  const { isGestor } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const desfazer = useDesfazerPagamento();
  const quem = equipe.find((x) => x.id === p.pago_registrado_por)?.nome;

  const aoDesfazer = async () => {
    const motivo = await pedirTexto({
      titulo: `Desfazer o pagamento — ${rotuloParcela(p.numero, total)}?`,
      mensagem: "A parcela volta a ficar em aberto, também no portal do cliente.",
      rotulo: "Motivo", obrigatorio: true, confirmar: "Desfazer", perigo: true,
    });
    if (!motivo) return;
    try {
      await desfazer.mutateAsync({ id: p.id, motivo });
      toast.success("Pagamento desfeito.");
    } catch (e) {
      toast.error("Não foi possível desfazer.", { description: (e as Error).message });
    }
  };

  const situacao = p.pago_em
    ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Paga em {dataBR(p.pago_em)} · {p.pago_forma}</span>
    : p.vencimento < hoje
      ? <span className="font-medium text-destructive">Vencida</span>
      : p.vencimento === hoje
        ? <span className="font-medium text-warning">Vence hoje</span>
        : <span className="text-muted-foreground">A vencer</span>;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium text-foreground">{rotuloParcela(p.numero, total)}</p>
        <p className="text-xs text-muted-foreground">Vence {dataBR(p.vencimento)}</p>
      </div>
      <p className="w-28 text-sm font-semibold tabular-nums text-foreground">{reais(Number(p.valor))}</p>
      <div className="min-w-0 flex-1 basis-56 text-xs">
        <p>{situacao}</p>
        {p.pago_em && (
          <p className="text-muted-foreground">
            {[quem, p.pago_registrado_em ? `registrado em ${dataHoraBR(p.pago_registrado_em)}` : null, p.pago_obs].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p.pago_em && <Comprovante p={p} />}
        {p.boleto_url && (
          <a href={p.boleto_url} target="_blank" rel="noreferrer" className="q-link inline-flex items-center gap-1 text-xs">Boleto <ExternalLink className="h-3 w-3" /></a>
        )}
        {!p.pago_em && !cancelado && (
          <Button type="button" size="sm" onClick={onPagar}>Registrar pagamento</Button>
        )}
        {p.pago_em && isGestor && (
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={aoDesfazer} disabled={desfazer.isPending}>
            <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer
          </Button>
        )}
      </div>
    </li>
  );
}

function Comprovante({ p }: { p: Parcela }) {
  const anexar = useAnexarComprovante();
  const campo = useRef<HTMLInputElement>(null);
  const abrir = () => abrirComprovante(p.comprovante_path!).catch((e) => toast.error("Não foi possível abrir.", { description: (e as Error).message }));
  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    try {
      await anexar.mutateAsync({ parcela: p, arquivo });
      toast.success("Comprovante anexado.");
    } catch (e) {
      toast.error("Não foi possível anexar.", { description: (e as Error).message });
    } finally {
      if (campo.current) campo.current.value = "";
    }
  };
  if (p.comprovante_path) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={abrir}>
        <Paperclip className="mr-1 h-3.5 w-3.5" /> Comprovante
      </Button>
    );
  }
  return (
    <>
      <input ref={campo} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
      <Button type="button" size="sm" variant="outline" onClick={() => campo.current?.click()} disabled={anexar.isPending}>
        {anexar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1 h-3.5 w-3.5" />} Anexar comprovante
      </Button>
    </>
  );
}

function RegistrarPagamento({ parcela, total, onFechar }: { parcela: Parcela | null; total: number; onFechar: () => void }) {
  return (
    <Dialog open={!!parcela} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{parcela ? `${rotuloParcela(parcela.numero, total)} · ${reais(Number(parcela.valor))}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">Registrar o pagamento desta parcela.</DialogDescription>
        </DialogHeader>
        {/* Formulário novo a cada parcela: nasce com a data de hoje. */}
        {parcela && <FormPagamento key={parcela.id} parcela={parcela} onFechar={onFechar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormPagamento({ parcela, onFechar }: { parcela: Parcela; onFechar: () => void }) {
  const pagar = usePagarParcela();
  const anexar = useAnexarComprovante();
  const [data, setData] = useState(hojeISO);
  const [forma, setForma] = useState(FORMAS_RECEBIMENTO[0]);
  const [obs, setObs] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const ocupado = pagar.isPending || anexar.isPending;

  const confirmar = async () => {
    try {
      await pagar.mutateAsync({ id: parcela.id, pagoEm: data, forma, obs: obs.trim() });
    } catch (e) {
      return toast.error("Não foi possível registrar.", { description: (e as Error).message });
    }
    if (arquivo) {
      try {
        await anexar.mutateAsync({ parcela, arquivo });
      } catch (e) {
        onFechar();
        return toast.error("Pagamento registrado, mas o comprovante não.", { description: (e as Error).message });
      }
    }
    toast.success("Pagamento registrado.");
    onFechar();
  };

  return (
    <>
      <div className="space-y-3">
        <Campo rotulo="Pago em"><CampoData valor={data} onChange={setData} anoMax={new Date().getFullYear()} /></Campo>
        <Campo rotulo="Forma">
          <Select value={forma} onValueChange={setForma}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{FORMAS_RECEBIMENTO.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </Campo>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium leading-none">Comprovante</span>
          <input ref={campo} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <div className="flex min-h-10 items-center gap-2 rounded-md border border-input bg-background px-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => campo.current?.click()}>
              <Paperclip className="mr-1 h-3.5 w-3.5" /> {arquivo ? "Trocar" : "Escolher arquivo"}
            </Button>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{arquivo?.name ?? "Foto ou PDF"}</span>
          </div>
        </div>
        <Campo rotulo="Observação interna"><Input value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
        <Button type="button" onClick={confirmar} disabled={!data || ocupado}>
          {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar
        </Button>
      </div>
    </>
  );
}
