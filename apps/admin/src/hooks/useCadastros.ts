import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mensagemDeErro } from "@/lib/formato";
import { supabase } from "@/integrations/supabase/client";

// Leituras dos cadastros de apoio. São listas curtas (dezenas de linhas), por
// isso sem paginação — se alguma passar de centenas, ela vai para `lerTudo`.
// Falha de consulta SOBE (throw): lista que falha não pode virar "vazia".

export interface Etapa { id: string; nome: string; ordem: number; cor: string; aceita: boolean; ativo: boolean }
export interface Banco { id: string; nome: string; codigo: string | null; ativo: boolean }
export interface LinhaCredito { id: string; nome: string; tem_veiculo: boolean; ativo: boolean }
export interface Departamento { id: string; nome: string; atende_chat: boolean; urgente: boolean; ativo: boolean; ordem: number }
export interface PessoaEquipe { id: string; nome: string; avatar_url: string | null; papel: "gestor" | "colaborador"; ativo: boolean }

function lista<T>(chave: string, tabela: string, colunas: string, ordem: { col: string; asc?: boolean }[]) {
  return {
    queryKey: ["cadastro", chave],
    queryFn: async (): Promise<T[]> => {
      let q = supabase.from(tabela).select(colunas);
      for (const o of ordem) q = q.order(o.col, { ascending: o.asc ?? true });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as T[];
    },
    staleTime: 5 * 60_000,
  };
}

export const useEtapas = () =>
  useQuery(lista<Etapa>("etapas", "pipeline_etapas", "id, nome, ordem, cor, aceita, ativo", [{ col: "ordem" }, { col: "nome" }]));

export const useBancos = () =>
  useQuery(lista<Banco>("bancos", "bancos", "id, nome, codigo, ativo", [{ col: "nome" }]));

export const useLinhasCredito = () =>
  useQuery(lista<LinhaCredito>("linhas", "linhas_credito", "id, nome, tem_veiculo, ativo", [{ col: "nome" }]));

export const useDepartamentos = () =>
  useQuery(lista<Departamento>("departamentos", "departamentos", "id, nome, atende_chat, urgente, ativo, ordem", [{ col: "ordem" }, { col: "nome" }]));

export const useEquipe = () =>
  useQuery(lista<PessoaEquipe>("equipe", "perfis", "id, nome, avatar_url, papel, ativo", [{ col: "nome" }]));

export interface DocumentoTipo { codigo: string; nome: string; ativo: boolean }
export const useDocumentoTipos = () =>
  useQuery(lista<DocumentoTipo>("documento_tipos", "documento_tipos", "codigo, nome, ativo", [{ col: "ordem" }, { col: "nome" }]));

// ── Gravação de departamentos (gestor; a RLS recusa o colaborador) ──────────

export function useSalvarDepartamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id?: string; campos: Partial<Omit<Departamento, "id">> & { ordem?: number } }) => {
      const { error } = id
        ? await supabase.from("departamentos").update(campos).eq("id", id)
        : await supabase.from("departamentos").insert(campos);
      if (error) throw new Error(mensagemDeErro(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cadastro", "departamentos"] }),
  });
}
