import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";

// A equipe (public.perfis). Criar e redefinir senha passam por funções do banco
// que só o GESTOR executa (migração 20261016000000); o resto é update direto,
// e o banco segura o que importa: ninguém muda o próprio nível, e sempre sobra
// um gestor ativo.

export interface Usuario {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cargo: string | null;
  papel: "admin" | "gestor" | "colaborador";
  ativo: boolean;
  created_at: string;
  avatar_url?: string | null;
  departamento_id?: string | null;
}

export function useUsuarios() {
  return useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("perfis")
        .select("*")
        .order("ativo", { ascending: false }).order("nome", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Usuario[];
    },
  });
}

/** Quem ainda está com a senha que recebeu (equipe e clientes que eu vejo). */
export function useSenhasProvisorias() {
  return useQuery({
    queryKey: ["senhas-provisorias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("senha_provisoria").select("user_id");
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r) => r.user_id as string));
    },
  });
}

const erro = (e: { code?: string; message: string; details?: string | null }) => new Error(mensagemDeErro(e));

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["usuarios"] });
  qc.invalidateQueries({ queryKey: ["senhas-provisorias"] });
  qc.invalidateQueries({ queryKey: ["cadastro", "equipe"] });
}

export function useCriarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { email: string; nome: string; papel: Usuario["papel"]; cargo: string; senha: string }) => {
      const { error } = await supabase.rpc("q_equipe_criar_usuario", {
        p_email: v.email, p_nome: v.nome, p_papel: v.papel, p_senha: v.senha, p_cargo: v.cargo || null,
      });
      if (error) throw erro(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useAtualizarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Pick<Usuario, "nome" | "telefone" | "cargo" | "papel" | "ativo" | "departamento_id">> }) => {
      const { error } = await supabase.from("perfis").update(campos).eq("id", id);
      if (error) throw erro(error);
    },
    onSuccess: () => invalidar(qc),
  });
}

export function useRedefinirSenhaUsuario() {
  return useMutation({
    mutationFn: async ({ id, senha }: { id: string; senha: string }) => {
      const { error } = await supabase.rpc("q_equipe_definir_senha", { p_perfil: id, p_senha: senha });
      if (error) throw erro(error);
    },
  });
}
