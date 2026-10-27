import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, CircleDollarSign, FilePen, FileSignature, FileText, MessageSquare, AlertTriangle, History } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// O sininho: os avisos de quem está logado (q_minhas_notificacoes — o banco
// cria, cada um lê só os seus). ⚠️ Arquivo COPIADO, idêntico, em apps/admin e
// apps/portal: o `link` gravado pelo banco já é o caminho do app de quem recebe.

interface Notificacao { id: string; tipo: string; titulo: string; corpo: string | null; link: string | null; lida_em: string | null; created_at: string }
interface Caixa { nao_lidas: number; itens: Notificacao[] }

const ICONE: Record<string, typeof Bell> = {
  documento_assinado: FileSignature, documento_novo: FilePen, contrato_aceito: FileText,
  historico: History, historico_urgente: AlertTriangle, mensagem_cliente: MessageSquare, mensagem_equipe: MessageSquare,
  pagamento_confirmado: CircleDollarSign,
};

function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d < 7 ? `há ${d} d` : new Date(iso).toLocaleDateString("pt-BR");
}

export function Notificacoes({ releCada = 60_000, className }: { releCada?: number; className?: string }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const { data } = useQuery({
    queryKey: ["notificacoes"],
    refetchInterval: releCada,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_minhas_notificacoes", { p_limite: 30 });
      if (error) throw new Error(error.message);
      return data as Caixa;
    },
  });
  const marcar = useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc("q_marcar_notificacoes_lidas", { p_ids: ids });
      if (error) throw new Error(error.message);
    },
    onMutate: (ids) => {
      qc.setQueryData<Caixa>(["notificacoes"], (c) => c && {
        nao_lidas: ids ? Math.max(0, c.nao_lidas - c.itens.filter((i) => !i.lida_em && ids.includes(i.id)).length) : 0,
        itens: c.itens.map((i) => (!ids || ids.includes(i.id)) && !i.lida_em ? { ...i, lida_em: new Date().toISOString() } : i),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notificacoes"] }),
  });

  const n = data?.nao_lidas ?? 0;
  const itens = data?.itens ?? [];
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={n ? `Notificações (${n} não lidas)` : "Notificações"}
          className={cn("relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}>
          <Bell className="h-[18px] w-[18px]" />
          {n > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-q-gold px-1 text-[10px] font-bold leading-none text-q-onix">
              {n > 99 ? "99+" : n}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notificações</p>
          {n > 0 && (
            <button type="button" onClick={() => marcar.mutate(null)} className="-my-2 inline-flex items-center gap-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
            </button>
          )}
        </div>
        {itens.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
        ) : (
          <ul className="max-h-[min(70vh,440px)] divide-y divide-border overflow-y-auto">
            {itens.map((i) => {
              const Icone = ICONE[i.tipo] ?? Bell;
              const conteudo = (
                <>
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    i.tipo === "historico_urgente" ? "bg-warning/15 text-warning" : "bg-q-gold/15 text-q-gold")}>
                    <Icone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", i.lida_em ? "text-muted-foreground" : "font-semibold text-foreground")}>{i.titulo}</span>
                    {i.corpo && <span className="line-clamp-2 block text-xs text-muted-foreground">{i.corpo}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{quando(i.created_at)}</span>
                  </span>
                  {!i.lida_em && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-q-gold" aria-label="Não lida" />}
                </>
              );
              const cls = "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-accent";
              const abrir = () => { if (!i.lida_em) marcar.mutate([i.id]); setAberto(false); };
              return (
                <li key={i.id}>
                  {i.link ? <Link to={i.link} onClick={abrir} className={cls}>{conteudo}</Link>
                    : <button type="button" onClick={abrir} className={cls}>{conteudo}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
