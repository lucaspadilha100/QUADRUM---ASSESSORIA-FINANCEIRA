import { Loader2 } from "lucide-react";

export function Carregando() {
  return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
}

// Falha de consulta NÃO vira lista vazia: vazio diz "não há", isto é "não carregou".
export function Falha({ erro }: { erro: Error }) {
  return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível carregar: {erro.message}</p>;
}

export function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{texto}</p>;
}
