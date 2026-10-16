import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PAPEL_LABEL } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { TrocarSenha } from "@/components/TrocarSenha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { comprimirFoto } from "@/lib/comprimirImagem";
import { useParamUrl } from "@/shell";

/**
 * O perfil de quem está logado, em abas: Dados · Foto · Senha.
 * Nível, departamento e e-mail são do GESTOR (tela de Usuários) — e quem
 * impede é o gatilho `q_perfil_protege_acesso`, no banco.
 */
export default function MeuPerfil() {
  const { perfil } = useAuth();
  const [aba, setAba] = useParamUrl("aba", "dados");
  if (!perfil) return null;
  const papel = [PAPEL_LABEL[perfil.papel], perfil.departamento_nome].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader titulo="Meu perfil" />
      <div className="max-w-2xl px-4 py-6 sm:px-8">
        <div className="mb-6 flex items-center gap-4">
          <Avatar nome={perfil.nome} url={perfil.avatar_url} className="h-16 w-16 text-lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{perfil.nome}</p>
            <p className="truncate text-sm text-muted-foreground">{perfil.email}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-q-gold">{papel}</p>
          </div>
        </div>

        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="grid w-full grid-cols-3 sm:w-[360px]">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="foto">Foto</TabsTrigger>
            <TabsTrigger value="senha">Senha</TabsTrigger>
          </TabsList>
          <TabsContent value="dados"><Dados /></TabsContent>
          <TabsContent value="foto"><Foto /></TabsContent>
          <TabsContent value="senha">
            <section className="rounded-xl border border-border bg-card p-6">
              <TrocarSenha provisoria={false} onPronto={() => toast.success("Senha trocada.")} />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Dados() {
  const { perfil, recarregarPerfil } = useAuth();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cargo, setCargo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!perfil) return;
    setNome(perfil.nome ?? "");
    setTelefone(perfil.telefone ?? "");
    setCargo(perfil.cargo ?? "");
  }, [perfil?.nome, perfil?.telefone, perfil?.cargo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!perfil) return null;
  const mudou = nome.trim() !== (perfil.nome ?? "") || telefone.trim() !== (perfil.telefone ?? "") || cargo.trim() !== (perfil.cargo ?? "");

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return toast.error("O nome não pode ficar vazio.");
    setSalvando(true);
    const { error } = await supabase.from("perfis")
      .update({ nome: nome.trim(), telefone: telefone.trim() || null, cargo: cargo.trim() || null })
      .eq("id", perfil.id);
    setSalvando(false);
    if (error) return toast.error("Não foi possível salvar.", { description: error.message });
    await recarregarPerfil();
    toast.success("Perfil atualizado.");
  };

  return (
    <form onSubmit={salvar} className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome de exibição</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="telefone">Telefone</Label>
          <Input id="telefone" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cargo">Cargo</Label>
          <Input id="cargo" placeholder="Ex.: Consultor" value={cargo} onChange={(e) => setCargo(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!mudou || salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
        </Button>
      </div>
    </form>
  );
}

const BUCKET = "avatares";
const caminhoNoBucket = (url: string | null) => url?.split(`/storage/v1/object/public/${BUCKET}/`)[1] ?? null;

function Foto() {
  const { perfil, recarregarPerfil } = useAuth();
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<{ blob: Blob; url: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url); }, [previa]);
  if (!perfil) return null;

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    try {
      const blob = await comprimirFoto(f);
      setPrevia({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  };

  const gravarUrl = async (url: string | null) => {
    const { error } = await supabase.from("perfis").update({ avatar_url: url }).eq("id", perfil.id);
    if (error) throw new Error(error.message);
    const antigo = caminhoNoBucket(perfil.avatar_url);
    if (antigo) await supabase.storage.from(BUCKET).remove([antigo]);
    await recarregarPerfil();
  };

  const salvar = async () => {
    if (!previa) return;
    setTrabalhando(true);
    try {
      const ext = previa.blob.type === "image/webp" ? "webp" : "jpg";
      const caminho = `${perfil.id}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(caminho, previa.blob, { contentType: previa.blob.type, cacheControl: "31536000" });
      if (up.error) throw new Error(up.error.message);
      await gravarUrl(supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl);
      setPrevia(null);
      toast.success("Foto atualizada.");
    } catch (e) {
      toast.error("Não foi possível salvar a foto.", { description: (e as Error).message });
    } finally {
      setTrabalhando(false);
    }
  };

  const remover = async () => {
    setTrabalhando(true);
    try { await gravarUrl(null); toast.success("Foto removida."); }
    catch (e) { toast.error("Não foi possível remover.", { description: (e as Error).message }); }
    finally { setTrabalhando(false); }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <div className="relative">
          <Avatar nome={perfil.nome} url={previa?.url ?? perfil.avatar_url} className="h-28 w-28 text-2xl" />
          <button type="button" onClick={() => entrada.current?.click()} aria-label="Escolher foto"
            className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-q-gold text-q-onix shadow ring-2 ring-card hover:brightness-95">
            <Camera className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center gap-2 sm:items-start">
          <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
          {previa ? (
            <>
              <p className="text-sm text-muted-foreground">{Math.max(1, Math.round(previa.blob.size / 1024))} KB</p>
              <div className="flex gap-2">
                <Button type="button" onClick={salvar} disabled={trabalhando}>
                  {trabalhando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar foto
                </Button>
                <Button type="button" variant="outline" onClick={() => setPrevia(null)} disabled={trabalhando}>Cancelar</Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => entrada.current?.click()}>
                <Camera className="mr-2 h-4 w-4" /> {perfil.avatar_url ? "Trocar foto" : "Escolher foto"}
              </Button>
              {perfil.avatar_url && (
                <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={remover} disabled={trabalhando}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
