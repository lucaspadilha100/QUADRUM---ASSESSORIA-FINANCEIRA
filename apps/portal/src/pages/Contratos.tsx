import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Archive, CheckCircle2, FileSignature, Loader2, MessageCircle, Paperclip, PenLine } from "lucide-react";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { abrirArquivo, marcarHistoricoLido, useAvisos, useContratos, type ContratoPortal } from "@/lib/portal";
import { dataHoraBR } from "@/lib/formato";

// "Segunda-Feira, 1 de Março de 2021", como no portal antigo. Data-só montada
// componente a componente: `new Date("2021-03-01")` é UTC e volta um dia aqui.
function dataPorExtenso(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
    .replace(/(^|[\s-])(\p{L})/gu, (_, s, l) => s + l.toUpperCase())
    .replace(/ De /g, " de ");
}

export default function Contratos() {
  const { data: contratos, isLoading, error } = useContratos();
  const { data: avisos } = useAvisos();
  const marcou = useRef(false);

  // Abrir a tela marca o histórico como lido — DEPOIS de ler, e uma vez: o
  // aviso urgente aparece nesta visita e some na próxima.
  useEffect(() => {
    if (contratos && !marcou.current) {
      marcou.current = true;
      marcarHistoricoLido().catch((e) => console.error("[portal] marcar lido:", e));
    }
  }, [contratos]);

  if (isLoading) {
    return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando seus contratos…</div>;
  }
  if (error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível carregar seus contratos. Tente novamente em instantes.</p>;
  }

  const lista = contratos ?? [];
  const urgente = lista.some((c) => c.urgente_nao_lido);
  const comPendencia = lista.filter((c) => c.pendencias.length > 0 && !c.cancelado);

  return (
    <div className="space-y-5">
      <h1 className="q-titulo-marca text-xl font-semibold text-foreground">Meus Contratos</h1>

      {avisos?.chat_nao_lido && (
        <Link to="/chat" className="flex items-center gap-3 rounded-xl border border-q-petrol/30 bg-card p-4 text-foreground no-underline shadow-sm hover:shadow-md">
          <MessageCircle className="h-5 w-5 shrink-0 text-q-petrol" />
          <span className="font-semibold">Novas mensagens no chat!</span>
          <span className="ml-auto text-sm text-q-petrol">Abrir</span>
        </Link>
      )}

      {urgente && (
        <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm text-foreground">
            <strong>Atenção!</strong> Você tem uma mensagem urgente. Entre em contato com o seu consultor ou fale com a gente pelo{" "}
            <Link to="/chat" className="q-link">chat</Link>.
          </p>
        </div>
      )}

      {comPendencia.map((c) => (
        <Accordion key={c.id} type="single" collapsible className="rounded-xl border border-q-gold/50 bg-card px-4">
          <AccordionItem value="p" className="border-0">
            <AccordionTrigger className="text-sm font-semibold">
              <span className="inline-flex items-center gap-2"><FileSignature className="h-4 w-4 text-q-gold" /> Pendências contrato #{c.numero}</span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2">
                {c.pendencias.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg bg-[hsl(var(--q-gold)/0.1)] px-3 py-2">
                    <span className="flex-1 text-sm font-medium">{p.nome}</span>
                    {p.no_sistema ? (
                      <Link to={`/documento/${p.id}`}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground no-underline sm:min-h-0 sm:py-1.5 sm:text-xs">
                        <PenLine className="h-3.5 w-3.5" /> Ler e assinar
                      </Link>
                    ) : p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer"
                        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground no-underline sm:min-h-0 sm:py-1.5 sm:text-xs">
                        <PenLine className="h-3.5 w-3.5" /> Assinar
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">O link de assinatura será enviado pelo seu consultor.</span>
                    )}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ))}

      {lista.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-foreground">
          Infelizmente não foi possível localizar contratos aceitos para seu CPF/CNPJ. Entre em contato com seu consultor!
        </div>
      ) : (
        // O primeiro contrato ATIVO já abre: tela toda fechada obriga um clique
        // antes de ver qualquer coisa.
        <Accordion type="multiple" defaultValue={[(lista.find((c) => !c.cancelado) ?? lista[0]).id]} className="space-y-3">
          {lista.map((c) => <PainelContrato key={c.id} c={c} />)}
        </Accordion>
      )}
    </div>
  );
}

function PainelContrato({ c }: { c: ContratoPortal }) {
  return (
    <AccordionItem value={c.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <AccordionTrigger className="px-5 py-4 hover:no-underline">
        <span className="flex flex-wrap items-center gap-3 text-left">
          <span className="q-titulo-marca text-sm font-semibold text-foreground">Contrato #{c.numero}</span>
          {c.cancelado && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-destructive">Contrato cancelado</span>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5">
        <Tabs defaultValue="dados">
          <TabsList className={`grid w-full sm:w-auto sm:inline-grid ${c.documentos.length ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
            {c.documentos.length > 0 && <TabsTrigger value="documentos">Documentos</TabsTrigger>}
          </TabsList>

          <TabsContent value="dados" className="pt-3">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Dado rotulo="Data" valor={dataPorExtenso(c.data_aceite)} />
              <Dado rotulo="Banco" valor={c.banco} />
              <Dado rotulo="Linha de crédito" valor={c.linha} />
              {(c.placa || c.veiculo) && <Dado rotulo="Veículo" valor={[c.veiculo, c.ano_modelo].filter(Boolean).join(" ") || null} />}
              {c.placa && <Dado rotulo="Placa" valor={c.placa} />}
              <Dado rotulo="Consultor" valor={c.consultor} />
              <Dado rotulo="Unidade" valor={c.unidade} />
            </dl>
          </TabsContent>

          <TabsContent value="historico" className="pt-3">
            {c.historico.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Nenhuma ocorrência registrada ainda.</p>
            ) : (
              <ul className="space-y-3">
                {c.historico.map((h) => (
                  <li key={h.id} className="rounded-lg bg-[hsl(var(--q-gold)/0.1)] p-4">
                    <p className="whitespace-pre-wrap text-sm text-foreground">{h.texto}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{h.autor ?? "Equipe TriConecta"} em {dataHoraBR(h.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {c.documentos.length > 0 && (
            <TabsContent value="documentos" className="pt-3">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {c.documentos.map((d) => (
                  <li key={d.id}>
                    {d.no_sistema ? (
                      <Link to={`/documento/${d.id}`} className="flex items-center gap-3 p-3 text-foreground no-underline hover:bg-accent/50">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm sm:truncate">{d.nome}</span>
                          <span className="block text-xs text-muted-foreground">Assinado em {dataHoraBR(d.assinado_em)}</span>
                        </span>
                      </Link>
                    ) : d.arquivo ? (
                      <button type="button" onClick={() => abrirArquivo("anexos", d.arquivo!).catch(() => toast.error("Não foi possível abrir o documento."))}
                        className="flex w-full items-center gap-3 p-3 text-left text-foreground hover:bg-accent/50">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm sm:truncate">{d.nome}</span>
                          <span className="block text-xs text-muted-foreground">Assinado em {dataHoraBR(d.assinado_em)}</span>
                        </span>
                        <Paperclip className="h-4 w-4 shrink-0 text-q-petrol" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 p-3">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm sm:truncate">{d.nome}</span>
                          <span className="block text-xs text-muted-foreground">Assinado em {dataHoraBR(d.assinado_em)}</span>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}

          <TabsContent value="atendimentos" className="pt-3">
            {c.atendimentos.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Nenhum atendimento encontrado!</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {c.atendimentos.map((a) => (
                  <li key={a.id}>
                    <Link to={a.arquivado ? `/chat/arquivado/${a.id}` : "/chat"}
                      className="flex items-center gap-3 p-3 text-foreground no-underline hover:bg-accent/50">
                      {a.arquivado ? <Archive className="h-4 w-4 shrink-0 text-muted-foreground" /> : <MessageCircle className="h-4 w-4 shrink-0 text-q-petrol" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm sm:truncate">{a.titulo}</span>
                        <span className="block text-xs text-muted-foreground">#{a.numero} · {a.arquivado ? "Arquivado" : "Em aberto"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </AccordionContent>
    </AccordionItem>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{valor || "—"}</dd>
    </div>
  );
}
