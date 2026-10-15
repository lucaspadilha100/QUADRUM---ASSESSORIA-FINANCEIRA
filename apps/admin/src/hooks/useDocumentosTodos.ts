import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/lerTudo";

// Todas as pendências de assinatura que a pessoa enxerga (a RLS segue o
// contrato: gestor tudo, colaborador a carteira dele). Gravar continua pelo
// `useSalvarDocumento` da pipeline — um caminho só de escrita.

export interface DocumentoLista {
  id: string;
  contrato_id: string;
  tipo: string;
  link_assinatura: string | null;
  assinado_em: string | null;
  created_at: string;
  tipo_info: { nome: string } | null;
  contrato: { id: string; numero: number; cliente: { nome: string; documento: string } | null } | null;
}

export function useDocumentosTodos() {
  return useQuery({
    queryKey: ["documentos"],
    queryFn: () =>
      lerTudo<DocumentoLista>((de, ate) =>
        supabase.from("contrato_documentos")
          .select("id, contrato_id, tipo, link_assinatura, assinado_em, created_at, tipo_info:documento_tipos(nome), contrato:contratos(id, numero, cliente:clientes(nome, documento))")
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(de, ate) as unknown as PromiseLike<{ data: DocumentoLista[] | null; error: { message: string } | null }>,
      ),
  });
}
