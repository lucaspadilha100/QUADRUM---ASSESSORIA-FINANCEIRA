import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// UMA página por chamada. As listas grandes (clientes, contratos, documentos,
// atendimentos) não baixam a carteira inteira: a função `q_*_pagina` do banco
// devolve a página pedida e as contagens de cada filtro, sobre a MESMA busca
// (migração 20261017000000). A tela não filtra nem conta nada sozinha.
//
// `keepPreviousData`: trocar de página mostra a anterior até a nova chegar, em
// vez de piscar "Carregando…" a cada clique.
// ─────────────────────────────────────────────────────────────────────────────

export interface Pagina<T, C> {
  linhas: T[];
  contagem: C;
}

export function useRpcPagina<T, C>(
  chave: readonly unknown[],
  funcao: string,
  args: Record<string, unknown>,
  opts: { refetchInterval?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...chave, args],
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(funcao, args);
      // Falha SOBE: página que falha não pode virar "nenhum resultado".
      if (error) throw new Error(mensagemDeErro(error));
      return data as Pagina<T, C>;
    },
  });
}

/** O valor depois de `ms` sem mudar — a busca não dispara uma consulta por tecla. */
export function useAtrasado<T>(valor: T, ms = 300): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}
