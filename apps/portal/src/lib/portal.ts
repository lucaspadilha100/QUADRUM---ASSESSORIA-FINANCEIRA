import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Tudo o que o portal lê e escreve passa pelas funções `portal_*` do banco
// (migração 20261015030000). O cliente NÃO lê tabela nenhuma: as funções
// descobrem quem ele é pela sessão e devolvem só o que é dele.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClienteSessao { id: string; nome: string; documento: string; tipo_pessoa: "PF" | "PJ" }

export interface ContratoPortal {
  id: string;
  numero: number;
  data_aceite: string;
  banco: string | null;
  linha: string | null;
  veiculo: string | null;
  ano_modelo: string | null;
  placa: string | null;
  consultor: string | null;
  unidade: string | null;
  cancelado: boolean;
  historico: { id: string; texto: string; autor: string | null; created_at: string }[];
  urgente_nao_lido: boolean;
  pendencias: { id: string; tipo: string; nome: string; link: string | null }[];
  atendimentos: { id: string; numero: number; titulo: string; arquivado: boolean }[];
}

export interface MensagemPortal {
  id: string;
  autor_tipo: "cliente" | "equipe" | "robo";
  autor: string | null;
  corpo: string;
  created_at: string;
}

export interface ChatPortal {
  id: string;
  numero: number;
  titulo: string;
  arquivado: boolean;
  setor: string | null;
  contrato_numero: number | null;
  mensagens: MensagemPortal[];
}

export const NOME_ROBO = "Assistente Quadrum";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  // Falha NÃO vira "vazio": lista vazia diz "você não tem contratos", e isto
  // é "não carregou".
  if (error) throw new Error(error.message);
  return data as T;
}

export const useContratos = () =>
  useQuery({ queryKey: ["portal", "contratos"], queryFn: () => rpc<ContratoPortal[]>("portal_contratos") });

export const useAvisos = () =>
  useQuery({
    queryKey: ["portal", "avisos"],
    queryFn: () => rpc<{ chat_nao_lido: boolean }>("portal_avisos"),
    refetchInterval: 15_000,
  });

export const marcarHistoricoLido = () => rpc<void>("portal_marcar_historico_lido");

export const useSetores = () =>
  useQuery({ queryKey: ["portal", "setores"], queryFn: () => rpc<{ id: string; nome: string }[]>("portal_setores") });

// O chat não tem tempo real: relê a cada 15 s, como o portal antigo.
export const useChatAtivo = () =>
  useQuery({ queryKey: ["portal", "chat", "ativo"], queryFn: () => rpc<ChatPortal | null>("portal_chat_ativo"), refetchInterval: 15_000 });

export const useChat = (id: string | undefined) =>
  useQuery({ queryKey: ["portal", "chat", id], enabled: !!id, queryFn: () => rpc<ChatPortal | null>("portal_chat", { p_atendimento: id }) });

export const marcarChatLido = (id: string) => rpc<void>("portal_marcar_chat_lido", { p_atendimento: id });

export function useAbrirAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { contratoId: string; setorId: string; descricao: string }) =>
      rpc<ChatPortal>("portal_abrir_atendimento", { p_contrato: v.contratoId, p_setor: v.setorId, p_descricao: v.descricao }),
    onSuccess: (chat) => {
      qc.setQueryData(["portal", "chat", "ativo"], chat);
      qc.invalidateQueries({ queryKey: ["portal", "contratos"] });
    },
  });
}

export function useEnviarMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { atendimentoId: string; corpo: string }) =>
      rpc<ChatPortal>("portal_enviar_mensagem", { p_atendimento: v.atendimentoId, p_corpo: v.corpo }),
    onSuccess: (chat) => qc.setQueryData(["portal", "chat", "ativo"], chat),
  });
}

/** Rótulo do contrato no seletor do robô: "veículo ano (placa)", como no portal antigo. */
export const rotuloContrato = (c: ContratoPortal) =>
  [c.veiculo, c.ano_modelo, c.placa ? `(${c.placa})` : null].filter(Boolean).join(" ").trim() || `Contrato #${c.numero}`;
