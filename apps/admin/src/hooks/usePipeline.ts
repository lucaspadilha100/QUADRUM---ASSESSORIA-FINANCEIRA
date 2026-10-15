import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lerTudo } from "@/lib/lerTudo";
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

// `perfis` tem TRÊS FKs vindas de contratos (consultor, cancelado_por,
// created_by): o embed precisa do nome da FK, senão o PostgREST recusa por
// ambiguidade.
const COLUNAS = `
  id, numero, etapa_id, etapa_desde, data_aceite, cancelado_em, motivo_cancelamento,
  veiculo, ano_modelo, placa, observacoes, consultor_id, banco_id, linha_credito_id, updated_at,
  cliente:clientes(id, nome, documento, telefone, email, user_id),
  banco:bancos(id, nome),
  linha:linhas_credito(id, nome, tem_veiculo),
  consultor:perfis!contratos_consultor_id_fkey(id, nome, avatar_url)
`;

const CHAVE = ["pipeline", "contratos"] as const;

export function useContratosPipeline() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () =>
      lerTudo<ContratoPipeline>((de, ate) =>
        supabase
          .from("contratos")
          .select(COLUNAS)
          // Ordem ESTÁVEL (id desempata): paginar sem ela repete e perde linhas.
          .order("etapa_desde", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate) as unknown as PromiseLike<{ data: ContratoPipeline[] | null; error: { message: string } | null }>,
      ),
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
      await qc.cancelQueries({ queryKey: CHAVE });
      const antes = qc.getQueryData<ContratoPipeline[]>(CHAVE);
      qc.setQueryData<ContratoPipeline[]>(CHAVE, (l) =>
        (l ?? []).map((c) => (c.id === id ? { ...c, etapa_id: etapaId, etapa_desde: new Date().toISOString() } : c)),
      );
      return { antes };
    },
    // Errou no banco ⇒ DESFAZ. Otimista que falha calado é a tela dizendo
    // uma coisa e o banco outra.
    onError: (_e, _v, ctx) => { if (ctx?.antes) qc.setQueryData(CHAVE, ctx.antes); },
    // Relê: o gatilho pode ter gravado `data_aceite` (etapa aceita).
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useAtualizarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Record<string, unknown> }) => {
      const { error } = await supabase.from("contratos").update(campos).eq("id", id);
      if (error) throw erro(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
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
        .order("id", { ascending: false });
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
  link_assinatura: string | null;
  assinado_em: string | null;
  created_at: string;
  tipo_info: { nome: string } | null;
}

export function useDocumentos(contratoId: string | null) {
  return useQuery({
    queryKey: ["pipeline", "documentos", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contrato_documentos")
        .select("id, tipo, link_assinatura, assinado_em, created_at, tipo_info:documento_tipos(nome)")
        .eq("contrato_id", contratoId!)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DocumentoPendente[];
    },
  });
}

export function useSalvarDocumento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; id?: string; campos: Record<string, unknown> }) => {
      const { error } = v.id
        ? await supabase.from("contrato_documentos").update(v.campos).eq("id", v.id)
        : await supabase.from("contrato_documentos").insert({ contrato_id: v.contratoId, ...v.campos });
      if (error) throw erro(error);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["pipeline", "documentos", v.contratoId] });
      qc.invalidateQueries({ queryKey: ["documentos"] });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
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

export function useMensagens(atendimentoId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["pipeline", "mensagens", atendimentoId],
    enabled: !!atendimentoId,
    // O cliente escreve pelo portal: relê a cada 15 s (o mesmo ritmo do portal).
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimento_mensagens")
        .select("id, autor_tipo, autor_id, corpo, created_at, lida_em")
        .eq("atendimento_id", atendimentoId!)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      // Viu ⇒ marca as do CLIENTE como lidas (o UPDATE só alcança `lida_em`).
      const naoLidas = (data ?? []).filter((m) => m.autor_tipo === "cliente" && !m.lida_em).map((m) => m.id);
      if (naoLidas.length) {
        await supabase.from("atendimento_mensagens").update({ lida_em: new Date().toISOString() }).in("id", naoLidas);
        // A caixa mostra o contador de não lidas: lido aqui, some lá.
        qc.invalidateQueries({ queryKey: ["caixa"] });
      }
      return (data ?? []) as Mensagem[];
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
    },
  });
}
