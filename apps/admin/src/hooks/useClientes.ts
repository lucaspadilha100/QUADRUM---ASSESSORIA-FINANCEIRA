import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/lerTudo";
import { mensagemDeErro, soDigitos } from "@/lib/formato";

// Clientes da carteira. Como na pipeline, NÃO filtra por consultor: a RLS já
// devolve só o que a pessoa vê (gestor todos, colaborador os seus).

export interface ContratoDoCliente {
  id: string;
  numero: number;
  etapa_id: string;
  data_aceite: string | null;
  cancelado_em: string | null;
}

export interface Cliente {
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
// precisa do nome da FK.
const COLUNAS = `
  id, documento, tipo_pessoa, nome, email, telefone, consultor_id, user_id, observacoes, created_at,
  consultor:perfis!clientes_consultor_id_fkey(id, nome),
  contratos(id, numero, etapa_id, data_aceite, cancelado_em)
`;

export function useClientes() {
  return useQuery({
    queryKey: ["clientes"],
    queryFn: () =>
      lerTudo<Cliente>((de, ate) =>
        supabase.from("clientes").select(COLUNAS)
          .order("nome", { ascending: true }).order("id", { ascending: true })
          .range(de, ate) as unknown as PromiseLike<{ data: Cliente[] | null; error: { message: string } | null }>,
      ),
  });
}

const erro = (e: { code?: string; message: string; details?: string | null }) => new Error(mensagemDeErro(e));

export interface DadosCliente {
  nome: string;
  telefone: string;
  email: string;
  observacoes: string;
  consultorId?: string | null;   // só o gestor manda (a RLS recusaria o colaborador)
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
        ...(v.consultorId !== undefined ? { consultor_id: v.consultorId } : {}),
      }).select("id").single();
      if (error) throw erro(error);
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clientes"] }),
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
        ...(v.consultorId !== undefined ? { consultor_id: v.consultorId } : {}),
      }).eq("id", id);
      if (error) throw erro(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      // O nome do cliente aparece nos cards da pipeline.
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}
