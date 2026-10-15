import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, ExternalLink, Eye, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pedirTexto } from "@/shell";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentoTipos } from "@/hooks/useCadastros";
import { useCancelarDocumento, useDocumentos, useSalvarDocumento, type ContratoPipeline, type DocumentoPendente } from "@/hooks/usePipeline";
import { GerarDocumento } from "@/components/documento/GerarDocumento";
import { dataHoraBR } from "@/lib/formato";

// A aba "Pendências" do card: gerar documento do MODELO (assina no portal),
// ou registrar um assinado FORA (link). O que está pendente aparece para o
// cliente em "Pendências do contrato".

export function DocumentosDoContrato({ contrato, onCompletar }: { contrato: ContratoPipeline; onCompletar?: (onde: "cliente" | "dados") => void }) {
  const { data: docs = [], isLoading, error } = useDocumentos(contrato.id);
  return (
    <div className="space-y-4 pt-2">
      {!contrato.cancelado_em && (
        <Tabs defaultValue="modelo" className="rounded-lg border border-border p-3">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="modelo">Gerar do modelo</TabsTrigger>
            <TabsTrigger value="link">Assinado fora (link)</TabsTrigger>
          </TabsList>
          <TabsContent value="modelo" className="pt-2">
            <GerarDocumento contrato={{ id: contrato.id, numero: contrato.numero, cliente_id: contrato.cliente?.id, data_aceite: contrato.data_aceite }} onCompletar={onCompletar} />
          </TabsContent>
          <TabsContent value="link" className="pt-2"><NovoLink contratoId={contrato.id} /></TabsContent>
        </Tabs>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
      ) : docs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum documento.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => <ItemDocumento key={d.id} d={d} contratoId={contrato.id} />)}
        </ul>
      )}
    </div>
  );
}

export function SituacaoDocumento({ assinado_em, cancelado_em, no_sistema }: { assinado_em: string | null; cancelado_em: string | null; no_sistema: boolean }) {
  if (cancelado_em) return <>Cancelado em {dataHoraBR(cancelado_em)}</>;
  if (assinado_em) return <>Assinado em {dataHoraBR(assinado_em)}{no_sistema ? " · pelo portal" : " · fora do sistema"}</>;
  return <>{no_sistema ? "Aguardando assinatura" : "Pendente (link)"}</>;
}

function ItemDocumento({ d, contratoId }: { d: DocumentoPendente; contratoId: string }) {
  const { perfil } = useAuth();
  const salvar = useSalvarDocumento();
  const cancelar = useCancelarDocumento();
  const noSistema = !!d.conteudo_hash;
  const pendente = !d.assinado_em && !d.cancelado_em;

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

  const marcar = async () => {
    try {
      await salvar.mutateAsync({ contratoId, id: d.id, campos: { assinado_em: d.assinado_em ? null : new Date().toISOString() } });
    } catch (e) {
      toast.error("Não foi possível atualizar.", { description: (e as Error).message });
    }
  };

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-3 ${d.cancelado_em ? "opacity-60" : ""}`}>
      {d.cancelado_em ? <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />
        : d.assinado_em ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-warning" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{d.titulo ?? d.tipo_info?.nome ?? d.tipo}</p>
        <p className="text-[11px] text-muted-foreground">
          <SituacaoDocumento assinado_em={d.assinado_em} cancelado_em={d.cancelado_em} no_sistema={noSistema} />
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {noSistema ? (
          <Button asChild size="sm" variant="outline"><Link to={`/documentos/${d.id}`}><Eye className="mr-1 h-3.5 w-3.5" /> Ver</Link></Button>
        ) : d.link_assinatura ? (
          <a href={d.link_assinatura} target="_blank" rel="noreferrer" className="q-link inline-flex items-center gap-1 text-xs">link <ExternalLink className="h-3 w-3" /></a>
        ) : null}
        {!noSistema && !d.cancelado_em && (
          <Button type="button" size="sm" variant="outline" onClick={marcar} disabled={salvar.isPending}>
            {d.assinado_em ? "Desfazer" : "Marcar assinado"}
          </Button>
        )}
        {pendente && (
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={aoCancelar}>Cancelar</Button>
        )}
      </div>
    </li>
  );
}

export function NovoLink({ contratoId, onCriado }: { contratoId: string; onCriado?: () => void }) {
  const { data: tipos = [] } = useDocumentoTipos();
  const salvar = useSalvarDocumento();
  const [tipo, setTipo] = useState("");
  const [link, setLink] = useState("");

  const adicionar = async () => {
    if (!tipo) return;
    try {
      await salvar.mutateAsync({ contratoId, campos: { tipo, link_assinatura: link.trim() || null } });
      setTipo(""); setLink("");
      toast.success("Pendência criada.");
      onCriado?.();
    } catch (e) {
      toast.error("Não foi possível criar.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger><SelectValue placeholder="Documento" /></SelectTrigger>
          <SelectContent>
            {tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.codigo} value={t.codigo}>{t.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link para assinar (opcional)" />
        <Button type="button" onClick={adicionar} disabled={!tipo || salvar.isPending}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />} Adicionar
        </Button>
      </div>
    </div>
  );
}
