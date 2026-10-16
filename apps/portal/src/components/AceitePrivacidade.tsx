import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TextoDocumento } from "@/components/documento/DocumentoImpresso";
import { useAceitarPrivacidade, type TermoPrivacidade } from "@/lib/portal";
import simboloQ from "@/assets/simbolo-q.png";

export function AceitePrivacidade({ termo, onSair }: { termo: TermoPrivacidade; onSair: () => void }) {
  const aceitar = useAceitarPrivacidade();
  const [li, setLi] = useState(false);
  const enviar = async () => {
    try { await aceitar.mutateAsync(termo.id); }
    catch (e) { toast.error("Não foi possível registrar o aceite.", { description: (e as Error).message }); }
  };
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-8">
      <div className="w-full max-w-2xl">
        <img src={simboloQ} alt="" className="mx-auto mb-5 h-12 w-auto" />
        <article className="max-h-[58dvh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <TextoDocumento texto={termo.texto} />
        </article>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm text-foreground">
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--q-gold))]" />
          <span>Li e aceito a {termo.titulo}.</span>
        </label>
        <Button className="mt-4 h-11 w-full font-semibold" disabled={!li || aceitar.isPending} onClick={enviar}>
          {aceitar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aceitar e continuar
        </Button>
        <button type="button" onClick={onSair} className="mx-auto mt-4 block py-2 text-xs text-muted-foreground hover:text-foreground">Sair</button>
      </div>
    </div>
  );
}
