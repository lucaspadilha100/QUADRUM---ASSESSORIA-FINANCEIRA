import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRpcPagina } from "@/hooks/usePagina";
import { mensagemDeErro, soDigitos } from "@/lib/formato";
import { invalidarCarteira } from "@/hooks/usePipeline";

// Clientes da carteira. Como na pipeline, NÃO filtra por consultor: a RLS já
// devolve só o que a pessoa vê (gestor todos, colaborador os seus). A LISTA
// vem uma página por vez do banco (`q_clientes_pagina`); a FICHA lê o cliente
// inteiro por id.

export interface ClienteLista {
  id: string;
  documento: string;
  tipo_pessoa: "PF" | "PJ";
  nome: string;
  email: string | null;
  telefone: string | null;
  consultor_id: string | null;
  user_id: string | null;
  created_at: string;
  consultor_nome: string | null;
  contratos_ativos: number;
  contratos_perdidos: number;
}

export interface ContagemClientes { todos: number; com: number; sem: number }

export function useClientesPagina(args: { busca: string; portal: string; consultor: string | null; pagina: number; por: number }) {
  return useRpcPagina<ClienteLista, ContagemClientes>(["clientes", "pagina"], "q_clientes_pagina", {
    p_busca: args.busca, p_portal: args.portal, p_consultor: args.consultor, p_pagina: args.pagina, p_por: args.por,
  });
}

export interface ContratoDoCliente {
  id: string;
  numero: number;
  etapa_id: string;
  data_aceite: string | null;
  cancelado_em: string | null;
}

/** Os dados que os MODELOS de documento usam (migração 20261017010000). */
export interface DadosDocumento {
  rg: string | null; rg_orgao: string | null; nacionalidade: string | null; estado_civil: string | null;
  profissao: string | null; data_nascimento: string | null;
  cep: string | null; logradouro: string | null; endereco_numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null;
  representante_nome: string | null; representante_documento: string | null;
}

export const CAMPOS_DOCUMENTO: (keyof DadosDocumento)[] = [
  "rg", "rg_orgao", "nacionalidade", "estado_civil", "profissao", "data_nascimento",
  "cep", "logradouro", "endereco_numero", "complemento", "bairro", "cidade", "uf",
  "representante_nome", "representante_documento",
];

export interface Cliente extends DadosDocumento {
  id: string;
  documento: string;
  tipo_pessoa: "PF" | "PJ";
  nome: string;
  email: string | null;
  telefone: string | null;
  consultor_id: string | null;
  user_id: string | null;
  observacoes: string | null;
  created_at: string;
  consultor: { id: string; nome: string } | null;
  contratos: ContratoDoCliente[];
}

// `perfis` tem duas FKs vindas de clientes (consultor e created_by): o embed
// precisa do nome da FK. Os contratos são os de UM cliente — lista curta.
const COLUNAS = `
  id, documento, tipo_pessoa, nome, email, telefone, consultor_id, user_id, observacoes, created_at,
  ${CAMPOS_DOCUMENTO.join(", ")},
  consultor:perfis!clientes_consultor_id_fkey(id, nome),
  contratos(id, numero, etapa_id, data_aceite, cancelado_em)
`;

export function useCliente(id: string | null) {
  return useQuery({
    queryKey: ["cliente", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select(COLUNAS).eq("id", id!).maybeSingle();
      if (error) throw new Error(mensagemDeErro(error));
      return data as unknown as Cliente | null;
    },
  });
}

/** Já existe cliente com este documento (dentro do que a pessoa vê)? */
export async function clientePorDocumento(documento: string) {
  const { data, error } = await supabase.from("clientes").select("id, nome").eq("documento", soDigitos(documento)).maybeSingle();
  if (error) throw new Error(mensagemDeErro(error));
  return data as { id: string; nome: string } | null;
}

const erro = (e: { code?: string; message: string; details?: string | null }) => new Error(mensagemDeErro(e));

export interface DadosCliente {
  nome: string;
  telefone: string;
  email: string;
  observacoes: string;
  consultorId?: string | null;   // só o gestor manda (a RLS recusaria o colaborador)
  dadosDocumento?: Partial<DadosDocumento>;
}

/** Os campos de documento como o banco grava: vazio vira nulo, UF maiúscula, CPF só dígitos. */
function camposDocumento(d?: Partial<DadosDocumento>) {
  if (!d) return {};
  const out: Record<string, string | null> = {};
  for (const k of CAMPOS_DOCUMENTO) {
    if (!(k in d)) continue;
    let v = (d[k] ?? "").toString().trim() || null;
    if (v && k === "uf") v = v.toUpperCase();
    if (v && k === "representante_documento") v = soDigitos(v) || null;
    out[k] = v;
  }
  return out;
}

const vazio = (s: string) => s.trim() || null;

export function useCriarCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: DadosCliente & { documento: string }) => {
      const { data, error } = await supabase.from("clientes").insert({
        documento: soDigitos(v.documento),
        nome: v.nome.trim(),
        telefone: vazio(v.telefone),
        email: vazio(v.email),
        observacoes: vazio(v.observacoes),
        ...camposDocumento(v.dadosDocumento),
        ...(v.consultorId !== undefined ? { consultor_id: v.consultorId } : {}),
      }).select("id").single();
      if (error) throw erro(error);
      return data.id as string;
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

export function useAtualizarCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...v }: DadosCliente & { id: string }) => {
      const { error } = await supabase.from("clientes").update({
        nome: v.nome.trim(),
        telefone: vazio(v.telefone),
        email: vazio(v.email),
        observacoes: vazio(v.observacoes),
        ...camposDocumento(v.dadosDocumento),
        ...(v.consultorId !== undefined ? { consultor_id: v.consultorId } : {}),
      }).eq("id", id);
      if (error) throw erro(error);
    },
    // O nome do cliente aparece nos cards, contratos e documentos.
    onSuccess: () => invalidarCarteira(qc),
  });
}
