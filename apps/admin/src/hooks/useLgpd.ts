import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";

// LGPD (migração 20261020000000): o termo de privacidade, versionado, e a
// exportação dos dados de um cliente. Publicar e exportar são só do gestor —
// quem recusa é o banco.

export interface Termo { id: string; versao: number; titulo: string; texto: string; ativo: boolean; publicado_em: string | null; created_at: string }

export function useTermos() {
  return useQuery({
    queryKey: ["lgpd", "termos"],
    queryFn: async () => {
      const [t, a] = await Promise.all([
        supabase.from("privacidade_termos").select("id, versao, titulo, texto, ativo, publicado_em, created_at").order("versao", { ascending: false }),
        supabase.from("privacidade_aceites").select("termo_id"),
      ]);
      if (t.error) throw new Error(mensagemDeErro(t.error));
      const aceites: Record<string, number> = {};
      for (const r of (a.data ?? []) as { termo_id: string }[]) aceites[r.termo_id] = (aceites[r.termo_id] ?? 0) + 1;
      return { termos: (t.data ?? []) as Termo[], aceites };
    },
  });
}

export function useCriarTermo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { titulo: string; texto: string }) => {
      const { data, error } = await supabase.from("privacidade_termos").insert(v).select("id").single();
      if (error) throw new Error(mensagemDeErro(error));
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lgpd"] }),
  });
}

export function usePublicarTermo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string | null) => {
      const { error } = id ? await supabase.rpc("q_privacidade_publicar", { p_termo: id }) : await supabase.rpc("q_privacidade_desativar");
      if (error) throw new Error(mensagemDeErro(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lgpd"] }),
  });
}

/** O aceite do termo EM VIGOR por este cliente (nulo = não aceitou ou não há termo). */
export function useAceiteDoCliente(clienteId: string) {
  return useQuery({
    queryKey: ["lgpd", "aceite", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("privacidade_aceites")
        .select("aceito_em, termo:privacidade_termos!inner(versao, ativo)")
        .eq("cliente_id", clienteId).order("aceito_em", { ascending: false }).limit(1).maybeSingle();
      if (error) return null;
      return data as unknown as { aceito_em: string; termo: { versao: number; ativo: boolean } } | null;
    },
  });
}

export async function exportarCliente(clienteId: string, documento: string) {
  const { data, error } = await supabase.rpc("q_cliente_exportar", { p_cliente: clienteId });
  if (error) throw new Error(mensagemDeErro(error));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dados-cliente-${documento}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
