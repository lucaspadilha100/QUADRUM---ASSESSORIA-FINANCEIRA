import { useState } from "react";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmar } from "@/shell";
import { gerarSenha, useDefinirSenhaPortal } from "@/hooks/usePipeline";
import { useSenhasProvisorias } from "@/hooks/useUsuarios";
import { formatarDocumento } from "@/lib/formato";

// Gera (ou redefine) a senha do Portal do Cliente. A senha aparece UMA vez,
// para a equipe passar ao cliente — o banco guarda só o hash.
export function AcessoPortal({ cliente }: { cliente: { id: string; documento: string; user_id: string | null } }) {
  const definir = useDefinirSenhaPortal();
  const { data: provisorias } = useSenhasProvisorias();
  const provisoria = !!cliente.user_id && !!provisorias?.has(cliente.user_id);
  const [senha, setSenha] = useState<string | null>(null);
  // O portal sai no MESMO deploy, em /portal. VITE_PORTAL_URL só para domínio próprio.
  const portalUrl = (import.meta.env.VITE_PORTAL_URL as string | undefined) || `${window.location.origin}/portal`;

  const gerar = async () => {
    if (cliente.user_id && !(await confirmar({
      titulo: "Redefinir a senha do portal?",
      mensagem: "A senha atual deixa de valer na hora. Passe a nova ao cliente.",
      confirmar: "Redefinir",
    }))) return;
    const nova = gerarSenha();
    try {
      await definir.mutateAsync({ clienteId: cliente.id, senha: nova });
      setSenha(nova);
    } catch (e) {
      toast.error("Não foi possível gerar a senha.", { description: (e as Error).message });
    }
  };

  const copiar = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success("Copiado."); } catch { toast.error("Não foi possível copiar."); }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <KeyRound className="h-4 w-4 text-q-petrol" />
      <span className="text-xs text-muted-foreground">
        {!cliente.user_id ? "Sem acesso ao portal." : provisoria ? "Acesso gerado · o cliente ainda não criou a senha dele." : "Tem acesso ao portal."}
      </span>
      <Button type="button" size="sm" variant="outline" className="ml-auto h-9" onClick={gerar} disabled={definir.isPending}>
        {definir.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
        {cliente.user_id ? "Redefinir senha" : "Gerar acesso"}
      </Button>

      <Dialog open={!!senha} onOpenChange={(o) => !o && setSenha(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Acesso ao Portal do Cliente</DialogTitle>
            <DialogDescription>A senha aparece só agora.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            {portalUrl && <p><span className="text-muted-foreground">Endereço:</span> <a className="q-link" href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</a></p>}
            <p><span className="text-muted-foreground">{cliente.documento.length === 14 ? "CNPJ" : "CPF"}:</span> <strong>{formatarDocumento(cliente.documento)}</strong></p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Senha:</span>
              <strong className="font-mono text-base tracking-wider">{senha}</strong>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => senha && copiar(senha)} aria-label="Copiar senha"><Copy className="h-3.5 w-3.5" /></Button>
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => copiar(
              `Portal do Cliente Quadrum${portalUrl ? `\n${portalUrl}` : ""}\n${cliente.documento.length === 14 ? "CNPJ" : "CPF"}: ${formatarDocumento(cliente.documento)}\nSenha: ${senha}`,
            )}>Copiar tudo</Button>
            <Button type="button" onClick={() => setSenha(null)}>Pronto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

