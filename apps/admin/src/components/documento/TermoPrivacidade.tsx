import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
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

/** A Política de Privacidade (LGPD), dentro de Modelos de documento: versões, publicar e o texto. */
export function TermoPrivacidade() {
  const { isGestor } = useAuth();
  const { data, isLoading, error } = useTermos();
  const publicar = usePublicarTermo();
  const [versaoId, setVersaoId] = useParamUrl("versao", "");
  const [nova, setNova] = useState(false);
  const termos = data?.termos ?? [];
  const aberto = termos.find((t) => t.id === versaoId) ?? termos.find((t) => t.ativo) ?? termos[0] ?? null;

  const aoPublicar = async (t: Termo) => {
    if (!(await confirmar({ titulo: `Publicar a versão ${t.versao}?`, mensagem: "Todos os clientes aceitam de novo no próximo acesso ao portal.", confirmar: "Publicar" }))) return;
    try { await publicar.mutateAsync(t.id); toast.success(`Versão ${t.versao} em vigor.`); }
    catch (e) { toast.error("Não foi possível publicar.", { description: (e as Error).message }); }
  };
  const aoDesativar = async () => {
    if (!(await confirmar({ titulo: "Tirar a política de vigor?", mensagem: "O portal deixa de pedir aceite.", confirmar: "Tirar de vigor", perigo: true }))) return;
    try { await publicar.mutateAsync(null); toast.success("Nenhuma política em vigor."); }
    catch (e) { toast.error("Não foi possível.", { description: (e as Error).message }); }
  };

  if (isLoading) return <Carregando />;
  if (error) return <Falha erro={error as Error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {termos.map((t) => (
          <button key={t.id} type="button" onClick={() => setVersaoId(t.id)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-8 ${aberto?.id === t.id ? "border-q-gold bg-accent text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
            {t.ativo && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
            Versão {t.versao} · {t.ativo ? "em vigor" : t.publicado_em ? "anterior" : "rascunho"} · {data?.aceites[t.id] ?? 0} aceite{(data?.aceites[t.id] ?? 0) === 1 ? "" : "s"}
          </button>
        ))}
        {isGestor && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setNova(true)}><Plus className="mr-1 h-4 w-4" /> Nova versão</Button>}
      </div>

      {aberto && (
        <article className="rounded-xl border border-border bg-card p-5 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{aberto.publicado_em ? `Publicada em ${dataBR(aberto.publicado_em)}` : `Criada em ${dataBR(aberto.created_at)}`}</p>
            {isGestor && (aberto.ativo
              ? <Button variant="outline" onClick={aoDesativar} disabled={publicar.isPending}>Tirar de vigor</Button>
              : <Button onClick={() => aoPublicar(aberto)} disabled={publicar.isPending}>{publicar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publicar esta versão</Button>)}
          </div>
          <TextoDocumento texto={aberto.texto} />
        </article>
      )}
      <NovaVersao aberto={nova} base={aberto} onFechar={() => setNova(false)} onCriado={(id) => { setNova(false); setVersaoId(id); }} />
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
          <DialogTitle>Nova versão da política</DialogTitle>
          <DialogDescription className="sr-only">Nova versão da política de privacidade</DialogDescription>
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
