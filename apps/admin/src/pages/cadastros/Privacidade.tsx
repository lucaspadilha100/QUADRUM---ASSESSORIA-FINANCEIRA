import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando, Falha } from "@/components/Estados";
import { TextoDocumento } from "@/components/documento/DocumentoImpresso";
import { useAuth } from "@/contexts/AuthContext";
import { useCriarTermo, usePublicarTermo, useTermos, type Termo } from "@/hooks/useLgpd";
import { dataBR } from "@/lib/formato";
import { confirmar, useParamUrl } from "@/shell";

export default function Privacidade() {
  const { isGestor } = useAuth();
  const { data, isLoading, error } = useTermos();
  const publicar = usePublicarTermo();
  const [abertoId, setAbertoId] = useParamUrl("versao", "");
  const [nova, setNova] = useState(false);
  const termos = data?.termos ?? [];
  const aberto = termos.find((t) => t.id === abertoId) ?? termos.find((t) => t.ativo) ?? termos[0] ?? null;

  const aoPublicar = async (t: Termo) => {
    if (!(await confirmar({ titulo: `Publicar a versão ${t.versao}?`, mensagem: "Todos os clientes aceitam de novo no próximo acesso ao portal.", confirmar: "Publicar" }))) return;
    try { await publicar.mutateAsync(t.id); toast.success(`Versão ${t.versao} em vigor.`); }
    catch (e) { toast.error("Não foi possível publicar.", { description: (e as Error).message }); }
  };
  const aoDesativar = async () => {
    if (!(await confirmar({ titulo: "Tirar o termo de vigor?", mensagem: "O portal deixa de pedir aceite.", confirmar: "Tirar de vigor", perigo: true }))) return;
    try { await publicar.mutateAsync(null); toast.success("Nenhum termo em vigor."); }
    catch (e) { toast.error("Não foi possível.", { description: (e as Error).message }); }
  };

  return (
    <div>
      <PageHeader titulo="Privacidade (LGPD)" acoes={isGestor && <Button onClick={() => setNova(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova versão</Button>} />
      <div className="grid gap-4 px-4 py-4 sm:px-8 lg:grid-cols-[280px_1fr]">
        {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : (
          <>
            <ul className="space-y-2">
              {termos.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setAbertoId(t.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${aberto?.id === t.id ? "border-q-gold bg-accent" : "border-border bg-card hover:bg-accent/50"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">Versão {t.versao}</span>
                      {t.ativo
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success"><CheckCircle2 className="h-3 w-3" /> Em vigor</span>
                        : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t.publicado_em ? "Anterior" : "Rascunho"}</span>}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t.publicado_em ? `Publicada em ${dataBR(t.publicado_em)}` : `Criada em ${dataBR(t.created_at)}`} · {data?.aceites[t.id] ?? 0} aceite{(data?.aceites[t.id] ?? 0) === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {aberto && (
              <article className="rounded-xl border border-border bg-card p-5 sm:p-8">
                {isGestor && (
                  <div className="mb-5 flex flex-wrap justify-end gap-2">
                    {aberto.ativo
                      ? <Button variant="outline" onClick={aoDesativar} disabled={publicar.isPending}>Tirar de vigor</Button>
                      : <Button onClick={() => aoPublicar(aberto)} disabled={publicar.isPending}>{publicar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publicar esta versão</Button>}
                  </div>
                )}
                <TextoDocumento texto={aberto.texto} />
              </article>
            )}
          </>
        )}
      </div>
      <NovaVersao aberto={nova} base={termos[0] ?? null} onFechar={() => setNova(false)} onCriado={(id) => { setNova(false); setAbertoId(id); }} />
    </div>
  );
}

function NovaVersao({ aberto, base, onFechar, onCriado }: { aberto: boolean; base: Termo | null; onFechar: () => void; onCriado: (id: string) => void }) {
  const criar = useCriarTermo();
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [chave, setChave] = useState(false);
  if (aberto !== chave) { setChave(aberto); if (aberto) { setTitulo(base?.titulo ?? "Política de Privacidade"); setTexto(base?.texto ?? ""); } }

  const salvar = async () => {
    try { const id = await criar.mutateAsync({ titulo: titulo.trim(), texto }); toast.success("Rascunho criado."); onCriado(id); }
    catch (e) { toast.error("Não foi possível salvar.", { description: (e as Error).message }); }
  };
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova versão do termo</DialogTitle>
          <DialogDescription className="sr-only">Nova versão do termo de privacidade</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="t-titulo">Título</Label><Input id="t-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="t-texto">Texto</Label><Textarea id="t-texto" rows={16} value={texto} onChange={(e) => setTexto(e.target.value)} className="font-mono text-sm" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={!titulo.trim() || !texto.trim() || criar.isPending}>{criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar rascunho</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
