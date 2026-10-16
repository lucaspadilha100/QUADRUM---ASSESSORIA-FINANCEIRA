import { ShieldCheck } from "lucide-react";
import { TextoDocumento } from "@/components/documento/DocumentoImpresso";
import { usePrivacidade } from "@/lib/portal";
import { dataHoraBR } from "@/lib/formato";

export default function Privacidade() {
  const { data: termo, isLoading } = usePrivacidade();
  if (isLoading) return null;
  if (!termo) return <p className="text-sm text-muted-foreground">Nenhuma política de privacidade publicada.</p>;
  return (
    <div className="space-y-4">
      {termo.aceito_em && (
        <p className="inline-flex items-center gap-2 text-sm text-success"><ShieldCheck className="h-4 w-4" /> Aceita em {dataHoraBR(termo.aceito_em)} · versão {termo.versao}</p>
      )}
      <article className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <TextoDocumento texto={termo.texto} />
      </article>
    </div>
  );
}
