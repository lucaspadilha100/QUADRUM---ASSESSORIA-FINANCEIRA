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
  // `no_sistema`: assina AQUI no portal (documento gerado de modelo); senão, pelo link.
  pendencias: { id: string; tipo: string; nome: string; link: string | null; no_sistema: boolean }[];
  documentos: { id: string; nome: string; assinado_em: string; no_sistema: boolean }[];
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

// O cliente não escuta o banco (não tem policy em tabela nenhuma, então o
// Realtime não teria o que entregar): relê sozinho. Aba escondida não relê.
// Documento gerado pela equipe aparece em até 20 s, sem F5.
export const useContratos = () =>
  useQuery({ queryKey: ["portal", "contratos"], queryFn: () => rpc<ContratoPortal[]>("portal_contratos"), refetchInterval: 20_000 });

export const useAvisos = () =>
  useQuery({
    queryKey: ["portal", "avisos"],
    queryFn: () => rpc<{ chat_nao_lido: boolean }>("portal_avisos"),
    refetchInterval: 15_000,
  });

export const marcarHistoricoLido = () => rpc<void>("portal_marcar_historico_lido");

export const useSetores = () =>
  useQuery({ queryKey: ["portal", "setores"], queryFn: () => rpc<{ id: string; nome: string }[]>("portal_setores") });

// O chat ABERTO relê a cada 5 s (a resposta da equipe chega quase na hora); só
// roda com a conversa na tela — aba escondida ou outra página não consultam.
const CHAT_RELE = 5_000;
export const useChatAtivo = () =>
  useQuery({ queryKey: ["portal", "chat", "ativo"], queryFn: () => rpc<ChatPortal | null>("portal_chat_ativo"), refetchInterval: CHAT_RELE });

export const useChat = (id: string | undefined) =>
  useQuery({ queryKey: ["portal", "chat", id], enabled: !!id, queryFn: () => rpc<ChatPortal | null>("portal_chat", { p_atendimento: id }), refetchInterval: CHAT_RELE });

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

// ── Documento para ler e assinar (migração 20261017010000) ──────────────────

export interface AssinaturaPortal {
  nome: string; documento: string; nome_digitado: string; assinado_em: string;
  ip: string | null; user_agent: string | null; metodo: string; hash: string; codigo: string;
  aceite_texto: string; visualizado_em: string | null;
}

export interface DocumentoPortal {
  id: string;
  titulo: string;
  tipo: string;
  contrato_numero: number;
  no_sistema: boolean;
  link: string | null;
  conteudo: string | null;
  conteudo_hash: string | null;
  criado_em: string;
  cancelado: boolean;
  assinado_em: string | null;
  cliente_nome: string;
  pj: boolean;
  representante_nome: string | null;
  aceite_texto: string;
  assinatura: AssinaturaPortal | null;
}

// Abrir o documento fica REGISTRADO no banco (com IP e navegador): é parte da
// prova de que o cliente leu antes de assinar. Por isso não relê sozinho.
export const useDocumento = (id: string | undefined) =>
  useQuery({
    queryKey: ["portal", "documento", id],
    enabled: !!id,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => rpc<DocumentoPortal>("portal_documento", { p_documento: id }),
  });

export function useAssinarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; senha: string; nome: string; aceite: boolean }) =>
      rpc<{ ok: boolean; erro?: string; documento?: DocumentoPortal }>("portal_assinar_documento", {
        p_documento: v.id, p_senha: v.senha, p_nome: v.nome, p_aceite: v.aceite,
      }),
    onSuccess: (r, v) => {
      if (r.ok && r.documento) qc.setQueryData(["portal", "documento", v.id], r.documento);
      qc.invalidateQueries({ queryKey: ["portal", "contratos"] });
    },
  });
}

/** Rótulo do contrato no seletor do robô: "veículo ano (placa)", como no portal antigo. */
export const rotuloContrato = (c: ContratoPortal) =>
  [c.veiculo, c.ano_modelo, c.placa ? `(${c.placa})` : null].filter(Boolean).join(" ").trim() || `Contrato #${c.numero}`;

// ── Privacidade (LGPD): o termo em vigor e o aceite deste cliente ────────────
export interface TermoPrivacidade { id: string; versao: number; titulo: string; texto: string; aceito_em: string | null }

// Falha aqui NÃO trava o portal: sem resposta, não há aceite a pedir.
export const usePrivacidade = (clienteId?: string | null) =>
  useQuery({
    queryKey: ["portal", "privacidade", clienteId ?? "sessao"],
    enabled: clienteId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_privacidade");
      if (error) { console.error("[portal] privacidade:", error.message); return null; }
      return (data as TermoPrivacidade | null) ?? null;
    },
  });

export function useAceitarPrivacidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (termoId: string) => rpc<{ ok: boolean }>("portal_aceitar_privacidade", { p_termo: termoId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal", "privacidade"] }),
  });
}
