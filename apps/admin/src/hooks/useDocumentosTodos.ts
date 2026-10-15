import { useRpcPagina } from "@/hooks/usePagina";

// Todas as pendências de assinatura que a pessoa enxerga, uma página por vez
// (`q_documentos_pagina`). A RLS segue o contrato: gestor tudo, colaborador a
// carteira dele.

export interface DocumentoLista {
  id: string;
  contrato_id: string;
  tipo: string;
  tipo_nome: string;
  titulo: string;
  link_assinatura: string | null;
  assinado_em: string | null;
  cancelado_em: string | null;
  created_at: string;
  no_sistema: boolean;
  contrato_numero: number | null;
  contrato_aceite: string | null;
  cliente_nome: string | null;
  cliente_documento: string | null;
  situacao: "pendente" | "assinado" | "cancelado";
}

export interface ContagemDocumentos { todos: number; pendente: number; assinado: number; cancelado: number }

export function useDocumentosPagina(args: { busca: string; situacao: string; pagina: number; por: number }) {
  return useRpcPagina<DocumentoLista, ContagemDocumentos>(["documentos", "pagina"], "q_documentos_pagina", {
    p_busca: args.busca, p_situacao: args.situacao, p_pagina: args.pagina, p_por: args.por,
  });
}
