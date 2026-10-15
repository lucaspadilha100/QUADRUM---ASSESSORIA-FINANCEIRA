import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabaseConfigurado } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logotipo from "@/assets/logotipo.png";
import simboloQ from "@/assets/simbolo-q.png";

export default function Login() {
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await signIn(email.trim(), senha);
    setEnviando(false);
    if (error) setErro(error.message);
  };

  return (
    <div className="q-escuro relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Marca d'água do símbolo, em baixa opacidade (manual da marca). */}
      <img
        src={simboloQ}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-16 w-[520px] max-w-none select-none opacity-[0.05]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={simboloQ} alt="" className="mb-4 h-16 w-auto" />
          <img src={logotipo} alt="Quadrum Assessoria Financeira" className="w-64 max-w-full" />
          <p className="q-titulo-marca mt-5 text-[11px] leading-relaxed text-muted-foreground">
            Menos dívidas.<br />Mais possibilidades.
          </p>
          <span className="mt-4 h-px w-12 bg-q-gold" />
        </div>

        <form
          onSubmit={entrar}
          className="space-y-4 rounded-xl border border-border bg-[hsl(var(--q-graphite))] p-6 shadow-2xl"
        >
          <div>
            <h1 className="q-titulo-marca text-sm font-semibold text-foreground">Área da equipe</h1>
            <p className="mt-1 text-xs text-muted-foreground">Acesso restrito à equipe Quadrum.</p>
          </div>

          {!supabaseConfigurado && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                Banco não configurado: faltam <code>VITE_SUPABASE_URL</code> e{" "}
                <code>VITE_SUPABASE_ANON_KEY</code>. O login não vai funcionar até elas existirem.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="bg-background"
            />
          </div>

          {erro && <p className="text-sm text-[hsl(355_80%_65%)]" role="alert">{erro}</p>}

          <Button type="submit" className="w-full font-semibold" disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Entrar
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">Juntos pelo seu recomeço.</p>
      </div>
    </div>
  );
}
