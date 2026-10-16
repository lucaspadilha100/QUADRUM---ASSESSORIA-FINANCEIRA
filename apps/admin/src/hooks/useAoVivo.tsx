import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// AO VIVO: o banco avisa o admin a cada mudança (Supabase Realtime) e as telas
// abertas se atualizam sozinhas — documento assinado no portal, mensagem do
// cliente, card movido por um colega, cliente editado, histórico lançado.
// Migração 20261018000000 (as tabelas entram na publicação `supabase_realtime`).
//
// ⚠️ O aviso NÃO carrega o dado: ele só diz QUAL consulta ficou velha, e a tela
// relê pelo caminho de sempre (RLS, página, contagem). Montar a tela a partir
// do evento seria a segunda verdade sobre o mesmo dado.
// ⚠️ O Realtime confere a RLS de quem escuta: o colaborador só é avisado do que
// é da carteira dele, pela MESMA regra das telas.
// ⚠️ Um canal POR TABELA: tabela fora da publicação derruba só o próprio canal.
// ⚠️ Realtime não reentrega o que passou (aba dormindo, rede caída): ao voltar
// a conectar, relê tudo; e a volta do foco à aba também relê (App.tsx).
// ─────────────────────────────────────────────────────────────────────────────

const TUDO: QueryKey[] = [
  ["pipeline"], ["contratos"], ["contrato"], ["clientes"], ["cliente"], ["painel"], ["documentos"], ["caixa"],
];

/** O que fica velho quando cada tabela muda. Invalidar consulta FECHADA só a
 *  marca; relê a que está na tela. Todo aviso do sininho nasce de uma mudança
 *  numa destas tabelas (gatilhos), então o sininho relê junto. */
const AFETA: Record<string, QueryKey[]> = {
  contratos: TUDO,
  clientes: TUDO,
  contrato_documentos: [["documentos"], ["painel"], ["contrato"], ["contratos"], ["pipeline"]],
  documento_assinaturas: [["documentos"], ["painel"], ["contrato"], ["contratos"], ["pipeline"]],
  documento_eventos: [["documentos"]],
  contrato_historico: [["pipeline", "historico"], ["painel"]],
  atendimentos: [["caixa"], ["painel"], ["pipeline", "atendimentos"], ["pipeline", "quadro"]],
  atendimento_mensagens: [["caixa"], ["painel"], ["pipeline", "mensagens"], ["pipeline", "atendimentos"]],
};

for (const k of Object.keys(AFETA)) AFETA[k] = [...AFETA[k], ["notificacoes"]];

export const TABELAS_AO_VIVO = Object.keys(AFETA);

type Linha = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" ? v : "");
const resumo = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function useAoVivo() {
  const qc = useQueryClient();
  const local = useLocation();
  // A rota atual, lida DENTRO do evento sem reabrir os canais a cada navegação.
  const ondeEstou = useRef(local);
  ondeEstou.current = local;

  useEffect(() => {
    // Um lote de mudanças (o gatilho grava 3 linhas numa assinatura) vira UMA
    // releitura de cada consulta.
    const pendentes = new Map<string, QueryKey>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidar = (chaves: QueryKey[]) => {
      for (const k of chaves) pendentes.set(JSON.stringify(k), k);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const lote = [...pendentes.values()];
        pendentes.clear();
        for (const queryKey of lote) qc.invalidateQueries({ queryKey });
      }, 250);
    };

    const avisar = (tabela: string, novo: Linha) => {
      if (tabela === "documento_assinaturas") {
        const doc = texto(novo.documento_id);
        toast.success("Documento assinado pelo cliente", {
          duration: 10_000,
          description: (
            <span>
              {texto(novo.signatario_nome)}
              {doc && <> · <Link to={`/documentos/${doc}`} className="q-link">ver documento</Link></>}
            </span>
          ),
        });
      }
      if (tabela === "atendimento_mensagens" && novo.autor_tipo === "cliente") {
        const at = texto(novo.atendimento_id);
        // Quem está COM a conversa aberta já a vê chegar: aviso seria ruído.
        const aqui = new URLSearchParams(ondeEstou.current.search).get("atendimento");
        if (ondeEstou.current.pathname === "/atendimentos" && aqui === at) return;
        toast.info("Nova mensagem do cliente", {
          duration: 10_000,
          description: (
            <span>
              “{resumo(texto(novo.corpo))}” · <Link to={`/atendimentos?atendimento=${at}`} className="q-link">abrir conversa</Link>
            </span>
          ),
        });
      }
    };

    const canais = TABELAS_AO_VIVO.map((tabela) => {
      let jaConectou = false;
      return supabase
        .channel(`ao-vivo:${tabela}`)
        .on("postgres_changes", { event: "*", schema: "public", table: tabela }, (p) => {
          invalidar(AFETA[tabela]);
          if (p.eventType === "INSERT") avisar(tabela, p.new as Linha);
        })
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            // Reconectou: o que mudou enquanto estava fora não vem de novo.
            if (jaConectou) invalidar(AFETA[tabela]);
            jaConectou = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Falha FALA no console: canal mudo parece "ninguém mexeu em nada".
            console.warn(`[ao vivo] ${tabela}: ${status}`, err?.message ?? "");
          }
        });
    });

    return () => {
      if (timer) clearTimeout(timer);
      for (const c of canais) supabase.removeChannel(c);
    };
  }, [qc]);
}
