import { useMemo, useState } from "react";
import {
  DndContext, MouseSensor, TouchSensor, closestCorners, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Globe, Plus } from "lucide-react";
import { DraggableCard, DroppableColumn, KanbanDragOverlay } from "@/components/kanban/KanbanDnd";
import { ContratoCard } from "./ContratoCard";
import { POR_COLUNA, type ColunaQuadro, type ContratoPipeline } from "@/hooks/usePipeline";
import type { Etapa } from "@/hooks/useCadastros";

// Portado do KanbanBoard do CRM da Carbo, sem o que era de lá (funis, repasse,
// temperatura). A coluna é a ETAPA (cadastro); o card é o CONTRATO.
//
// ESCALA: cada coluna chega com as primeiras N (as paradas há mais tempo) e o
// TOTAL dela (`q_pipeline`). O número no topo é o total real; "carregar mais"
// pede as próximas daquela coluna só. Com 50 mil contratos, o quadro continua
// abrindo com algumas centenas de cards, não com a carteira inteira.

interface Props {
  etapas: Etapa[];
  colunas: ColunaQuadro[];
  onMover: (c: ContratoPipeline, etapaId: string) => void;
  onAbrir: (c: ContratoPipeline) => void;
  onNovo: (etapaId: string) => void;
  onCarregarMais: (etapaId: string, quantos: number) => void;
  carregando: boolean;
}

export function PipelineBoard({ etapas, colunas, onMover, onAbrir, onNovo, onCarregarMais, carregando }: Props) {
  const [ativoId, setAtivoId] = useState<string | null>(null);

  // Mouse "pega" com 5px; toque exige pressionar (200ms) para não brigar com
  // a rolagem do quadro no celular.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const porEtapa = useMemo(() => {
    const m: Record<string, ColunaQuadro> = {};
    for (const c of colunas) m[c.etapa_id] = c;
    return m;
  }, [colunas]);

  const ativo = ativoId ? colunas.flatMap((c) => c.cards).find((c) => c.id === ativoId) : null;

  const aoSoltar = (ev: DragEndEvent) => {
    setAtivoId(null);
    const c = ev.active.data.current?.entity as ContratoPipeline | undefined;
    const destino = ev.over?.id as string | undefined;
    if (!c || !destino || c.etapa_id === destino) return;
    onMover(c, destino);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(ev: DragStartEvent) => setAtivoId(ev.active.id as string)}
      onDragEnd={aoSoltar}
      onDragCancel={() => setAtivoId(null)}
      autoScroll={{ threshold: { x: 0.1, y: 0.15 }, acceleration: 12 }}
    >
      {/* ⚠️ `justify-start`, nunca `justify-center`: num quadro que rola,
          centralizar empurra a primeira coluna para fora da borda esquerda e
          não há como rolar de volta (lição medida na Esteira da Carbo).
          No celular: uma coluna por arraste (86vw + snap). */}
      <div className="flex snap-x snap-mandatory justify-start gap-3 overflow-x-auto pb-4 sm:snap-none">
        {etapas.map((e) => {
          const coluna = porEtapa[e.id];
          const lista = coluna?.cards ?? [];
          const total = coluna?.total ?? 0;
          return (
            <div
              key={e.id}
              className="flex h-[calc(100dvh-210px)] w-[86vw] shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/50 sm:w-72"
            >
              <div className="rounded-t-xl border-b border-border bg-card px-3 py-2.5" style={{ borderTop: `3px solid ${e.cor}` }}>
                <div className="flex items-center gap-2">
                  <h3 className="line-clamp-2 min-w-0 flex-1 font-sans text-sm font-semibold leading-tight text-foreground" title={e.nome}>{e.nome}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground" title={`${total} contratos nesta etapa`}>{total.toLocaleString("pt-BR")}</span>
                  <button
                    type="button"
                    onClick={() => onNovo(e.id)}
                    title="Novo contrato nesta etapa"
                    aria-label={`Novo contrato em ${e.nome}`}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground sm:h-6 sm:w-6 hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {e.aceita && (
                  // Diz ANTES do arraste o que esta coluna faz: soltar aqui
                  // publica o contrato para o cliente.
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-q-petrol">
                    <Globe className="h-3 w-3" /> Portal
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DroppableColumn id={e.id}>
                  <div className="space-y-2 p-2">
                    {lista.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">Nenhum contrato</p>
                    ) : (
                      lista.map((c) => (
                        <DraggableCard key={c.id} id={c.id} data={{ entity: c }}>
                          <ContratoCard c={c} onClick={onAbrir} />
                        </DraggableCard>
                      ))
                    )}
                    {total > lista.length && (
                      <button type="button" disabled={carregando}
                        onClick={() => onCarregarMais(e.id, lista.length + POR_COLUNA)}
                        className="w-full rounded-lg border border-dashed border-border bg-card/60 py-2 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-60">
                        Carregar mais ({(total - lista.length).toLocaleString("pt-BR")} restantes)
                      </button>
                    )}
                  </div>
                </DroppableColumn>
              </div>
            </div>
          );
        })}
      </div>
      <KanbanDragOverlay>{ativo ? <ContratoCard c={ativo} /> : null}</KanbanDragOverlay>
    </DndContext>
  );
}
