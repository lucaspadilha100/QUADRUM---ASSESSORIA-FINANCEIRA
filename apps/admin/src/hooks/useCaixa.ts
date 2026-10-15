import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/lerTudo";
import { mensagemDeErro } from "@/lib/formato";

// A caixa de atendimentos: uma linha por conversa, com a última mensagem e as
// do CLIENTE sem leitura (view `atendimentos_caixa`, migração 20261016000000).
// A view roda com as permissões de quem lê: o colaborador só vê a carteira dele.

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
  cliente_documento: string;
  contrato_numero: number | null;
  setor_nome: string | null;
  responsavel_nome: string | null;
  ultima_corpo: string | null;
  ultima_autor_tipo: "cliente" | "equipe" | "robo" | null;
  ultima_em: string | null;
  nao_lidas: number;
}

export function useCaixa() {
  return useQuery({
    queryKey: ["caixa"],
    // O cliente escreve pelo portal: relê a cada 15 s, o ritmo do portal.
    refetchInterval: 15_000,
    queryFn: async () => {
      const linhas = await lerTudo<ItemCaixa>((de, ate) =>
        supabase.from("atendimentos_caixa").select("*")
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(de, ate) as unknown as PromiseLike<{ data: ItemCaixa[] | null; error: { message: string } | null }>,
      );
      // Mais recente primeiro pela ÚLTIMA mensagem (conversa viva sobe).
      const quando = (i: ItemCaixa) => i.ultima_em ?? i.created_at;
      return linhas.sort((a, b) => quando(b).localeCompare(quando(a)));
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
