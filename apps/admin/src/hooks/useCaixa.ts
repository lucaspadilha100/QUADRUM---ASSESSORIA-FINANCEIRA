import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";
import { useRpcPagina } from "@/hooks/usePagina";

// A caixa de atendimentos: uma linha por conversa, com a última mensagem e as
// do CLIENTE sem leitura (view `atendimentos_caixa`). A página vem pronta do
// banco (`q_caixa_pagina`), com as contagens das abas; a view roda com as
// permissões de quem lê, então o colaborador só vê a carteira dele.

export interface ItemCaixa {
  id: string;
  numero: number;
  titulo: string;
  cliente_id: string;
  contrato_id: string | null;
  setor_id: string;
  responsavel_id: string | null;
  arquivado_em: string | null;
  created_at: string;
  cliente_nome: string;
  cliente_documento: string | null;
  contrato_numero: number | null;
  setor_nome: string | null;
  responsavel_nome: string | null;
  ultima_corpo: string | null;
  ultima_autor_tipo: "cliente" | "equipe" | "robo" | null;
  ultima_em: string | null;
  nao_lidas: number;
}

export interface ContagemCaixa { abertos: number; nao_lidas: number; arquivados: number }

export function useCaixaPagina(args: { busca: string; setor: string | null; aba: string; pagina: number; por: number }) {
  return useRpcPagina<ItemCaixa, ContagemCaixa>(["caixa", "pagina"], "q_caixa_pagina", {
    p_busca: args.busca, p_setor: args.setor, p_aba: args.aba, p_pagina: args.pagina, p_por: args.por,
  }, { refetchInterval: 15_000 });   // o cliente escreve pelo portal: relê no ritmo dele
}

/** O atendimento aberto, lido por id — pode não estar na página visível. */
export function useItemCaixa(id: string | null) {
  return useQuery({
    queryKey: ["caixa", "item", id],
    enabled: !!id,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("atendimentos_caixa").select("*").eq("id", id!).maybeSingle();
      if (error) throw new Error(mensagemDeErro(error));
      return data as ItemCaixa | null;
    },
  });
}

export function useDefinirResponsavel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, responsavelId }: { id: string; responsavelId: string | null }) => {
      const { error } = await supabase.from("atendimentos").update({ responsavel_id: responsavelId }).eq("id", id);
      if (error) throw new Error(mensagemDeErro(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["caixa"] }),
  });
}
