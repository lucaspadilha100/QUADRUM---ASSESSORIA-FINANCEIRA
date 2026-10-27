import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Lock, PenLine, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ManifestoAssinatura, TextoDocumento, dataHoraBrasilia, useIntegridade } from "@/components/documento/DocumentoImpresso";
import { useAssinarDocumento, useDocumento, type DocumentoPortal } from "@/lib/portal";

// ─────────────────────────────────────────────────────────────────────────────
// O cliente LÊ o documento inteiro e ASSINA aqui mesmo:
//   1. marca que leu e concorda (o texto do aceite fica gravado);
//   2. digita o nome completo, como no cadastro;
//   3. confirma a SENHA do portal — prova de que é o titular, e não só alguém
//      com a aba aberta.
// Quem grava a prova (IP, navegador, data e hora, hash do texto) é o BANCO
// (`portal_assinar_documento`); a tela não manda nada disso.
// ─────────────────────────────────────────────────────────────────────────────

export default function Documento() {
  const { id } = useParams();
  const { data: d, isLoading, error } = useDocumento(id);
  const integro = useIntegridade(d?.conteudo, d?.conteudo_hash);

  if (isLoading) return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando o documento…</div>;
  if (error || !d) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Documento não encontrado.</p>;

  return (
    <div className="space-y-5">
      <div className="q-nao-imprimir flex flex-wrap items-center gap-2">
        <Link to="/contratos" className="q-link -my-2 inline-flex items-center gap-1 py-2 text-sm"><ArrowLeft className="h-4 w-4" /> Meus Contratos</Link>
        {d.conteudo && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Imprimir / salvar PDF
          </Button>
        )}
      </div>

      <article className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <p className="mb-6 text-center font-titulo text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          TriConecta Assessoria · contrato #{d.contrato_numero}
        </p>
        {d.conteudo ? <TextoDocumento texto={d.conteudo} /> : (
          <p className="text-sm text-muted-foreground">Este documento é assinado fora do portal.{" "}
            {d.link && <a href={d.link} target="_blank" rel="noreferrer" className="q-link">Abrir o link de assinatura</a>}
          </p>
        )}
        {d.assinatura && (
          <ManifestoAssinatura integro={integro} m={{
            titulo: d.titulo, contrato_numero: d.contrato_numero, nome: d.assinatura.nome, documento: d.assinatura.documento,
            assinado_em: d.assinatura.assinado_em, ip: d.assinatura.ip, user_agent: d.assinatura.user_agent,
            metodo: d.assinatura.metodo, nome_digitado: d.assinatura.nome_digitado, aceite_texto: d.assinatura.aceite_texto,
            visualizado_em: d.assinatura.visualizado_em, hash: d.assinatura.hash, codigo: d.assinatura.codigo,
          }} />
        )}
      </article>

      {d.cancelado ? (
        <p className="q-nao-imprimir rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Este documento foi cancelado e não precisa mais ser assinado.</p>
      ) : d.assinado_em ? (
        <p className="q-nao-imprimir flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> Assinado em {dataHoraBrasilia(d.assinado_em)}. Uma cópia fica sempre disponível em Meus Contratos.
        </p>
      ) : d.conteudo ? (
        <Assinar d={d} />
      ) : null}
    </div>
  );
}

function Assinar({ d }: { d: DocumentoPortal }) {
  const assinar = useAssinarDocumento();
  const [aceite, setAceite] = useState(false);
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro("");
    try {
      const r = await assinar.mutateAsync({ id: d.id, senha, nome, aceite });
      if (!r.ok) { setErro(r.erro ?? "Não foi possível assinar."); setSenha(""); return; }
      toast.success("Documento assinado. Obrigado!");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  const nomeEsperado = d.pj && d.representante_nome ? `${d.cliente_nome} (ou ${d.representante_nome})` : d.cliente_nome;

  return (
    <form onSubmit={enviar} className="q-nao-imprimir space-y-4 rounded-xl border-2 border-q-gold/60 bg-card p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><PenLine className="h-5 w-5 text-q-gold" /> Assinar este documento</h2>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm text-foreground">
        <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--q-gold))]" />
        <span>{d.aceite_texto}</span>
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="ass-nome">Digite seu nome completo</Label>
        <Input id="ass-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" placeholder={nomeEsperado} />
        <p className="text-[11px] text-muted-foreground">Como está no seu cadastro: {nomeEsperado}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ass-senha">Confirme sua senha do portal</Label>
        <Input id="ass-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
      </div>

      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{erro}</p>}

      <Button type="submit" className="w-full sm:w-auto" disabled={!aceite || !nome.trim() || !senha || assinar.isPending}>
        {assinar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />} Assinar documento
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Ao assinar, registramos a data e a hora, o endereço IP e o navegador usados, junto com a impressão digital (hash) do texto acima.
        Depois de assinado, o documento não pode ser alterado.
      </p>
    </form>
  );
}
