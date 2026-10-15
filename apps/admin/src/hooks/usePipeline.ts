import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro, soDigitos } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// A pipeline: o CARD É O CONTRATO (supabase/migrations/20261015020000).
//
// ⚠️ Não filtra por consultor aqui: a RLS já devolve só o que a pessoa pode
// ver (gestor tudo, colaborador a própria carteira). Filtrar de novo na tela
// seria a segunda regra, e as duas iam divergir.
//
// ⚠️ `cliente` pode vir NULO mesmo com o contrato visível: o colaborador que é
// consultor de um contrato cujo CLIENTE é de outra carteira vê o contrato e
// não vê o cliente. A tela mostra isso, não quebra.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContratoPipeline {
  id: string;
  numero: number;
  etapa_id: string;
  etapa_desde: string;
  data_aceite: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  veiculo: string | null;
  ano_modelo: string | null;
  placa: string | null;
  observacoes: string | null;
  consultor_id: string | null;
  banco_id: string | null;
  linha_credito_id: string | null;
  updated_at: string;
  cliente: { id: string; nome: string; documento: string; telefone: string | null; email: string | null; user_id: string | null } | null;
  banco: { id: string; nome: string } | null;
  linha: { id: string; nome: string; tem_veiculo: boolean } | null;
  consultor: { id: string; nome: string; avatar_url: string | null } | null;
}

// A linha da view `contratos_lista` (migração 20261017000000): o contrato com
// os nomes que a tela mostra, já juntados no banco.
export interface LinhaContrato {
  id: string; numero: number; cliente_id: string; etapa_id: string; etapa_desde: string;
  data_aceite: string | null; cancelado_em: string | null; motivo_cancelamento: string | null;
  veiculo: string | null; ano_modelo: string | null; placa: string | null; observacoes: string | null;
  consultor_id: string | null; banco_id: string | null; linha_credito_id: string | null; updated_at: string;
  cliente_nome: string | null; cliente_documento: string | null; cliente_telefone: string | null;
  cliente_email: string | null; cliente_user_id: string | null;
  banco_nome: string | null; linha_nome: string | null; linha_tem_veiculo: boolean | null;
  consultor_nome: string | null; consultor_avatar: string | null;
  etapa_nome: string | null; etapa_cor: string | null;
  situacao: "andamento" | "portal" | "perdido";
}

/** Da linha plana da view para o formato que os componentes usam. */
export function paraContrato(l: LinhaContrato): ContratoPipeline {
  return {
    id: l.id, numero: l.numero, etapa_id: l.etapa_id, etapa_desde: l.etapa_desde,
    data_aceite: l.data_aceite, cancelado_em: l.cancelado_em, motivo_cancelamento: l.motivo_cancelamento,
    veiculo: l.veiculo, ano_modelo: l.ano_modelo, placa: l.placa, observacoes: l.observacoes,
    consultor_id: l.consultor_id, banco_id: l.banco_id, linha_credito_id: l.linha_credito_id, updated_at: l.updated_at,
    // Cliente de OUTRA carteira vem sem nome: a tela diz isso, não esconde.
    cliente: l.cliente_nome == null ? null : {
      id: l.cliente_id, nome: l.cliente_nome, documento: l.cliente_documento ?? "",
      telefone: l.cliente_telefone, email: l.cliente_email, user_id: l.cliente_user_id,
    },
    banco: l.banco_id && l.banco_nome ? { id: l.banco_id, nome: l.banco_nome } : null,
    linha: l.linha_credito_id && l.linha_nome ? { id: l.linha_credito_id, nome: l.linha_nome, tem_veiculo: !!l.linha_tem_veiculo } : null,
    consultor: l.consultor_id && l.consultor_nome ? { id: l.consultor_id, nome: l.consultor_nome, avatar_url: l.consultor_avatar } : null,
  };
}

/** Tudo o que mostra a carteira relê depois de uma gravação. */
export function invalidarCarteira(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["pipeline", "contratos", "contrato", "clientes", "cliente", "painel", "documentos"]) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}

// ── O quadro: as primeiras N de cada coluna + o total (q_pipeline) ───────────

export interface ColunaQuadro { etapa_id: string; total: number; cards: ContratoPipeline[] }
export interface Quadro { perdidos: number; colunas: ColunaQuadro[] }

export const POR_COLUNA = 30;

export function usePipelineQuadro(busca: string, perdidos: boolean, limites: Record<string, number>) {
  return useQuery({
    queryKey: ["pipeline", "quadro", busca, perdidos, limites],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Quadro> => {
      const { data, error } = await supabase.rpc("q_pipeline", {
        p_busca: busca, p_perdidos: perdidos, p_padrao: POR_COLUNA, p_limites: limites,
      });
      if (error) throw new Error(mensagemDeErro(error));
      const q = data as { perdidos: number; colunas: { etapa_id: string; total: number; cards: LinhaContrato[] }[] };
      return { perdidos: q.perdidos, colunas: q.colunas.map((c) => ({ ...c, cards: c.cards.map(paraContrato) })) };
    },
  });
}

/** Um contrato só — o painel aberto lê daqui, não da lista (que é uma página). */
export function useContrato(id: string | null) {
  return useQuery({
    queryKey: ["contrato", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos_lista").select("*").eq("id", id!).maybeSingle();
      if (error) throw new Error(mensagemDeErro(error));
      return data ? paraContrato(data as LinhaContrato) : null;
    },
  });
}

function erro(e: { code?: string; message: string; details?: string | null } | null) {
  return new Error(mensagemDeErro(e));
}

/** Arrastar o card: troca a etapa, com a tela mudando NO CLIQUE. */
export function useMoverContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, etapaId }: { id: string; etapaId: string }) => {
      const { error } = await supabase.from("contratos").update({ etapa_id: etapaId }).eq("id", id);
      if (error) throw erro(error);
    },
    onMutate: async ({ id, etapaId }) => {
      await qc.cancelQueries({ queryKey: ["pipeline", "quadro"] });
      const antes = qc.getQueriesData<Quadro>({ queryKey: ["pipeline", "quadro"] });
      qc.setQueriesData<Quadro>({ queryKey: ["pipeline", "quadro"] }, (q) => {
        if (!q) return q;
        const card = q.colunas.flatMap((c) => c.cards).find((c) => c.id === id);
        if (!card) return q;
        const movido = { ...card, etapa_id: etapaId, etapa_desde: new Date().toISOString() };
        return {
          ...q,
          colunas: q.colunas.map((c) =>
            c.etapa_id === card.etapa_id
              ? { ...c, total: c.total - 1, cards: c.cards.filter((x) => x.id !== id) }
              : c.etapa_id === etapaId
                ? { ...c, total: c.total + 1, cards: [...c.cards, movido] }
                : c),
        };
      });
      return { antes };
    },
    // Errou no banco ⇒ DESFAZ. Otimista que falha calado é a tela dizendo
    // uma coisa e o banco outra.
    onError: (_e, _v, ctx) => { ctx?.antes.forEach(([k, v]) => qc.setQueryData(k, v)); },
    // Relê: o gatilho pode ter gravado `data_aceite` (etapa aceita).
    onSettled: () => invalidarCarteira(qc),
  });
}

export interface NovoCard {
  clienteId: string | null;          // já existe? então só o contrato
  documento: string;
  nome: string;
  telefone: string;
  email: string;
  etapaId: string;
  bancoId: string | null;
  linhaId: string | null;
  veiculo: string;
  anoModelo: string;
  placa: string;
  consultorId: string | null;
}

/** Procura o cliente pelo documento — dentro do que a pessoa pode ver. */
export async function buscarClientePorDocumento(documento: string) {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, telefone, email, consultor_id")
    .eq("documento", soDigitos(documento))
    .maybeSingle();
  if (error) throw erro(error);
  return data as { id: string; nome: string; telefone: string | null; email: string | null; consultor_id: string | null } | null;
}

export function useCriarCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: NovoCard) => {
      const vazio = (s: string) => s.trim() || null;
      let clienteId = n.clienteId;
      if (!clienteId) {
        const { data, error } = await supabase
          .from("clientes")
          .insert({
            documento: soDigitos(n.documento),
            nome: n.nome.trim(),
            telefone: vazio(n.telefone),
            email: vazio(n.email),
            ...(n.consultorId ? { consultor_id: n.consultorId } : {}),
          })
          .select("id")
          .single();
        if (error) throw erro(error);
        clienteId = data.id as string;
      }
      const { error } = await supabase.from("contratos").insert({
        cliente_id: clienteId,
        etapa_id: n.etapaId,
        banco_id: n.bancoId,
        linha_credito_id: n.linhaId,
        veiculo: vazio(n.veiculo),
        ano_modelo: vazio(n.anoModelo),
        placa: vazio(n.placa)?.toUpperCase() ?? null,
        ...(n.consultorId ? { consultor_id: n.consultorId } : {}),
      });
      if (error) throw erro(error);
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

export function useAtualizarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Record<string, unknown> }) => {
      const { error } = await supabase.from("contratos").update(campos).eq("id", id);
      if (error) throw erro(error);
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

// ── O que o cliente vê no portal, por contrato ───────────────────────────────

export interface Ocorrencia {
  id: string;
  texto: string;
  created_at: string;
  lido_pelo_cliente_em: string | null;
  autor: { nome: string } | null;
  departamento: { nome: string; urgente: boolean } | null;
}

export const LIMITE_HISTORICO = 200;

export function useHistorico(contratoId: string | null) {
  return useQuery({
    queryKey: ["pipeline", "historico", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contrato_historico")
        .select("id, texto, created_at, lido_pelo_cliente_em, autor:perfis!contrato_historico_autor_id_fkey(nome), departamento:departamentos(nome, urgente)")
        .eq("contrato_id", contratoId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        // As mais recentes primeiro, com teto: contrato de anos não baixa tudo.
        .limit(LIMITE_HISTORICO);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Ocorrencia[];
    },
  });
}

export function useLancarOcorrencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; texto: string; departamentoId: string | null }) => {
      const { error } = await supabase.from("contrato_historico").insert({
        contrato_id: v.contratoId,
        texto: v.texto.trim(),
        departamento_id: v.departamentoId,
      });
      if (error) throw erro(error);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["pipeline", "historico", v.contratoId] }),
  });
}

export interface AtendimentoResumo {
  id: string;
  numero: number;
  titulo: string;
  arquivado_em: string | null;
  created_at: string;
  setor: { nome: string } | null;
}

export function useAtendimentosDoContrato(contratoId: string | null) {
  return useQuery({
    queryKey: ["pipeline", "atendimentos", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("id, numero, titulo, arquivado_em, created_at, setor:departamentos(nome)")
        .eq("contrato_id", contratoId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AtendimentoResumo[];
    },
  });
}

// ── Pendências de assinatura ("Pendências contrato #123" no portal) ─────────

export interface DocumentoPendente {
  id: string;
  tipo: string;
  titulo: string | null;
  link_assinatura: string | null;
  assinado_em: string | null;
  cancelado_em: string | null;
  created_at: string;
  conteudo_hash: string | null;   // preenchido = documento do SISTEMA (assina no portal)
  tipo_info: { nome: string } | null;
}

export function useDocumentos(contratoId: string | null) {
  return useQuery({
    queryKey: ["documentos", "contrato", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contrato_documentos")
        .select("id, tipo, titulo, link_assinatura, assinado_em, cancelado_em, created_at, conteudo_hash, tipo_info:documento_tipos(nome)")
        .eq("contrato_id", contratoId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DocumentoPendente[];
    },
  });
}

/** Documento de LINK (assinado fora): criar e marcar à mão. O do sistema nasce de `useGerarDocumento`. */
export function useSalvarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; id?: string; campos: Record<string, unknown> }) => {
      const { error } = v.id
        ? await supabase.from("contrato_documentos").update(v.campos).eq("id", v.id)
        : await supabase.from("contrato_documentos").insert({ contrato_id: v.contratoId, ...v.campos });
      if (error) throw erro(error);
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

export function useCancelarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; motivo: string; autorId: string | null }) => {
      const { error } = await supabase.from("contrato_documentos")
        .update({ cancelado_em: new Date().toISOString(), cancelado_por: v.autorId, motivo_cancelamento: v.motivo.trim() })
        .eq("id", v.id);
      if (error) throw erro(error);
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

// ── Acesso ao Portal do Cliente ──────────────────────────────────────────────

/** Senha legível para ditar por telefone: sem 0/O, 1/l/I. */
export function gerarSenha(tamanho = 10) {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

export function useDefinirSenhaPortal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clienteId, senha }: { clienteId: string; senha: string }) => {
      const { error } = await supabase.rpc("q_portal_definir_senha", { p_cliente: clienteId, p_senha: senha });
      if (error) throw erro(error);
    },
    onSuccess: () => invalidarCarteira(qc),
  });
}

// ── A conversa de um atendimento (a equipe responde o chat do portal) ────────

export interface Mensagem {
  id: string;
  autor_tipo: "cliente" | "equipe" | "robo";
  autor_id: string | null;
  corpo: string;
  created_at: string;
  lida_em: string | null;
}

export const LIMITE_MENSAGENS = 300;

export function useMensagens(atendimentoId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["pipeline", "mensagens", atendimentoId],
    enabled: !!atendimentoId,
    // O cliente escreve pelo portal: relê a cada 15 s (o mesmo ritmo do portal).
    refetchInterval: 15_000,
    queryFn: async () => {
      // As ÚLTIMAS N (desc + limit), viradas na tela. ⚠️ asc + limit traria as
      // N mais ANTIGAS, e a conversa congelaria quando passasse do teto.
      const { data, error } = await supabase
        .from("atendimento_mensagens")
        .select("id, autor_tipo, autor_id, corpo, created_at, lida_em")
        .eq("atendimento_id", atendimentoId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(LIMITE_MENSAGENS);
      if (error) throw new Error(error.message);
      const lista = ((data ?? []) as Mensagem[]).reverse();
      // Viu ⇒ marca as do CLIENTE como lidas, num update só (o UPDATE só alcança `lida_em`).
      if (lista.some((m) => m.autor_tipo === "cliente" && !m.lida_em)) {
        await supabase.from("atendimento_mensagens").update({ lida_em: new Date().toISOString() })
          .eq("atendimento_id", atendimentoId!).eq("autor_tipo", "cliente").is("lida_em", null);
        // A caixa mostra o contador de não lidas: lido aqui, some lá.
        qc.invalidateQueries({ queryKey: ["caixa"] });
        qc.invalidateQueries({ queryKey: ["painel"] });
      }
      return lista;
    },
  });
}

export function useResponder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { atendimentoId: string; corpo: string; autorId: string }) => {
      const { error } = await supabase.from("atendimento_mensagens").insert({
        atendimento_id: v.atendimentoId, autor_tipo: "equipe", autor_id: v.autorId, corpo: v.corpo.trim(),
      });
      if (error) throw erro(error);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["pipeline", "mensagens", v.atendimentoId] });
      qc.invalidateQueries({ queryKey: ["caixa"] });
    },
  });
}

export function useArquivarAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { atendimentoId: string; autorId: string }) => {
      const { error } = await supabase.from("atendimentos")
        .update({ arquivado_em: new Date().toISOString(), arquivado_por: v.autorId })
        .eq("id", v.atendimentoId);
      if (error) throw erro(error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline", "atendimentos"] });
      qc.invalidateQueries({ queryKey: ["caixa"] });
      qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}
