import { Construction } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

/**
 * Tela que já tem lugar no menu e ainda não foi construída. Diz o que ELA
 * VAI fazer (tirado de docs/mapeamento-portal-cliente.md), para o menu servir
 * de roteiro em vez de prometer uma tela pronta.
 */
export default function EmConstrucao({ titulo, oQueFaz }: { titulo: string; oQueFaz: string[] }) {
  return (
    <div>
      <PageHeader titulo={titulo} />
      <div className="px-4 py-8 sm:px-8">
        <div className="max-w-2xl rounded-xl border border-dashed border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Construction className="h-4 w-4 text-q-gold" />
            Ainda não construída
          </div>
          <p className="mt-2 text-sm text-muted-foreground">O que esta tela vai fazer:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
            {oQueFaz.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
