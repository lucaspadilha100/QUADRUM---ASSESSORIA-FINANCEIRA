import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  NOME_ROBO, marcarChatLido, rotuloContrato, useAbrirAtendimento, useChat, useChatAtivo, useContratos,
  useEnviarMensagem, useSetores, type ChatPortal, type MensagemPortal,
} from "@/lib/portal";
import { dataHoraBR } from "@/lib/formato";
import { useQueryClient } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────────────────────
// No máximo UM atendimento aberto (o banco garante). Tem? Abre a conversa.
// Não tem? O robô faz 3 perguntas (contrato, setor, pedido) e só então cria o
// atendimento — e é o BANCO que grava as falas do robô (portal_abrir_atendimento),
// não esta tela. As frases abaixo são as mesmas de lá, para o cliente ver
// durante a conversa o que vai ficar gravado.
// ─────────────────────────────────────────────────────────────────────────────

const ROBO = {
  ola: "Olá. Seja bem-vindo ao atendimento da Quadrum.",
  contrato: "Para qual contrato você deseja atendimento?",
  setor: "E com qual setor você deseja falar?",
  pedido: "Por favor, nos fale resumidamente como podemos ajudá-lo?",
  semContrato: "Não encontramos contratos ativos para o seu CPF/CNPJ. Por favor, procure o seu consultor.",
};

export default function Chat() {
  const { id } = useParams();
  return id ? <Arquivado id={id} /> : <Ativo />;
}

function Arquivado({ id }: { id: string }) {
  const { data: chat, isLoading, error } = useChat(id);
  if (isLoading) return <Carregando />;
  if (error || !chat) return <p className="text-sm text-destructive">Atendimento não encontrado.</p>;
  return <Conversa chat={chat} somenteLeitura />;
}

function Ativo() {
  const { data: chat, isLoading, error } = useChatAtivo();
  if (isLoading) return <Carregando />;
  if (error) return <p className="text-sm text-destructive">Não foi possível carregar o atendimento. Tente novamente.</p>;
  return chat ? <Conversa chat={chat} /> : <Robo />;
}

function Conversa({ chat, somenteLeitura = false }: { chat: ChatPortal; somenteLeitura?: boolean }) {
  const enviar = useEnviarMensagem();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const leitura = somenteLeitura || chat.arquivado;

  // Mensagens da equipe na tela = lidas (apaga o "Novas mensagens no chat!").
  const ultimaEquipe = [...chat.mensagens].reverse().find((m) => m.autor_tipo === "equipe")?.id;
  useEffect(() => {
    if (!ultimaEquipe) return;
    marcarChatLido(chat.id)
      .then(() => qc.invalidateQueries({ queryKey: ["portal", "avisos"] }))
      .catch((e) => console.error("[portal] marcar chat lido:", e));
  }, [chat.id, ultimaEquipe, qc]);

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [chat.mensagens.length]);

  const mandar = async () => {
    if (!texto.trim()) return;
    try {
      await enviar.mutateAsync({ atendimentoId: chat.id, corpo: texto });
      setTexto("");
    } catch (e) {
      toast.error("Não foi possível enviar.", { description: (e as Error).message });
    }
  };

  return (
    <Moldura titulo={`Atendimento #${chat.numero}${chat.setor ? ` · ${chat.setor}` : ""}`}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {chat.mensagens.map((m) => <Balao key={m.id} m={m} />)}
        <div ref={fim} />
      </div>
      {leitura ? (
        <Rodape><p className="w-full text-center text-sm text-muted-foreground">Atendimento arquivado — somente leitura.</p></Rodape>
      ) : (
        <Rodape>
          <CampoMensagem valor={texto} onChange={setTexto} onEnviar={mandar} enviando={enviar.isPending} />
        </Rodape>
      )}
    </Moldura>
  );
}

function Robo() {
  const { data: contratos = [], isLoading: c1 } = useContratos();
  const { data: setores = [], isLoading: c2 } = useSetores();
  const abrir = useAbrirAtendimento();
  const [contratoId, setContratoId] = useState("");
  const [setorId, setSetorId] = useState("");
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [texto, setTexto] = useState("");

  if (c1 || c2) return <Carregando />;
  const ativos = contratos.filter((c) => !c.cancelado);
  const contrato = ativos.find((c) => c.id === contratoId);
  const setor = setores.find((s) => s.id === setorId);
  const agora = new Date().toISOString();
  const fala = (corpo: string, autor_tipo: MensagemPortal["autor_tipo"] = "robo"): MensagemPortal =>
    ({ id: corpo, autor_tipo, autor: autor_tipo === "cliente" ? "Você" : null, corpo, created_at: agora });

  const enviar = async () => {
    if (!texto.trim() || !contrato || !setor) return;
    try {
      await abrir.mutateAsync({ contratoId: contrato.id, setorId: setor.id, descricao: texto });
    } catch (e) {
      toast.error("Não foi possível abrir o atendimento.", { description: (e as Error).message });
    }
  };

  return (
    <Moldura titulo="Atendimento via Chat">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Balao m={fala(ROBO.ola)} />
        {ativos.length === 0 ? (
          <Balao m={fala(ROBO.semContrato)} />
        ) : (
          <>
            <Balao m={fala(ROBO.contrato)} />
            {passo === 1 ? (
              <Escolha rotulo="Contrato" valor={contratoId} onChange={setContratoId}
                opcoes={ativos.map((c) => ({ id: c.id, nome: rotuloContrato(c) }))} onConfirmar={() => setPasso(2)} />
            ) : (
              <Balao m={fala(contrato ? rotuloContrato(contrato) : "", "cliente")} />
            )}
            {passo >= 2 && (
              <>
                <Balao m={fala(ROBO.setor)} />
                {passo === 2 ? (
                  <Escolha rotulo="Setor" valor={setorId} onChange={setSetorId}
                    opcoes={setores.map((s) => ({ id: s.id, nome: s.nome }))} onConfirmar={() => setPasso(3)} />
                ) : (
                  <Balao m={fala(setor?.nome ?? "", "cliente")} />
                )}
              </>
            )}
            {passo === 3 && <Balao m={fala(ROBO.pedido)} />}
          </>
        )}
      </div>
      {passo === 3 && (
        <Rodape>
          <CampoMensagem valor={texto} onChange={setTexto} onEnviar={enviar} enviando={abrir.isPending} />
        </Rodape>
      )}
    </Moldura>
  );
}

// ── peças ────────────────────────────────────────────────────────────────────

function Moldura({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-xl border border-border bg-[hsl(var(--background))] shadow-sm md:h-[calc(100dvh-5rem)]">
      <div className="border-b border-border bg-card px-4 py-3">
        <h1 className="q-titulo-marca text-sm font-semibold text-foreground">{titulo}</h1>
      </div>
      {children}
    </div>
  );
}

function Rodape({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-border bg-card p-3">
      <Link to="/contratos" aria-label="Voltar" title="Voltar"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground no-underline hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      {children}
    </div>
  );
}

function CampoMensagem({ valor, onChange, onEnviar, enviando }: {
  valor: string; onChange: (v: string) => void; onEnviar: () => void; enviando: boolean;
}) {
  return (
    <>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnviar(); } }}
        placeholder="Mensagem"
        aria-label="Mensagem"
        className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-base outline-none sm:h-10 sm:text-sm focus:ring-2 focus:ring-ring"
      />
      <Button type="button" onClick={onEnviar} disabled={!valor.trim() || enviando} className="h-10 w-10 shrink-0 rounded-full p-0" aria-label="Enviar">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </>
  );
}

function Escolha({ rotulo, valor, onChange, opcoes, onConfirmar }: {
  rotulo: string; valor: string; onChange: (v: string) => void;
  opcoes: { id: string; nome: string }[]; onConfirmar: () => void;
}) {
  return (
    <div className="ml-10 max-w-sm space-y-2 rounded-xl border border-border bg-card p-3">
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger aria-label={rotulo}><SelectValue placeholder={rotulo} /></SelectTrigger>
        <SelectContent>{opcoes.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" size="sm" className="w-full font-semibold" disabled={!valor} onClick={onConfirmar}>CONFIRMAR</Button>
    </div>
  );
}

// Equipe/robô à ESQUERDA (branco), cliente à DIREITA (dourado suave) — o
// padrão do portal antigo, na cor da marca.
function Balao({ m }: { m: MensagemPortal }) {
  const doCliente = m.autor_tipo === "cliente";
  const autor = m.autor_tipo === "robo" ? NOME_ROBO : (m.autor || (doCliente ? "Você" : "Equipe Quadrum"));
  return (
    <div className={`flex items-end gap-2 ${doCliente ? "justify-end" : "justify-start"}`}>
      {!doCliente && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-q-onix text-xs font-semibold text-q-gold">
          {m.autor_tipo === "robo" ? <Bot className="h-4 w-4" /> : (m.autor?.[0]?.toUpperCase() ?? "Q")}
        </span>
      )}
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm ${doCliente ? "rounded-br-sm bg-[hsl(var(--q-gold)/0.18)]" : "rounded-bl-sm border border-border bg-card"}`}>
        <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
          {autor} <span className="font-normal">em {dataHoraBR(m.created_at)}</span>
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{m.corpo}</p>
      </div>
    </div>
  );
}

function Carregando() {
  return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
}
