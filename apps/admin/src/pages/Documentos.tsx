import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { useDocumentoTipos } from "@/hooks/useCadastros";
import { useDocumentosTodos, type DocumentoLista } from "@/hooks/useDocumentosTodos";
import { useContratosPipeline, useSalvarDocumento } from "@/hooks/usePipeline";
import { useParamUrl } from "@/shell";
import { dataBR, dataHoraBR, diasDesde, formatarDocumento, soDigitos } from "@/lib/formato";

// Todas as pendências de assinatura num lugar só. É o "Pendências contrato #N"
// do Portal do Cliente: pendente aparece lá com o botão Assinar (o link).

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function Documentos() {
  const { data: docs = [], isLoading, error } = useDocumentosTodos();
  const salvar = useSalvarDocumento();
  const [filtro, setFiltro] = useParamUrl("status", "pendentes");
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [novo, setNovo] = useState(false);

  const pendentes = docs.filter((d) => !d.assinado_em).length;
  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    const dig = soDigitos(busca);
    return docs
      .filter((d) => filtro === "todos" || (filtro === "pendentes" ? !d.assinado_em : !!d.assinado_em))
      .filter((d) => !t
        || semAcento(d.contrato?.cliente?.nome ?? "").includes(t)
        || semAcento(d.tipo_info?.nome ?? d.tipo).includes(t)
        || (dig.length >= 3 && (d.contrato?.cliente?.documento ?? "").includes(dig))
        || String(d.contrato?.numero) === t.replace("#", ""));
  }, [docs, filtro, busca]);

  const marcar = async (d: DocumentoLista) => {
    try {
      await salvar.mutateAsync({ contratoId: d.contrato_id, id: d.id, campos: { assinado_em: d.assinado_em ? null : new Date().toISOString() } });
      toast.success(d.assinado_em ? "Voltou a ficar pendente." : "Marcado como assinado — sai das pendências do cliente.");
    } catch (e) {
      toast.error("Não foi possível atualizar.", { description: (e as Error).message });
    }
  };

  return (
    <div>
      <PageHeader
        titulo="Documentos para assinatura"
        descricao="O que está pendente aparece no Portal do Cliente com o botão Assinar, até ser marcado como assinado."
        acoes={<Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova pendência</Button>}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, documento ou nº" className="bg-card pl-9" />
        </div>
        <Chips
          valor={filtro}
          onChange={setFiltro}
          opcoes={[
            { valor: "pendentes", rotulo: `Pendentes (${pendentes})` },
            { valor: "assinados", rotulo: `Assinados (${docs.length - pendentes})` },
            { valor: "todos", rotulo: `Todos (${docs.length})` },
          ]}
        />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? (
          <Carregando />
        ) : error ? (
          <Falha erro={error as Error} />
        ) : lista.length === 0 ? (
          <Vazio texto={docs.length === 0 ? "Nenhuma pendência de assinatura." : filtro === "pendentes" ? "Nada pendente de assinatura. 🎉" : "Nada com esse filtro."} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {lista.map((d) => {
                const dias = diasDesde(d.created_at);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                    {d.assinado_em
                      ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                      : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-warning" aria-label="Pendente" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{d.tipo_info?.nome ?? d.tipo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.contrato?.cliente?.nome ?? "Cliente de outra carteira"}
                        {d.contrato?.cliente ? ` · ${formatarDocumento(d.contrato.cliente.documento)}` : ""}
                        {" · "}
                        <Link to={`/contratos?contrato=${d.contrato_id}`} className="q-link">Contrato #{d.contrato?.numero}</Link>
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground sm:w-48">
                      {d.assinado_em ? (
                        <>Assinado em {dataHoraBR(d.assinado_em)}</>
                      ) : (
                        <span className={dias >= 7 ? "font-medium text-destructive" : ""}>Pendente desde {dataBR(d.created_at)}{dias > 0 ? ` (${dias}d)` : ""}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {d.link_assinatura ? (
                        <a href={d.link_assinatura} target="_blank" rel="noreferrer" className="q-link inline-flex items-center gap-1 text-xs">
                          Link <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground" title="Sem link, o cliente vê o aviso de que o consultor vai enviar">sem link</span>
                      )}
                      <Button size="sm" variant="outline" onClick={() => marcar(d)} disabled={salvar.isPending}>
                        {d.assinado_em ? "Desfazer" : "Marcar assinado"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <NovaPendencia aberto={novo} onFechar={() => setNovo(false)} />
    </div>
  );
}

function NovaPendencia({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { data: contratos = [] } = useContratosPipeline();
  const { data: tipos = [] } = useDocumentoTipos();
  const salvar = useSalvarDocumento();
  const [contratoId, setContratoId] = useState("");
  const [tipo, setTipo] = useState("");
  const [link, setLink] = useState("");
  const ativos = contratos.filter((c) => !c.cancelado_em).sort((a, b) => b.numero - a.numero);
  const escolhido = ativos.find((c) => c.id === contratoId);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!contratoId || !tipo) return;
    try {
      await salvar.mutateAsync({ contratoId, campos: { tipo, link_assinatura: link.trim() || null } });
      toast.success("Pendência criada.");
      setContratoId(""); setTipo(""); setLink("");
      onFechar();
    } catch (err) {
      toast.error("Não foi possível criar.", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova pendência de assinatura</DialogTitle>
          <DialogDescription>Aparece para o cliente em "Pendências do contrato" no portal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Contrato</Label>
            <Select value={contratoId} onValueChange={setContratoId}>
              <SelectTrigger><SelectValue placeholder="Escolha o contrato" /></SelectTrigger>
              <SelectContent>
                {ativos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>#{c.numero} · {c.cliente?.nome ?? "Cliente de outra carteira"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {escolhido && !escolhido.data_aceite && (
              <p className="text-[11px] text-warning">Este contrato ainda não foi aceito: o cliente só vê a pendência quando ele chegar à etapa de aceite.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Documento</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.codigo} value={t.codigo}>{t.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pend-link">Link para assinar (opcional)</Label>
            <Input id="pend-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
            <p className="text-[11px] text-muted-foreground">Sem link, o cliente vê que o consultor vai enviar.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={!contratoId || !tipo || salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar pendência
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
