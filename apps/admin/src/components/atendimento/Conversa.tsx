import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, Bot, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { confirmar } from "@/shell";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe } from "@/hooks/useCadastros";
import { useArquivarAtendimento, useMensagens, useResponder } from "@/hooks/usePipeline";
import { dataHoraBR } from "@/lib/formato";

// A conversa vista pela equipe: as falas do cliente à DIREITA, como no portal
// (o lado é de quem escreveu, não de quem lê, para os dois verem a mesma conversa).
/** O mínimo de um atendimento para abrir a conversa (serve à aba do card e à caixa). */
export interface AtendimentoAberto {
  id: string;
  numero: number;
  arquivado_em: string | null;
  setorNome: string | null;
  titulo?: string;
  clienteNome?: string | null;
}

export function Conversa({ atendimento, onVoltar, cheia = false }: {
  atendimento: AtendimentoAberto;
  /** Sem `onVoltar`, não há botão Voltar (na caixa, a lista está ao lado). */
  onVoltar?: () => void;
  /** Ocupa a altura do contêiner (caixa de atendimentos) em vez de 50% da tela. */
  cheia?: boolean;
}) {
  const { perfil } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const { data: msgs = [], isLoading } = useMensagens(atendimento.id);
  const responder = useResponder();
  const arquivar = useArquivarAtendimento();
  const [texto, setTexto] = useState("");
  const arquivado = !!atendimento.arquivado_em;
  const nomeEquipe = (id: string | null) => equipe.find((p) => p.id === id)?.nome.split(" ")[0] ?? "Equipe";
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs.length, atendimento.id]);

  const enviar = async () => {
    if (!texto.trim() || !perfil) return;
    try {
      await responder.mutateAsync({ atendimentoId: atendimento.id, corpo: texto, autorId: perfil.id });
      setTexto("");
    } catch (e) {
      toast.error("Não foi possível enviar.", { description: (e as Error).message });
    }
  };

  const fechar = async () => {
    if (!perfil) return;
    if (!(await confirmar({ titulo: "Arquivar o atendimento?", mensagem: "A conversa fica só para leitura, aqui e no portal. O cliente poderá abrir um novo atendimento.", confirmar: "Arquivar" }))) return;
    try {
      await arquivar.mutateAsync({ atendimentoId: atendimento.id, autorId: perfil.id });
      toast.success("Atendimento arquivado.");
      onVoltar?.();
    } catch (e) {
      toast.error("Não foi possível arquivar.", { description: (e as Error).message });
    }
  };

  return (
    <div className={`flex flex-col gap-3 ${cheia ? "h-full min-h-0" : "pt-2"}`}>
      <div className="flex items-center gap-2">
        {onVoltar && <Button type="button" variant="ghost" size="sm" onClick={onVoltar} aria-label="Voltar"><ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Voltar</span></Button>}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium sm:truncate">
            {atendimento.clienteNome ? `${atendimento.clienteNome} · ` : ""}#{atendimento.numero} · {atendimento.setorNome ?? "—"}
          </p>
          {atendimento.titulo && <p className="truncate text-xs text-muted-foreground">{atendimento.titulo}</p>}
        </div>
        {!arquivado && (
          <Button type="button" variant="outline" size="sm" onClick={fechar} disabled={arquivar.isPending}>
            <Archive className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Arquivar</span>
          </Button>
        )}
      </div>

      <div className={`space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 ${cheia ? "min-h-0 flex-1" : "max-h-[50dvh]"}`}>
        {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : msgs.map((m) => {
          const doCliente = m.autor_tipo === "cliente";
          return (
            <div key={m.id} className={`flex ${doCliente ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${doCliente ? "bg-[hsl(var(--q-gold)/0.15)]" : "border border-border bg-card"}`}>
                <p className="mb-0.5 flex flex-wrap items-center gap-x-1 text-[11px] font-semibold text-muted-foreground">
                  {m.autor_tipo === "robo" && <Bot className="h-3 w-3" />}
                  {doCliente ? "Cliente" : m.autor_tipo === "robo" ? "Assistente Quadrum" : nomeEquipe(m.autor_id)}
                  <span className="font-normal">em {dataHoraBR(m.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap text-foreground">{m.corpo}</p>
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      {arquivado ? (
        <p className="text-center text-xs text-muted-foreground">Atendimento arquivado — somente leitura.</p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            placeholder="Responder ao cliente" />
          <Button type="button" onClick={enviar} disabled={!texto.trim() || responder.isPending} aria-label="Enviar">
            {responder.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

