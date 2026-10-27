import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/formato";
import { comprimirAnexo } from "@/lib/comprimirImagem";

// Os anexos do cliente e do contrato (migração 20261101000000): a foto/PDF do
// RG, do CRLV, do contrato do banco… Bucket PRIVADO `anexos`, pasta
// `cliente/<id>/` ou `contrato/<id>/`. Nada se apaga: remover = desativar.

export interface AnexoTipo { codigo: string; nome: string; de: "cliente" | "contrato"; secao: string; ordem: number; ativo: boolean }
export interface Anexo { id: string; cliente_id: string; contrato_id: string | null; tipo: string; path: string; nome: string | null; mime: string | null; tamanho: number | null; created_by: string | null; created_at: string }

export const useAnexoTipos = () =>
  useQuery({
    queryKey: ["cadastro", "anexo_tipos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("anexo_tipos").select("*").eq("ativo", true).order("ordem");
      if (error) throw new Error(mensagemDeErro(error));
      return (data ?? []) as AnexoTipo[];
    },
  });

/** Os anexos em vigor do cliente (os dele) ou do contrato (os do contrato). */
export function useAnexos(alvo: { clienteId?: string; contratoId?: string }) {
  const chave = alvo.contratoId ? ["contrato", alvo.contratoId, "anexos"] : ["cliente", alvo.clienteId, "anexos"];
  return useQuery({
    queryKey: chave,
    enabled: !!(alvo.clienteId || alvo.contratoId),
    queryFn: async () => {
      let q = supabase.from("anexos").select("*").is("desativado_em", null).order("created_at");
      q = alvo.contratoId ? q.eq("contrato_id", alvo.contratoId) : q.eq("cliente_id", alvo.clienteId!).is("contrato_id", null);
      const { data, error } = await q;
      if (error) throw new Error(mensagemDeErro(error));
      return (data ?? []) as Anexo[];
    },
  });
}

/** Reduz a foto, sobe para a pasta certa e devolve o caminho no bucket. */
export async function subirAnexo(pasta: string, arquivo: File) {
  const blob = await comprimirAnexo(arquivo);
  const ext = blob.type === "application/pdf" ? "pdf" : blob.type === "image/webp" ? "webp" : "jpg";
  const caminho = `${pasta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("anexos").upload(caminho, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error(error.message);
  return { caminho, mime: blob.type, tamanho: blob.size };
}

export function useEnviarAnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { tipo: AnexoTipo; clienteId?: string; contratoId?: string; arquivo: File }) => {
      const pasta = v.tipo.de === "contrato" ? `contrato/${v.contratoId}` : `cliente/${v.clienteId}`;
      const { caminho, mime, tamanho } = await subirAnexo(pasta, v.arquivo);
      const { error } = await supabase.rpc("q_anexo_registrar", {
        p_tipo: v.tipo.codigo, p_cliente: v.clienteId ?? null, p_contrato: v.contratoId ?? null,
        p_path: caminho, p_nome: v.arquivo.name, p_mime: mime, p_tamanho: tamanho,
      });
      if (error) throw new Error(mensagemDeErro(error));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contrato"] }); qc.invalidateQueries({ queryKey: ["cliente"] }); },
  });
}

export function useDesativarAnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("q_anexo_desativar", { p_id: id });
      if (error) throw new Error(mensagemDeErro(error));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contrato"] }); qc.invalidateQueries({ queryKey: ["cliente"] }); },
  });
}

/** Abre um arquivo de bucket privado (link de 5 min), numa aba aberta NO CLIQUE. */
export async function abrirArquivo(bucket: "anexos" | "comprovantes", caminho: string) {
  const aba = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 300);
  if (error || !data) { aba?.close(); throw new Error(error?.message ?? "Arquivo indisponível."); }
  if (aba) aba.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}
