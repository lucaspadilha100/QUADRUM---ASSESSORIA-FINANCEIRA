import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, PAPEL_LABEL } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrocarSenha } from "@/components/TrocarSenha";

/**
 * O perfil de quem está logado. Cada um edita nome, telefone e cargo.
 * Nível, e-mail e ativação são do GESTOR (tela de Usuários) — e não é a tela
 * que impede: o gatilho `q_perfil_protege_acesso` recusa no banco.
 */
export default function MeuPerfil() {
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
  }, [perfil]);

  if (!perfil) return null;

  const mudou =
    nome.trim() !== (perfil.nome ?? "") ||
    telefone.trim() !== (perfil.telefone ?? "") ||
    cargo.trim() !== (perfil.cargo ?? "");

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("O nome não pode ficar vazio.");
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from("perfis")
      .update({
        nome: nome.trim(),
        // Vazio vira nulo: "não informado" é diferente de um texto em branco.
        telefone: telefone.trim() || null,
        cargo: cargo.trim() || null,
      })
      .eq("id", perfil.id);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar.", { description: error.message });
      return;
    }
    await recarregarPerfil();
    toast.success("Perfil atualizado.");
  };

  const iniciais = perfil.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div>
      <PageHeader titulo="Meu perfil" />
      <div className="px-4 py-6 sm:px-8">
        <form onSubmit={salvar} className="max-w-xl space-y-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-q-onix font-titulo text-lg font-semibold text-q-gold">
              {iniciais || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{perfil.nome}</p>
              <p className="truncate text-sm text-muted-foreground">{perfil.email}</p>
              <span className="mt-1 inline-flex rounded-full bg-q-onix px-2.5 py-0.5 text-xs font-medium text-q-gold">
                {PAPEL_LABEL[perfil.papel]}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </div>
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
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </form>

        <section className="mt-6 max-w-xl rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-semibold text-foreground">Trocar senha</h2>
          <TrocarSenha provisoria={false} onPronto={() => toast.success("Senha trocada.")} />
        </section>
      </div>
    </div>
  );
}
