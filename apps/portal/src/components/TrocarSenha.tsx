import { useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Trocar a PRÓPRIA senha (q_trocar_minha_senha, migração 20261018010000).
//
// Com senha PROVISÓRIA (a que a equipe gerou) não pede a atual: a pessoa
// acabou de digitá-la no login. Fora disso, pede.
// ⚠️ Quem recusa senha fraca é o BANCO (q_senha_fraca); a lista abaixo só
// mostra, enquanto digita, o que ele vai cobrar.
// ⚠️ Arquivo COPIADO, idêntico, em apps/admin e apps/portal.
// ─────────────────────────────────────────────────────────────────────────────

const REGRAS: { texto: string; ok: (s: string) => boolean }[] = [
  { texto: "Pelo menos 8 caracteres", ok: (s) => s.length >= 8 },
  { texto: "Letras e números", ok: (s) => /[A-Za-zÀ-ÿ]/.test(s) && /[0-9]/.test(s) },
];

export function TrocarSenha({ provisoria, onPronto, rotulo = "Salvar nova senha", className }: {
  provisoria: boolean;
  onPronto: () => void;
  rotulo?: string;
  className?: string;
}) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const regrasOk = REGRAS.every((r) => r.ok(nova));
  const iguais = nova.length > 0 && nova === confirma;
  const pode = regrasOk && iguais && (provisoria || atual.length > 0) && !enviando;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!pode) return;
    setErro(null);
    setEnviando(true);
    const { data, error } = await supabase.rpc("q_trocar_minha_senha", { p_atual: provisoria ? null : atual, p_nova: nova });
    setEnviando(false);
    if (error) return setErro(error.message);
    const r = data as { ok: boolean; erro?: string };
    if (!r.ok) return setErro(r.erro ?? "Não foi possível trocar a senha.");
    setAtual(""); setNova(""); setConfirma("");
    onPronto();
  };

  const tipo = ver ? "text" : "password";
  return (
    <form onSubmit={enviar} className={cn("space-y-4", className)}>
      {!provisoria && (
        <div className="space-y-1.5">
          <Label htmlFor="senha-atual">Senha atual</Label>
          <Input id="senha-atual" type={tipo} autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} className="bg-background" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="senha-nova">Nova senha</Label>
        <div className="relative">
          <Input id="senha-nova" type={tipo} autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} className="bg-background pr-10" autoFocus={provisoria} />
          <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Esconder senha" : "Mostrar senha"}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
            {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha-confirma">Repita a nova senha</Label>
        <Input id="senha-confirma" type={tipo} autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} className="bg-background" />
      </div>

      <ul className="space-y-1 text-xs">
        {[...REGRAS.map((r) => ({ texto: r.texto, ok: r.ok(nova) })), { texto: "As duas senhas iguais", ok: iguais }].map((r) => (
          <li key={r.texto} className={cn("flex items-center gap-1.5", r.ok ? "text-success" : "text-muted-foreground")}>
            {r.ok ? <Check className="h-3.5 w-3.5" /> : <span className="mx-[5px] h-1 w-1 rounded-full bg-current" />} {r.texto}
          </li>
        ))}
      </ul>

      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{erro}</p>}

      <Button type="submit" className="w-full font-semibold sm:w-auto" disabled={!pode}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {rotulo}
      </Button>
    </form>
  );
}
