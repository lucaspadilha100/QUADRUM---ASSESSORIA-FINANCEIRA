import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";
import { invalidarCarteira } from "@/hooks/usePipeline";

// O que o CONTRATO definitivo pede além do card: titular do financiamento,
// veículo, financiamento e o plano escolhido (migração 20261027000000).
// Lido por id, à parte da lista: a pipeline não precisa disso.

export interface DadosContratoDocumento {
  titular_outro: boolean;
  titular_nome: string | null; titular_documento: string | null; titular_rg: string | null;
  titular_nascimento: string | null; titular_sexo: string | null; titular_endereco: string | null;
  renavam: string | null; chassi: string | null; veiculo_no_endereco: boolean | null;
  saldo_devedor: number | null; valor_parcela: number | null; parcela_balao: number | null;
  qtd_parcelas: number | null; parcelas_pagas: number | null; parcelas_atrasadas: number | null;
  ultima_parcela_paga: string | null;
  plano_valor_total: number | null; plano_entrada: number | null; plano_parcelas: number | null;
  plano_valor_parcela: number | null; plano_primeiro_vencimento: string | null; plano_forma: string | null;
  plano_dia_vencimento?: number | null;
  unidade_id: string | null;
}

/**
 * A linha inteira (`*`): coluna que uma migração acrescenta aparece sozinha, e a
 * leitura não quebra antes de a migração rodar. ⚠️ Falha SOBE: um formulário
 * aberto com tudo vazio gravaria vazio por cima do que está no banco.
 */
export function useContratoDocumento(id: string | null) {
  return useQuery({
    queryKey: ["contrato", id, "documento"],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("*").eq("id", id!).maybeSingle();
      if (error) throw new Error(mensagemDeErro(error));
      return data as unknown as DadosContratoDocumento | null;
    },
  });
}

export interface Empresa { nome: string | null; cnpj: string | null; endereco: string | null; telefones: string | null; email: string | null }

export function useEmpresa() {
  return useQuery({
    queryKey: ["empresa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresa").select("nome, cnpj, endereco, telefones, email").maybeSingle();
      if (error) return null;
      return data as Empresa | null;
    },
  });
}

export function useSalvarEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Empresa) => {
      const { data, error } = await supabase.from("empresa").update(v).eq("id", true).select("nome");
      if (error) throw new Error(mensagemDeErro(error));
      if (!data?.length) throw new Error("Só um gestor altera os dados da empresa.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["empresa"] }); invalidarCarteira(qc); },
  });
}

/** "1.295,50" → 1295.5; vazio → null. */
export function lerMoeda(s: string): number | null {
  const t = s.replace(/[R$\s.]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
export const mostrarMoeda = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
