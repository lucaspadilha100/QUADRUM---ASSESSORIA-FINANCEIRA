import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Carregando, Falha } from "@/components/Estados";
import { ManifestoAssinatura, TextoDocumento, useIntegridade } from "@/components/documento/DocumentoImpresso";
import { useDocumentoCompleto } from "@/hooks/useModelos";
import { manifestoDe } from "@/pages/DocumentoVer";

// A folha para imprimir ou salvar em PDF (o "Salvar como PDF" do navegador).
// Fica FORA do layout do app — sem menu, sem cabeçalho —, só o documento e o
// manifesto de assinatura.

export default function DocumentoImprimir() {
  const { id } = useParams();
  const { data, isLoading, error } = useDocumentoCompleto(id ?? null);
  const d = data?.documento;
  const integro = useIntegridade(d?.conteudo, d?.conteudo_hash);

  if (isLoading) return <div className="p-8"><Carregando /></div>;
  if (error) return <div className="p-8"><Falha erro={error as Error} /></div>;
  if (!d?.conteudo) return <p className="p-8 text-sm text-muted-foreground">Documento não encontrado.</p>;

  return (
    <div className="min-h-screen bg-white">
      <div className="q-nao-imprimir sticky top-0 flex items-center justify-end gap-2 border-b border-border bg-card px-4 py-2">
        <p className="mr-auto text-xs text-muted-foreground">Para PDF: escolha "Salvar como PDF" no destino da impressão.</p>
        <Button size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Imprimir / salvar PDF</Button>
      </div>
      <main className="mx-auto max-w-[800px] px-6 py-10 text-black">
        <p className="mb-8 text-center font-titulo text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Quadrum Assessoria Financeira</p>
        <TextoDocumento texto={d.conteudo} />
        {data?.assinatura && <ManifestoAssinatura m={manifestoDe(d, data.assinatura)} integro={integro} />}
        {!data?.assinatura && <p className="mt-10 text-center text-xs text-neutral-500">Documento ainda não assinado.</p>}
      </main>
    </div>
  );
}
