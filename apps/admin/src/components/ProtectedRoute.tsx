import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { TrocarSenha } from "@/components/TrocarSenha";
import simbolo from "@/assets/simbolo.png";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, perfil, isLoading, signOut, senhaProvisoria, senhaCriada } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Autenticado não é o mesmo que equipe: cliente do portal usa o MESMO Auth.
  if (!perfil || !perfil.ativo) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Acesso restrito</h1>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {perfil
              ? "Seu acesso à equipe TriConecta está desativado. Fale com um gestor."
              : "Esta conta não faz parte da equipe TriConecta. Se você é cliente, use o Portal do Cliente."}
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>Sair</Button>
      </div>
    );
  }

  if (senhaProvisoria) {
    return (
      <div className="q-escuro flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-sm">
          <img src={simbolo} alt="" className="mx-auto mb-6 h-14 w-auto" />
          <div className="rounded-xl border border-border bg-[hsl(var(--q-graphite))] p-6 shadow-2xl">
            <h1 className="q-titulo-marca text-sm font-semibold text-foreground">Crie a sua senha</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">Olá, {perfil.nome.split(" ")[0]}. Troque a senha que você recebeu.</p>
            <TrocarSenha provisoria rotulo="Criar senha e entrar" className="[&_button[type=submit]]:w-full" onPronto={senhaCriada} />
          </div>
          <button type="button" onClick={signOut} className="mx-auto mt-4 block text-xs text-muted-foreground hover:text-foreground">Sair</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
