import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";
import { invalidarCarteira } from "@/hooks/usePipeline";

// ─────────────────────────────────────────────────────────────────────────────
// Modelos de documento e o documento gerado (migração 20261017010000).
//
// Quem PREENCHE o modelo é o banco (`q_documento_gerar`), com os dados
// gravados — a tela só escolhe contrato e modelo. A prévia usa a MESMA função
// de montagem (`q_documento_previa`), então o que se vê aqui é o que vai.
// ─────────────────────────────────────────────────────────────────────────────

export interface Modelo {
  id: string;
  tipo: string;
  nome: string;
  corpo: string;
  versao: number;
  ativo: boolean;
  updated_at: string;
}

export const useModelos = () =>
  useQuery({
    queryKey: ["cadastro", "modelos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documento_modelos")
        .select("id, tipo, nome, corpo, versao, ativo, updated_at").order("nome").order("id");
      if (error) throw new Error(mensagemDeErro(error));
      return (data ?? []) as Modelo[];
    },
  });

export function useSalvarModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id?: string; campos: Partial<Omit<Modelo, "id" | "versao" | "updated_at">> }) => {
      const r = id
        ? await supabase.from("documento_modelos").update(campos).eq("id", id).select("id").single()
        : await supabase.from("documento_modelos").insert(campos).select("id").single();
      if (r.error) throw new Error(mensagemDeErro(r.error));
      return r.data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cadastro", "modelos"] }),
  });
}

export interface CampoCatalogo { chave: string; rotulo: string; grupo: string }

export const useCatalogo = () =>
  useQuery({
    queryKey: ["cadastro", "catalogo"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_documento_catalogo");
      if (error) throw new Error(mensagemDeErro(error));
      return (data ?? []) as CampoCatalogo[];
    },
  });

export interface Previa {
  texto: string;
  faltando: { chave: string; rotulo: string | null }[];
  desconhecidas: string[];
}

export function usePrevia(corpo: string | null, contratoId: string | null) {
  return useQuery({
    queryKey: ["documentos", "previa", corpo, contratoId],
    enabled: corpo != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_documento_previa", { p_corpo: corpo, p_contrato: contratoId });
      if (error) throw new Error(mensagemDeErro(error));
      return data as Previa;
    },
  });
}

export function useGerarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, modeloId }: { contratoId: string; modeloId: string }) => {
      const { data, error } = await supabase.rpc("q_documento_gerar", { p_contrato: contratoId, p_modelo: modeloId });
      if (error) throw new Error(mensagemDeErro(error));
      return data as string;
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

// ── O documento inteiro, com a prova da assinatura e a trilha de eventos ─────

export interface DocumentoCompleto {
  id: string;
  contrato_id: string;
  tipo: string;
  titulo: string | null;
  conteudo: string | null;
  conteudo_hash: string | null;
  link_assinatura: string | null;
  assinado_em: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  modelo_versao: number | null;
  created_at: string;
  tipo_info: { nome: string } | null;
  contrato: { numero: number; cliente: { nome: string; documento: string | null } | null } | null;
}

export interface Assinatura {
  signatario_nome: string;
  signatario_documento: string;
  nome_digitado: string;
  metodo: string;
  aceite_texto: string;
  hash_sha256: string;
  codigo_verificacao: string;
  ip: string | null;
  user_agent: string | null;
  visualizado_em: string | null;
  assinado_em: string;
}

export interface EventoDocumento {
  id: string;
  tipo: string;
  ator_tipo: string;
  ip: string | null;
  user_agent: string | null;
  detalhes: Record<string, unknown> | null;
  created_at: string;
}

export function useDocumentoCompleto(id: string | null) {
  return useQuery({
    queryKey: ["documentos", "um", id],
    enabled: !!id,
    queryFn: async () => {
      const [d, a, e] = await Promise.all([
        supabase.from("contrato_documentos")
          .select("id, contrato_id, tipo, titulo, conteudo, conteudo_hash, link_assinatura, assinado_em, cancelado_em, motivo_cancelamento, modelo_versao, created_at, tipo_info:documento_tipos(nome), contrato:contratos(numero, cliente:clientes(nome, documento))")
          .eq("id", id!).maybeSingle(),
        supabase.from("documento_assinaturas")
          .select("signatario_nome, signatario_documento, nome_digitado, metodo, aceite_texto, hash_sha256, codigo_verificacao, ip, user_agent, visualizado_em, assinado_em")
          .eq("documento_id", id!).maybeSingle(),
        supabase.from("documento_eventos")
          .select("id, tipo, ator_tipo, ip, user_agent, detalhes, created_at")
          .eq("documento_id", id!).order("created_at").order("id").limit(500),
      ]);
      for (const r of [d, a, e]) if (r.error) throw new Error(mensagemDeErro(r.error));
      return {
        documento: d.data as unknown as DocumentoCompleto | null,
        assinatura: a.data as Assinatura | null,
        eventos: (e.data ?? []) as unknown as EventoDocumento[],
      };
    },
  });
}
