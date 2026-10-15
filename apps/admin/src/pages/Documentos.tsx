import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, ExternalLink, Eye, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { BuscaContrato, type ContratoEscolhido } from "@/components/busca/BuscaContrato";
import { GerarDocumento } from "@/components/documento/GerarDocumento";
import { NovoLink, SituacaoDocumento } from "@/components/documento/DocumentosDoContrato";
import { ContratoDetalhe } from "@/components/pipeline/ContratoDetalhe";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentosPagina, type DocumentoLista } from "@/hooks/useDocumentosTodos";
import { useAtrasado } from "@/hooks/usePagina";
import { useCancelarDocumento, useSalvarDocumento } from "@/hooks/usePipeline";
import { pedirTexto, useParamUrl } from "@/shell";
import { dataBR, diasDesde, formatarDocumento } from "@/lib/formato";

// Todos os documentos num lugar só, uma página por vez. O pendente aparece no
// Portal do Cliente: o do MODELO com "Assinar" dentro do portal; o de LINK com
// o botão do link.

export default function Documentos() {
  const [filtro, setFiltro] = useParamUrl("status", "pendente");
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const pag = usePaginacaoUrl();
  const [novo, setNovo] = useState(false);
  // O contrato abre AQUI, por cima da lista (o "completar dados" e o nº do contrato).
  const [contratoAberto, setContratoAberto] = useParamUrl("contrato", "");
  const [, setPainel] = useParamUrl("painel", "dados");
  const abrirContrato = (id: string, painel?: string) => { setContratoAberto(id); if (painel) setPainel(painel); };

  const termo = useAtrasado(busca);
  const { data, isLoading, isFetching, error } = useDocumentosPagina({ busca: termo, situacao: filtro, pagina: pag.pagina, por: pag.por });
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { todos: 0, pendente: 0, assinado: 0, cancelado: 0 };
  const total = (cont as unknown as Record<string, number>)[filtro] ?? cont.todos;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div>
      <PageHeader
        titulo="Documentos para assinatura"
        acoes={<Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo documento</Button>}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar cliente, documento ou nº" className="bg-card pl-9" />
          {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <Chips
          valor={filtro}
          onChange={filtrar(setFiltro)}
          opcoes={[
            { valor: "pendente", rotulo: `Pendentes (${n(cont.pendente)})` },
            { valor: "assinado", rotulo: `Assinados (${n(cont.assinado)})` },
            { valor: "cancelado", rotulo: `Cancelados (${n(cont.cancelado)})` },
            { valor: "todos", rotulo: `Todos (${n(cont.todos)})` },
          ]}
        />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? (
          <Carregando />
        ) : error ? (
          <Falha erro={error as Error} />
        ) : lista.length === 0 ? (
          <Vazio texto={cont.todos === 0 && !termo ? "Nenhum documento ainda." : filtro === "pendente" && !termo ? "Nada pendente de assinatura. 🎉" : "Nada com esse filtro."} />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <ul className="divide-y divide-border">
                {lista.map((d) => <Linha key={d.id} d={d} onAbrirContrato={abrirContrato} />)}
              </ul>
            </div>
            <Paginacao pagina={pag.pagina} por={pag.por} total={total} onPagina={pag.irPara} onPor={pag.mudarPor} />
          </>
        )}
      </div>

      <NovoDocumento aberto={novo} onFechar={() => setNovo(false)}
        onCompletar={(contratoId, onde) => { setNovo(false); abrirContrato(contratoId, onde === "cliente" ? "cliente" : "dados"); }} />
      <ContratoDetalhe contratoId={contratoAberto || null} onFechar={() => setContratoAberto(null)} />
    </div>
  );
}

function Linha({ d, onAbrirContrato }: { d: DocumentoLista; onAbrirContrato: (id: string) => void }) {
  const { perfil } = useAuth();
  const salvar = useSalvarDocumento();
  const cancelar = useCancelarDocumento();
  const dias = diasDesde(d.created_at);
  const pendente = d.situacao === "pendente";

  const marcar = async () => {
    try {
      await salvar.mutateAsync({ contratoId: d.contrato_id, id: d.id, campos: { assinado_em: d.assinado_em ? null : new Date().toISOString() } });
      toast.success(d.assinado_em ? "Voltou a ficar pendente." : "Marcado como assinado.");
    } catch (e) {
      toast.error("Não foi possível atualizar.", { description: (e as Error).message });
    }
  };
  const aoCancelar = async () => {
    const motivo = await pedirTexto({
      titulo: "Cancelar este documento?", mensagem: "Ele sai das pendências do cliente. Para mandar outro, gere de novo.",
      rotulo: "Motivo", obrigatorio: true, confirmar: "Cancelar documento", perigo: true,
    });
    if (!motivo) return;
    try {
      await cancelar.mutateAsync({ id: d.id, motivo, autorId: perfil?.id ?? null });
      toast.success("Documento cancelado.");
    } catch (e) {
      toast.error("Não foi possível cancelar.", { description: (e as Error).message });
    }
  };

  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${d.cancelado_em ? "opacity-60" : ""}`}>
      {d.cancelado_em ? <Ban className="h-5 w-5 shrink-0 text-muted-foreground" />
        : d.assinado_em ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-warning" aria-label="Pendente" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {d.titulo}
          {d.no_sistema && <span className="ml-2 rounded-full bg-q-onix px-1.5 py-0.5 align-middle text-[10px] font-medium text-q-gold">assina no portal</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {d.cliente_nome ?? "Cliente de outra carteira"}
          {d.cliente_documento ? ` · ${formatarDocumento(d.cliente_documento)}` : ""}
          {" · "}
          <button type="button" onClick={() => onAbrirContrato(d.contrato_id)} className="q-link">Contrato #{d.contrato_numero}</button>
        </p>
      </div>
      <div className="text-xs text-muted-foreground sm:w-56">
        {pendente ? (
          <span className={dias >= 7 ? "font-medium text-destructive" : ""}>
            Pendente desde {dataBR(d.created_at)}{dias > 0 ? ` (${dias}d)` : ""}
            {d.no_sistema && !d.contrato_aceite ? " · contrato ainda não aceito" : ""}
          </span>
        ) : (
          <SituacaoDocumento assinado_em={d.assinado_em} cancelado_em={d.cancelado_em} no_sistema={d.no_sistema} />
        )}
      </div>
      <div className="flex items-center gap-2">
        {d.no_sistema ? (
          <Button asChild size="sm" variant="outline"><Link to={`/documentos/${d.id}`}><Eye className="mr-1 h-3.5 w-3.5" /> Ver</Link></Button>
        ) : d.link_assinatura ? (
          <a href={d.link_assinatura} target="_blank" rel="noreferrer" className="q-link inline-flex items-center gap-1 text-xs">Link <ExternalLink className="h-3 w-3" /></a>
        ) : (
          <span className="text-xs text-muted-foreground">sem link</span>
        )}
        {!d.no_sistema && !d.cancelado_em && (
          <Button size="sm" variant="outline" onClick={marcar} disabled={salvar.isPending}>{d.assinado_em ? "Desfazer" : "Marcar assinado"}</Button>
        )}
        {pendente && (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={aoCancelar}>Cancelar</Button>
        )}
      </div>
    </li>
  );
}

function NovoDocumento({ aberto, onFechar, onCompletar }: {
  aberto: boolean;
  onFechar: () => void;
  onCompletar: (contratoId: string, onde: "cliente" | "dados") => void;
}) {
  const [contrato, setContrato] = useState<ContratoEscolhido | null>(null);
  const fechar = () => { setContrato(null); onFechar(); };
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo documento para assinatura</DialogTitle>
          <DialogDescription className="sr-only">Aparece para o cliente em "Pendências do contrato" no portal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Contrato</Label>
            <BuscaContrato valor={contrato} onChange={setContrato} />
          </div>
          {contrato && (
            <Tabs defaultValue="modelo">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="modelo">Gerar do modelo</TabsTrigger>
                <TabsTrigger value="link">Assinado fora (link)</TabsTrigger>
              </TabsList>
              <TabsContent value="modelo" className="pt-3">
                <GerarDocumento contrato={contrato} onGerado={fechar}
                  onCompletar={(onde) => { const id = contrato.id; setContrato(null); onCompletar(id, onde); }} />
              </TabsContent>
              <TabsContent value="link" className="pt-3">
                <NovoLink contratoId={contrato.id} onCriado={fechar} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
