import { supabase } from "@/integrations/supabase/client";

// O CARNÊ (Edge Function `carne-pdf`): os boletos em aberto do contrato num PDF
// só. ⚠️ Arquivo COPIADO entre admin e portal (mesmo conteúdo): a função serve
// aos dois, cada um pelo seu login.

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function gerarCarne(contratoId: string): Promise<File> {
  const { data } = await supabase.auth.getSession();
  let r: Response;
  try {
    r = await fetch(`${BASE}/functions/v1/carne-pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, apikey: ANON ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ contrato_id: contratoId }),
    });
  } catch {
    throw new Error("Não foi possível gerar o carnê agora. Tente de novo em instantes.");
  }
  if (!r.ok) {
    let msg: string | undefined;
    try { msg = (await r.json()).erro; } catch { /* sem corpo */ }
    throw new Error(msg ?? "Não foi possível gerar o carnê agora.");
  }
  const nome = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "carne.pdf";
  return new File([await r.blob()], nome, { type: "application/pdf" });
}

/** Baixa o arquivo (no celular, oferece compartilhar — direto para o WhatsApp). */
export async function entregarArquivo(arquivo: File, compartilhar = false) {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (compartilhar && nav.canShare?.({ files: [arquivo] })) {
    try { await nav.share({ files: [arquivo], title: arquivo.name }); return; }
    catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url; a.download = arquivo.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** O celular sabe compartilhar arquivo? (aí o botão vira "Compartilhar carnê") */
export const podeCompartilhar = () =>
  typeof navigator !== "undefined" && "canShare" in navigator && window.matchMedia?.("(pointer: coarse)").matches;
