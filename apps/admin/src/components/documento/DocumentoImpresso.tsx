import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { formatarDocumento } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ARQUIVO COPIADO, IGUAL, em apps/admin e apps/portal: a equipe e o cliente
// têm de ver o MESMO documento. Mudou um, copie o outro.
//
// O texto é o `conteudo` congelado pelo banco, desenhado com três regras só:
//   "# Título"   linha de título
//   **negrito**  negrito
//   linha vazia  novo parágrafo
// Nada de HTML vindo do banco: tudo vira elemento React (sem injeção).
// ─────────────────────────────────────────────────────────────────────────────

function comNegrito(linha: string, chave: string): ReactNode[] {
  return linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") && parte.length > 4
      ? <strong key={`${chave}-${i}`}>{parte.slice(2, -2)}</strong>
      : <Fragment key={`${chave}-${i}`}>{parte}</Fragment>,
  );
}

export function TextoDocumento({ texto }: { texto: string }) {
  const blocos = texto.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-foreground">
      {blocos.map((bloco, b) => {
        const linhas = bloco.split("\n");
        if (linhas.length === 1 && linhas[0].startsWith("# ")) {
          return <h2 key={b} className="pb-2 text-center font-titulo text-base font-bold uppercase tracking-wide">{linhas[0].slice(2)}</h2>;
        }
        return (
          <p key={b} className="text-left sm:text-justify print:text-justify">
            {linhas.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {l.startsWith("# ") ? <strong className="font-titulo uppercase">{l.slice(2)}</strong> : comNegrito(l, `${b}-${i}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Data e hora de Brasília, por extenso o bastante para valer em papel. */
export function dataHoraBrasilia(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) + " (horário de Brasília)";
}

/** Confere no NAVEGADOR que o texto na tela é o que o banco assinou (SHA-256). */
export function useIntegridade(conteudo: string | null | undefined, hash: string | null | undefined) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    setOk(null);
    if (!conteudo || !hash || !globalThis.crypto?.subtle) return;
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(conteudo)).then((buf) => {
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
      if (vivo) setOk(hex === hash);
    });
    return () => { vivo = false; };
  }, [conteudo, hash]);
  return ok;
}

export interface DadosManifesto {
  titulo: string;
  contrato_numero: number | null;
  nome: string;
  documento: string;
  assinado_em: string;
  ip: string | null;
  user_agent: string | null;
  metodo: string;
  nome_digitado: string;
  aceite_texto: string;
  visualizado_em: string | null;
  hash: string;
  codigo: string;
}

export function ManifestoAssinatura({ m, integro }: { m: DadosManifesto; integro: boolean | null }) {
  const linha = (rotulo: string, valor: ReactNode) => (
    <div className="grid gap-0.5 py-1.5 sm:grid-cols-[180px_1fr] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</dt>
      <dd className="break-words text-sm text-foreground">{valor}</dd>
    </div>
  );
  return (
    <section className="mt-8 break-inside-avoid rounded-lg border-2 border-q-petrol/40 p-4">
      <h3 className="mb-2 flex items-center gap-2 font-titulo text-sm font-bold uppercase tracking-wide text-q-petrol">
        <ShieldCheck className="h-4 w-4" /> Manifesto de assinatura eletrônica
      </h3>
      <dl className="divide-y divide-border">
        {linha("Documento", `${m.titulo}${m.contrato_numero ? ` — contrato nº ${m.contrato_numero}` : ""}`)}
        {linha("Signatário", m.nome)}
        {linha(m.documento.length === 14 ? "CNPJ" : "CPF", formatarDocumento(m.documento))}
        {linha("Assinado em", dataHoraBrasilia(m.assinado_em))}
        {m.visualizado_em && linha("Aberto pela 1ª vez em", dataHoraBrasilia(m.visualizado_em))}
        {linha("Endereço IP", m.ip ?? "não informado pela rede")}
        {linha("Navegador / dispositivo", m.user_agent ?? "não informado")}
        {linha("Autenticação", m.metodo)}
        {linha("Nome digitado", m.nome_digitado)}
        {linha("Declaração aceita", <span className="italic">“{m.aceite_texto}”</span>)}
        {linha("Hash SHA-256 do texto", <code className="break-all font-mono text-xs">{m.hash}</code>)}
        {linha("Código de verificação", <code className="font-mono text-sm font-semibold">{m.codigo}</code>)}
        {linha("Integridade", integro == null ? "conferindo…" : integro
          ? <span className="inline-flex items-center gap-1 font-medium text-success"><CheckCircle2 className="h-4 w-4" /> O texto acima é exatamente o que foi assinado</span>
          : <span className="inline-flex items-center gap-1 font-medium text-destructive"><XCircle className="h-4 w-4" /> O texto NÃO confere com o assinado</span>)}
      </dl>
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        Assinatura eletrônica registrada no Portal do Cliente da TriConecta Assessoria. Os dados acima
        (data e hora do servidor, IP e navegador) foram gravados no momento da assinatura e não podem ser
        alterados. Qualquer alteração no texto muda o hash SHA-256 e é detectada.
      </p>
    </section>
  );
}
