import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useSessao } from "@/contexts/Sessao";
import { supabaseConfigurado } from "@/integrations/supabase/client";
import { CONTATO_SENHA } from "@/lib/acesso";
import { documentoValido, mascararDocumento } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logotipo from "@/assets/logotipo.png";
import simboloQ from "@/assets/simbolo-q.png";

// Login por CPF/CNPJ + senha. Sem cadastro e sem "esqueci a senha": quem gera
// a senha é a equipe (manual da marca: fundo Preto Onix, card Cinza Grafite).
export default function Login() {
  const { user, cliente, entrar } = useSessao();
  const [doc, setDoc] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (user && cliente) return <Navigate to="/contratos" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!documentoValido(doc)) return setErro("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
    setEnviando(true);
    const falha = await entrar(doc, senha);
    setEnviando(false);
    if (falha) setErro(falha);
  };

  return (
    <div className="q-escuro relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <img src={simboloQ} alt="" aria-hidden className="pointer-events-none absolute -right-24 -top-16 w-[520px] max-w-none select-none opacity-[0.05]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={simboloQ} alt="" className="mb-4 h-16 w-auto" />
          <img src={logotipo} alt="Quadrum Assessoria Financeira" className="w-64 max-w-full" />
          <p className="q-titulo-marca mt-5 text-[11px] leading-relaxed text-muted-foreground">Menos dívidas.<br />Mais possibilidades.</p>
          <span className="mt-4 h-px w-12 bg-q-gold" />
        </div>

        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-border bg-[hsl(var(--q-graphite))] p-6 shadow-2xl">
          <h1 className="q-titulo-marca text-sm font-semibold text-foreground">Portal do Cliente Quadrum</h1>

          {!supabaseConfigurado && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> Portal sem configuração de banco.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="doc">CPF ou CNPJ</Label>
            <Input id="doc" inputMode="numeric" autoComplete="username" value={doc}
              onChange={(e) => setDoc(mascararDocumento(e.target.value))} className="bg-background" placeholder="000.000.000-00" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="senha">Senha</Label>
            <Input id="senha" type="password" autoComplete="current-password" required value={senha}
              onChange={(e) => setSenha(e.target.value)} className="bg-background" />
          </div>

          {erro && <p className="text-sm text-[hsl(355_80%_65%)]" role="alert">{erro}</p>}

          <Button type="submit" className="w-full font-semibold" disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} ENTRAR
          </Button>
          <p className="text-center text-xs text-muted-foreground">{CONTATO_SENHA}</p>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">Juntos pelo seu recomeço.</p>
      </div>
    </div>
  );
}
