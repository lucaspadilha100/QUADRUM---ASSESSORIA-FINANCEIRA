import { useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { NovoCardDialog } from "@/components/pipeline/NovoCardDialog";
import { ContratoDetalhe } from "@/components/pipeline/ContratoDetalhe";
import { useEtapas } from "@/hooks/useCadastros";
import { useMoverContrato, usePipelineQuadro, type ContratoPipeline } from "@/hooks/usePipeline";
import { useAtrasado } from "@/hooks/usePagina";
import { useAuth } from "@/contexts/AuthContext";
import { useParamUrl } from "@/shell";

export default function Pipeline() {
  const { isGestor } = useAuth();
  const { data: etapas = [], isLoading: carregandoEtapas, error: erroEtapas } = useEtapas();
  const mover = useMoverContrato();

  // Busca e "mostrar perdidos" moram na URL: F5 e link mantêm a tela.
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [verPerdidos, setVerPerdidos] = useParamUrl("perdidos", "");
  // O card aberto também: link direto para um contrato funciona.
  const [abertoId, setAbertoId] = useParamUrl("contrato", "");
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  // "Carregar mais" por coluna: quantos cards cada uma mostra além do padrão.
  const [limites, setLimites] = useState<Record<string, number>>({});

  const termo = useAtrasado(busca);
  const { data: quadro, isLoading: carregando, isFetching, error } = usePipelineQuadro(termo, !!verPerdidos, limites);
  const colunas = quadro?.colunas ?? [];

  // Etapa desativada some do quadro — MENOS se ainda houver contrato nela,
  // senão o card sumiria da tela sem erro nenhum.
  const etapasVisiveis = useMemo(
    () => etapas.filter((e) => e.ativo || colunas.some((c) => c.etapa_id === e.id && c.total > 0)),
    [etapas, colunas],
  );
  const perdidos = quadro?.perdidos ?? 0;

  const aoMover = (c: ContratoPipeline, etapaId: string) => {
    const destino = etapas.find((e) => e.id === etapaId);
    mover.mutate(
      { id: c.id, etapaId },
      {
        onSuccess: () => {
          if (destino?.aceita && !c.data_aceite) {
            toast.success("Contrato aceito — o cliente já vê no portal.");
          }
        },
        onError: (e) => toast.error("Não foi possível mover. O card voltou.", { description: (e as Error).message }),
      },
    );
  };

  const falha = erroEtapas ?? error;

  return (
    <div>
      <PageHeader
        titulo="Pipeline"
        descricao={isGestor ? "Todos os contratos da Quadrum." : "Os contratos da sua carteira."}
        acoes={
          <Button onClick={() => { setNovoEm(null); setNovoAberto(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo contrato
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setLimites({}); }}
            placeholder="Buscar por nome, CPF/CNPJ, placa ou nº"
            className="bg-card pl-9"
          />
          {isFetching && !carregando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {(perdidos > 0 || verPerdidos) && (
          <button
            type="button"
            onClick={() => setVerPerdidos(verPerdidos ? "" : "1")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              verPerdidos ? "border-q-onix bg-q-onix text-q-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {verPerdidos ? "Ocultar perdidos" : `Ver perdidos (${perdidos.toLocaleString("pt-BR")})`}
          </button>
        )}
      </div>

      <div className="px-4 pt-4 sm:px-8">
        {carregando || carregandoEtapas ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando a pipeline…
          </div>
        ) : falha ? (
          // Falha de consulta NÃO vira quadro vazio: quadro vazio diz "não há
          // contratos", e isto é "não carregou".
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Não foi possível carregar a pipeline: {(falha as Error).message}
          </p>
        ) : etapasVisiveis.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma etapa cadastrada.</p>
        ) : (
          <PipelineBoard
            etapas={etapasVisiveis}
            colunas={colunas}
            onMover={aoMover}
            onAbrir={(c) => setAbertoId(c.id)}
            onNovo={(etapaId) => { setNovoEm(etapaId); setNovoAberto(true); }}
            onCarregarMais={(etapaId, quantos) => setLimites((l) => ({ ...l, [etapaId]: quantos }))}
            carregando={isFetching}
          />
        )}
      </div>

      <NovoCardDialog aberto={novoAberto} etapaInicial={novoEm} onFechar={() => setNovoAberto(false)} />
      <ContratoDetalhe contratoId={abertoId || null} onFechar={() => setAbertoId("")} />
    </div>
  );
}
