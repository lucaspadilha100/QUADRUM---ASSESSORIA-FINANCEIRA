import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePagamentos, type PagamentosContrato, type ParcelaPortal } from "@/lib/portal";
import { dataBR } from "@/lib/formato";

// Pagamentos: as parcelas de cada contrato, o que já foi pago e o que vence.
// Boleto e PIX aparecem na parcela quando o banco for integrado.

const reais = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Pagamentos() {
  const { data, isLoading, error } = usePagamentos();
  if (isLoading) {
    return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando seus pagamentos…</div>;
  }
  if (error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível carregar seus pagamentos. Tente novamente em instantes.</p>;
  }
  const lista = data ?? [];
  return (
    <div className="space-y-5">
      <h1 className="q-titulo-marca text-xl font-semibold text-foreground">Pagamentos</h1>
      {lista.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-foreground">Nenhum pagamento por aqui ainda.</div>
      ) : (
        lista.map((k) => <Contrato key={k.contrato_id} k={k} />)
      )}
    </div>
  );
}

function Contrato({ k }: { k: PagamentosContrato }) {
  const h = hoje();
  const total = k.parcelas.reduce((t, p) => t + Number(p.valor), 0);
  const pago = k.parcelas.filter((p) => p.pago_em).reduce((t, p) => t + Number(p.valor), 0);
  const atrasadas = k.parcelas.filter((p) => !p.pago_em && p.vencimento < h);
  const proxima = k.parcelas.find((p) => !p.pago_em && p.vencimento >= h);
  const nParcelas = k.parcelas.filter((p) => p.numero > 0).length;
  const pct = total ? Math.round((pago / total) * 100) : 0;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="space-y-3 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="q-titulo-marca text-sm font-semibold text-foreground">Contrato #{k.numero}</span>
          {k.cancelado && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-destructive">Contrato cancelado</span>}
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-foreground"><strong className="font-semibold">{reais(pago)}</strong> pagos de {reais(total)}</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-q-gold" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {atrasadas.length > 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {atrasadas.length === 1 ? "1 parcela vencida" : `${atrasadas.length} parcelas vencidas`} · {reais(atrasadas.reduce((t, p) => t + Number(p.valor), 0))}
          </p>
        ) : proxima ? (
          <p className="text-sm text-muted-foreground">Próximo pagamento: <strong className="font-semibold text-foreground">{dataBR(proxima.vencimento)}</strong> · {reais(proxima.valor)}</p>
        ) : null}
      </header>
      <ul className="divide-y divide-border">
        {k.parcelas.map((p) => <Linha key={p.id} p={p} total={nParcelas} hoje={h} />)}
      </ul>
    </section>
  );
}

function Linha({ p, total, hoje: h }: { p: ParcelaPortal; total: number; hoje: string }) {
  const rotulo = p.numero === 0 ? "Entrada" : `Parcela ${p.numero} de ${total}`;
  const copiar = async (texto: string, o: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success(`${o} copiado.`); }
    catch { toast.error("Não foi possível copiar."); }
  };
  const botao = "inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9";
  return (
    <li className="space-y-2 p-4 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{rotulo}</p>
          <p className="text-xs text-muted-foreground">Vencimento {dataBR(p.vencimento)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">{reais(p.valor)}</p>
          {p.pago_em ? (
            <p className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Pago em {dataBR(p.pago_em)}</p>
          ) : p.vencimento < h ? (
            <p className="text-xs font-medium text-destructive">Vencida</p>
          ) : p.vencimento === h ? (
            <p className="text-xs font-medium text-warning">Vence hoje</p>
          ) : (
            <p className="text-xs text-muted-foreground">A vencer</p>
          )}
        </div>
      </div>
      {!p.pago_em && (p.boleto_url || p.boleto_linha_digitavel || p.pix_copia_cola) && (
        <div className="flex flex-wrap gap-2">
          {p.boleto_url && <a href={p.boleto_url} target="_blank" rel="noreferrer" className={`${botao} no-underline`}><ExternalLink className="h-4 w-4" /> Ver boleto</a>}
          {p.boleto_linha_digitavel && <button type="button" className={botao} onClick={() => copiar(p.boleto_linha_digitavel!, "Código do boleto")}><Copy className="h-4 w-4" /> Copiar código do boleto</button>}
          {p.pix_copia_cola && <button type="button" className={botao} onClick={() => copiar(p.pix_copia_cola!, "PIX")}><Copy className="h-4 w-4" /> Copiar PIX</button>}
        </div>
      )}
    </li>
  );
}
