import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, ExternalLink, Eye, Link2, Loader2, Paperclip, Plus } from "lucide-react";
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
import { abrirArquivo, subirAnexo } from "@/hooks/useAnexos";
import { dataHoraBR } from "@/lib/formato";

// A aba "Documentos" do card: gerar documento do MODELO (assina no portal),
// ou registrar um assinado FORA — com a foto/PDF do documento assinado (o
// normal) ou um link para assinar (raro) —, e a lista do que já foi. O que está
// pendente aparece para o cliente em "Pendências do contrato".

export function DocumentosDoContrato({ contrato, onCompletar }: { contrato: ContratoPipeline; onCompletar?: (onde: "cliente" | "dados") => void }) {
  const { data: docs = [], isLoading, error } = useDocumentos(contrato.id);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      {!contrato.cancelado_em && (
        <Tabs defaultValue="modelo" className="min-w-0 rounded-xl border border-border bg-card p-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="modelo">Gerar do modelo</TabsTrigger>
            <TabsTrigger value="link">Assinado fora</TabsTrigger>
          </TabsList>
          <TabsContent value="modelo" className="pt-2">
            <GerarDocumento contrato={{ id: contrato.id, numero: contrato.numero, cliente_id: contrato.cliente?.id, data_aceite: contrato.data_aceite }} onCompletar={onCompletar} />
          </TabsContent>
          <TabsContent value="link" className="pt-2"><NovoLink contratoId={contrato.id} /></TabsContent>
        </Tabs>
      )}

      <div className={`min-w-0 ${contrato.cancelado_em ? "lg:col-span-2" : ""}`}>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
        ) : docs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">Nenhum documento.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {docs.map((d) => <ItemDocumento key={d.id} d={d} contratoId={contrato.id} />)}
          </ul>
        )}
      </div>
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
      <div className="flex flex-wrap items-center gap-1.5">
        {noSistema ? (
          <Button asChild size="sm" variant="outline"><Link to={`/documentos/${d.id}`}><Eye className="mr-1 h-3.5 w-3.5" /> Ver</Link></Button>
        ) : d.arquivo_path ? (
          <Button type="button" size="sm" variant="outline"
            onClick={() => abrirArquivo("anexos", d.arquivo_path!).catch((e) => toast.error("Não foi possível abrir.", { description: (e as Error).message }))}>
            <Paperclip className="mr-1 h-3.5 w-3.5" /> Ver
          </Button>
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

/** Documento assinado FORA do sistema: o arquivo assinado (foto/PDF) já o registra como assinado; só o link deixa pendente. */
export function NovoLink({ contratoId, onCriado }: { contratoId: string; onCriado?: () => void }) {
  const { data: tipos = [] } = useDocumentoTipos();
  const salvar = useSalvarDocumento();
  const [tipo, setTipo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [comLink, setComLink] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const ocupado = subindo || salvar.isPending;

  const adicionar = async () => {
    if (!tipo) return;
    try {
      let arquivo_path: string | null = null;
      if (arquivo) {
        setSubindo(true);
        arquivo_path = (await subirAnexo(`contrato/${contratoId}`, arquivo)).caminho;
      }
      await salvar.mutateAsync({ contratoId, campos: {
        tipo,
        link_assinatura: !arquivo && link.trim() ? link.trim() : null,
        ...(arquivo_path ? { arquivo_path, assinado_em: new Date().toISOString() } : {}),
      } });
      setTipo(""); setLink(""); setArquivo(null); setComLink(false);
      toast.success(arquivo_path ? "Documento assinado registrado." : "Pendência criada.");
      onCriado?.();
    } catch (e) {
      toast.error("Não foi possível registrar.", { description: (e as Error).message });
    } finally {
      setSubindo(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Select value={tipo} onValueChange={setTipo}>
        <SelectTrigger><SelectValue placeholder="Documento" /></SelectTrigger>
        <SelectContent>
          {tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.codigo} value={t.codigo}>{t.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      <input ref={campo} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      <div className="flex min-h-10 items-center gap-2 rounded-md border border-input bg-background px-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => campo.current?.click()}>
          <Paperclip className="mr-1 h-3.5 w-3.5" /> {arquivo ? "Trocar" : "Arquivo assinado"}
        </Button>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{arquivo?.name ?? "Foto ou PDF"}</span>
      </div>
      {!arquivo && (comLink ? (
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link para assinar" autoFocus />
      ) : (
        <button type="button" onClick={() => setComLink(true)} className="q-link inline-flex w-fit items-center gap-1 text-xs">
          <Plus className="h-3 w-3" /> Link para assinar
        </button>
      ))}
      <Button type="button" onClick={adicionar} disabled={!tipo || ocupado}>
        {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : arquivo ? <CheckCircle2 className="mr-1 h-4 w-4" /> : <Link2 className="mr-1 h-4 w-4" />}
        {arquivo ? "Registrar assinado" : "Adicionar"}
      </Button>
    </div>
  );
}
