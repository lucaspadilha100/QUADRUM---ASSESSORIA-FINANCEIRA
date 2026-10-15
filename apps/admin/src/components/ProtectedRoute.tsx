import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, perfil, isLoading, signOut } = useAuth();

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
              ? "Seu acesso à equipe Quadrum está desativado. Fale com um gestor."
              : "Esta conta não faz parte da equipe Quadrum. Se você é cliente, use o Portal do Cliente."}
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>Sair</Button>
      </div>
    );
  }

  return <>{children}</>;
}
