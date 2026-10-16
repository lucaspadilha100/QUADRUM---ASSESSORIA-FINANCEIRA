import { AlertTriangle, Globe } from "lucide-react";
import type { ContratoPipeline } from "@/hooks/usePipeline";
import { diasDesde, formatarDocumento, iniciais } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// Card do contrato no kanban — ALTURA FIXA (lição do card da Carbo): card que
// cresce com o conteúdo faz a coluna serrilhar. Cada zona reserva a própria
// altura mesmo vazia, e corta o excesso (`truncate`/`overflow-hidden`).
//
// NOME PRIMEIRO: o olho tem de saber com quem está falando antes de ler o
// resto. Depois banco · linha · placa; depois o ESTADO (no portal, parado);
// por último quem cuida.
// ─────────────────────────────────────────────────────────────────────────────

export const ALTURA_CARD = 128;

export function ContratoCard({ c, onClick }: { c: ContratoPipeline; onClick?: (c: ContratoPipeline) => void }) {
  const dias = diasDesde(c.etapa_desde);
  // Parado na mesma etapa: 3+ dias âmbar, 7+ vermelho. Faixa lateral, não
  // fundo pintado — fundo tingido apaga o contraste do texto.
  const parado: "amber" | "red" | null = c.cancelado_em ? null : dias >= 7 ? "red" : dias >= 3 ? "amber" : null;
  const nome = c.cliente?.nome ?? "Cliente de outra carteira";
  const detalhe = [c.banco?.nome, c.linha?.nome, c.placa].filter(Boolean).join(" · ");

  return (
    <div
      style={{ height: ALTURA_CARD }}
      onClick={() => onClick?.(c)}
      className={`relative flex cursor-pointer flex-col gap-1 overflow-hidden rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md ${
        c.cancelado_em ? "border-dashed border-border bg-muted/60 opacity-75" : "border-border bg-card"
      }`}
    >
      {parado && (
        <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${parado === "red" ? "bg-destructive" : "bg-warning"}`} />
      )}

      {/* identidade */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-foreground" title={nome}>{nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {c.cliente ? formatarDocumento(c.cliente.documento) : "—"}
          </p>
        </div>
        <span className="shrink-0 font-titulo text-[11px] font-semibold text-muted-foreground">#{c.numero}</span>
      </div>

      {/* o que é */}
      <p className="h-4 truncate text-[11px] text-muted-foreground" title={detalhe}>{detalhe || "Sem banco/linha"}</p>

      {/* estado */}
      <div className="flex h-4 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] font-medium">
        {c.cancelado_em ? (
          <span className="text-destructive">Perdido</span>
        ) : c.data_aceite ? (
          // O que liga o admin ao portal: a partir daqui o cliente VÊ o contrato.
          <span className="inline-flex items-center gap-1 rounded-full bg-q-onix px-1.5 text-q-gold" title="O cliente já vê este contrato no Portal">
            <Globe className="h-2.5 w-2.5" /> No portal
          </span>
        ) : null}
        {parado && (
          <span className={`inline-flex items-center gap-1 ${parado === "red" ? "text-destructive" : "text-warning"}`}>
            <AlertTriangle className="h-2.5 w-2.5" /> {dias} dias nesta etapa
          </span>
        )}
      </div>

      {/* responsável */}
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-1.5">
        {c.consultor ? (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-q-onix text-[10px] font-semibold text-q-gold">
              {iniciais(c.consultor.nome)}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{c.consultor.nome}</span>
          </>
        ) : (
          // Sem consultor precisa APARECER: esconder faria parecer igual ao que tem dono.
          <span className="text-[11px] text-muted-foreground">sem consultor</span>
        )}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{dias}d</span>
      </div>
    </div>
  );
}
