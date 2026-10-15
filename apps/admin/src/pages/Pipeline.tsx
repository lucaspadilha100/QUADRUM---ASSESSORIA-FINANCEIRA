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
import { useContratosPipeline, useMoverContrato, type ContratoPipeline } from "@/hooks/usePipeline";
import { useAuth } from "@/contexts/AuthContext";
import { useParamUrl } from "@/shell";
import { soDigitos } from "@/lib/formato";

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function Pipeline() {
  const { isGestor } = useAuth();
  const { data: etapas = [], isLoading: carregandoEtapas, error: erroEtapas } = useEtapas();
  const { data: contratos = [], isLoading: carregando, error } = useContratosPipeline();
  const mover = useMoverContrato();

  // Busca e "mostrar perdidos" moram na URL: F5 e link mantêm a tela.
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [verPerdidos, setVerPerdidos] = useParamUrl("perdidos", "");
  // O card aberto também: link direto para um contrato funciona.
  const [abertoId, setAbertoId] = useParamUrl("contrato", "");
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  // Etapa desativada some do quadro — MENOS se ainda houver contrato nela,
  // senão o card sumiria da tela sem erro nenhum.
  const etapasVisiveis = useMemo(
    () => etapas.filter((e) => e.ativo || contratos.some((c) => c.etapa_id === e.id)),
    [etapas, contratos],
  );

  const perdidos = contratos.filter((c) => c.cancelado_em).length;

  const filtrados = useMemo(() => {
    const t = semAcento(busca.trim());
    const dig = soDigitos(busca);
    return contratos.filter((c) => {
      if (c.cancelado_em && !verPerdidos) return false;
      if (!t) return true;
      return (
        semAcento(c.cliente?.nome ?? "").includes(t) ||
        (dig.length >= 3 && (c.cliente?.documento ?? "").includes(dig)) ||
        semAcento(c.placa ?? "").includes(t) ||
        String(c.numero) === t.replace("#", "")
      );
    });
  }, [contratos, busca, verPerdidos]);

  // O painel lê o contrato da LISTA (sempre a versão mais nova do banco), não
  // de uma cópia guardada no clique — senão salvar e ver o antigo.
  const aberto: ContratoPipeline | null = contratos.find((c) => c.id === abertoId) ?? null;

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
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ, placa ou nº"
            className="bg-card pl-9"
          />
        </div>
        {perdidos > 0 && (
          <button
            type="button"
            onClick={() => setVerPerdidos(verPerdidos ? "" : "1")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              verPerdidos ? "border-q-onix bg-q-onix text-q-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {verPerdidos ? "Ocultar perdidos" : `Ver perdidos (${perdidos})`}
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
            contratos={filtrados}
            onMover={aoMover}
            onAbrir={(c) => setAbertoId(c.id)}
            onNovo={(etapaId) => { setNovoEm(etapaId); setNovoAberto(true); }}
          />
        )}
      </div>

      <NovoCardDialog aberto={novoAberto} etapaInicial={novoEm} onFechar={() => setNovoAberto(false)} />
      <ContratoDetalhe contrato={aberto} onFechar={() => setAbertoId("")} />
    </div>
  );
}
