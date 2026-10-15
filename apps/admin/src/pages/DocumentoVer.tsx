import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2, Clock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Carregando, Falha } from "@/components/Estados";
import { ManifestoAssinatura, TextoDocumento, dataHoraBrasilia, useIntegridade } from "@/components/documento/DocumentoImpresso";
import { useDocumentoCompleto, type Assinatura, type DocumentoCompleto } from "@/hooks/useModelos";
import { formatarDocumento } from "@/lib/formato";

// O documento como o cliente o leu, a prova da assinatura e a TRILHA: cada
// geração, abertura, tentativa e assinatura, com IP e navegador.

const EVENTO: Record<string, string> = {
  gerado: "Documento gerado",
  visualizado: "Aberto pelo cliente no portal",
  senha_incorreta: "Tentativa de assinatura com senha incorreta",
  assinado: "Assinado pelo cliente",
  cancelado: "Cancelado",
  marcado_assinado: "Marcado como assinado (fora do sistema)",
  assinatura_desmarcada: "Assinatura desmarcada",
};

export function manifestoDe(d: DocumentoCompleto, a: Assinatura) {
  return {
    titulo: d.titulo ?? d.tipo_info?.nome ?? d.tipo,
    contrato_numero: d.contrato?.numero ?? null,
    nome: a.signatario_nome, documento: a.signatario_documento, assinado_em: a.assinado_em,
    ip: a.ip, user_agent: a.user_agent, metodo: a.metodo, nome_digitado: a.nome_digitado,
    aceite_texto: a.aceite_texto, visualizado_em: a.visualizado_em, hash: a.hash_sha256, codigo: a.codigo_verificacao,
  };
}

export default function DocumentoVer() {
  const { id } = useParams();
  const { data, isLoading, error } = useDocumentoCompleto(id ?? null);
  const d = data?.documento;
  const integro = useIntegridade(d?.conteudo, d?.conteudo_hash);

  if (isLoading) return <div className="px-4 sm:px-8"><Carregando /></div>;
  if (error) return <div className="p-4 sm:px-8"><Falha erro={error as Error} /></div>;
  if (!d) return <p className="p-8 text-sm text-muted-foreground">Documento não encontrado — ou é de outra carteira.</p>;

  const a = data?.assinatura;
  return (
    <div className="px-4 py-6 sm:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link to="/documentos"><ArrowLeft className="mr-1 h-4 w-4" /> Documentos</Link></Button>
        <div className="ml-auto flex gap-2">
          {d.conteudo && (
            <Button asChild variant="outline" size="sm">
              <a href={`/documentos/${d.id}/imprimir`} target="_blank" rel="noreferrer"><Printer className="mr-1 h-4 w-4" /> Imprimir / PDF</a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <article className="rounded-xl border border-border bg-card p-5 sm:p-8">
          <header className="mb-6 border-b border-border pb-4">
            <p className="font-titulo text-xs font-semibold text-muted-foreground">
              {d.titulo ?? d.tipo_info?.nome} · <Link to={`/contratos?contrato=${d.contrato_id}`} className="q-link">contrato #{d.contrato?.numero}</Link>
            </p>
            <p className="mt-1 text-sm text-foreground">
              {d.contrato?.cliente ? `${d.contrato.cliente.nome} · ${formatarDocumento(d.contrato.cliente.documento)}` : "Cliente de outra carteira"}
            </p>
            <p className="mt-2 text-sm">
              {d.cancelado_em ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><Ban className="h-4 w-4" /> Cancelado em {dataHoraBrasilia(d.cancelado_em)}{d.motivo_cancelamento ? ` — ${d.motivo_cancelamento}` : ""}</span>
              ) : d.assinado_em ? (
                <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Assinado em {dataHoraBrasilia(d.assinado_em)}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warning"><Clock className="h-4 w-4" /> Aguardando a assinatura do cliente no portal</span>
              )}
            </p>
          </header>
          {d.conteudo ? (
            <>
              <TextoDocumento texto={d.conteudo} />
              {a && <ManifestoAssinatura m={manifestoDe(d, a)} integro={integro} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Documento assinado fora do sistema{d.link_assinatura ? <> (<a href={d.link_assinatura} target="_blank" rel="noreferrer" className="q-link">link</a>)</> : ""}. Não há texto guardado aqui.
            </p>
          )}
        </article>

        <aside className="space-y-3">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="q-titulo-marca mb-3 text-xs text-foreground">Trilha do documento</h2>
            {(data?.eventos ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum evento.</p>
            ) : (
              <ol className="space-y-3">
                {data!.eventos.map((e) => (
                  <li key={e.id} className="border-l-2 border-border pl-3">
                    <p className={`text-sm font-medium ${e.tipo === "assinado" ? "text-success" : e.tipo === "senha_incorreta" ? "text-destructive" : "text-foreground"}`}>
                      {EVENTO[e.tipo] ?? e.tipo}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{dataHoraBrasilia(e.created_at)}</p>
                    <p className="break-all text-[11px] text-muted-foreground">
                      {e.ator_tipo === "cliente" ? "Cliente" : e.ator_tipo === "equipe" ? "Equipe" : "Sistema"}
                      {e.ip ? ` · IP ${e.ip}` : ""}
                    </p>
                    {e.user_agent && <p className="line-clamp-2 break-all text-[10px] text-muted-foreground/80" title={e.user_agent}>{e.user_agent}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {d.conteudo_hash && (
            <section className="rounded-xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
              <p className="font-semibold text-foreground">Integridade</p>
              <p className="mt-1">SHA-256 do texto: <code className="break-all font-mono">{d.conteudo_hash}</code></p>
              <p className="mt-1">{integro == null ? "Conferindo…" : integro ? "✓ O texto na tela confere com o gerado." : "✗ O texto NÃO confere com o gerado."}</p>
              {d.modelo_versao && <p className="mt-1">Gerado da versão {d.modelo_versao} do modelo.</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
