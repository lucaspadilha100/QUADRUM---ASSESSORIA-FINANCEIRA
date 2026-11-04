import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Ban, Bell, CheckCircle2, CircleDollarSign, CirclePlus, FilePlus2, FileSignature, History, Pencil,
  Receipt, RotateCcw, Undo2, XCircle, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEquipe, useEtapas } from "@/hooks/useCadastros";
import { useDocumentos, type ContratoPipeline, type Ocorrencia } from "@/hooks/usePipeline";
import { rotuloParcela } from "@/hooks/useParcelas";
import { dataBR, dataHoraBR } from "@/lib/formato";
import { Bloco } from "@/components/Bloco";

// A linha do tempo COMPLETA do contrato, numa lista só: etapas (quem moveu e
// quanto ficou), documentos (gerado, assinado, cancelado), parcelas e
// cobranças (emitida, paga, desfeita) e as ocorrências que o cliente lê. Tudo
// vem de registro que o BANCO grava (contrato_movimentos, parcela_eventos,
// parcela_cobrancas, contrato_documentos, contrato_historico).

type Categoria = "etapas" | "documentos" | "pagamentos" | "cliente";
interface Item {
  id: string; quando: string; categoria: Categoria; icone: LucideIcon; cor: string;
  texto: ReactNode; detalhe?: string | null; ocorrencia?: Ocorrencia;
}

interface Movimento {
  id: string; tipo: "criado" | "etapa" | "perdido" | "reaberto";
  de_etapa_id: string | null; para_etapa_id: string | null; autor_id: string | null;
  motivo: string | null; reconstituido: boolean; created_at: string;
}
interface EventoParcela {
  id: string; tipo: "criada" | "alterada" | "paga" | "pagamento_desfeito" | "cancelada";
  dados: Record<string, unknown> | null; autor_id: string | null; created_at: string; parcela_id: string;
}
interface CobrancaLinha { id: string; tipo: "boleto" | "pix" | "link"; ambiente: string; created_at: string; parcela_id: string }

const reais = (v: unknown) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function duracao(ms: number) {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `${d} dia${d === 1 ? "" : "s"}`;
}

function lista<T>(chave: string[], q: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  return {
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await q();
      // Tabela que ainda não existe (migração por rodar) não derruba a linha do tempo.
      if (error) return [] as T[];
      return (data ?? []) as T[];
    },
  };
}

const FILTROS: { v: "tudo" | Categoria; rotulo: string }[] = [
  { v: "tudo", rotulo: "Tudo" }, { v: "cliente", rotulo: "Para o cliente" }, { v: "etapas", rotulo: "Etapas" },
  { v: "documentos", rotulo: "Documentos" }, { v: "pagamentos", rotulo: "Pagamentos" },
];

export function LinhaCompleta({ c, ocorrencias }: { c: ContratoPipeline; ocorrencias: Ocorrencia[] }) {
  const { data: etapas = [] } = useEtapas();
  const { data: equipe = [] } = useEquipe();
  const { data: docs = [] } = useDocumentos(c.id);
  const { data: movimentos = [] } = useQuery(lista<Movimento>(["contrato", c.id, "movimentos"], () =>
    supabase.from("contrato_movimentos").select("id, tipo, de_etapa_id, para_etapa_id, autor_id, motivo, reconstituido, created_at")
      .eq("contrato_id", c.id).order("created_at", { ascending: true }).order("id", { ascending: true })));
  const { data: evParcelas = [] } = useQuery(lista<EventoParcela>(["contrato", c.id, "parcelaEventos"], () =>
    supabase.from("parcela_eventos").select("id, tipo, dados, autor_id, created_at, parcela_id")
      .eq("contrato_id", c.id).order("created_at", { ascending: false }).limit(300)));
  const { data: cobrancas = [] } = useQuery(lista<CobrancaLinha>(["contrato", c.id, "cobrancasTodas"], () =>
    supabase.from("parcela_cobrancas").select("id, tipo, ambiente, created_at, parcela_id")
      .eq("contrato_id", c.id).order("created_at", { ascending: false }).limit(300)));
  // O número de cada parcela, inclusive as que saíram do plano (o evento continua apontando para elas).
  const { data: todasParcelas = [] } = useQuery(lista<{ id: string; numero: number; cancelada_em: string | null }>(["contrato", c.id, "parcelasTodas"], () =>
    supabase.from("contrato_parcelas").select("id, numero, cancelada_em").eq("contrato_id", c.id)));
  const [filtro, setFiltro] = useState<"tudo" | Categoria>("tudo");

  const etapa = (id: string | null) => etapas.find((e) => e.id === id)?.nome ?? "—";
  const pessoa = (id: string | null) => (id ? equipe.find((p) => p.id === id)?.nome ?? "Equipe" : null);
  const numeroDe = new Map(todasParcelas.map((x) => [x.id, x.numero]));
  const nParcelas = todasParcelas.filter((x) => !x.cancelada_em && x.numero > 0).length;
  const parc = (id: string) => { const n = numeroDe.get(id); return n == null ? "Parcela" : rotuloParcela(n, nParcelas); };

  const itens = useMemo(() => {
    const out: Item[] = [];
    movimentos.forEach((m, i) => {
      const ficou = i > 0 && m.tipo === "etapa" ? new Date(m.created_at).getTime() - new Date(movimentos[i - 1].created_at).getTime() : null;
      out.push({
        id: `m${m.id}`, quando: m.created_at, categoria: "etapas",
        icone: m.tipo === "criado" ? CirclePlus : m.tipo === "perdido" ? XCircle : m.tipo === "reaberto" ? RotateCcw : ArrowRight,
        cor: m.tipo === "perdido" ? "text-destructive" : m.tipo === "criado" ? "text-q-gold" : "text-q-petrol",
        texto: m.tipo === "criado" ? <>Contrato criado em <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>
          : m.tipo === "etapa" ? <>{etapa(m.de_etapa_id)} → <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>
          : m.tipo === "perdido" ? <>Perdido{m.motivo ? `: ${m.motivo}` : ""}</>
          : <>Reaberto em <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>,
        detalhe: [pessoa(m.autor_id), m.reconstituido ? "data aproximada" : null, ficou != null ? `${duracao(ficou)} em ${etapa(m.de_etapa_id)}` : null].filter(Boolean).join(" · "),
      });
    });
    for (const d of docs) {
      const nome = d.titulo || d.tipo_info?.nome || d.tipo;
      const noSistema = !!d.conteudo_hash;
      out.push({ id: `dg${d.id}`, quando: d.created_at, categoria: "documentos", icone: FilePlus2, cor: "text-q-petrol",
        texto: <>{noSistema ? "Documento gerado" : "Documento lançado"}: <strong className="font-medium">{nome}</strong></> });
      if (d.assinado_em) out.push({ id: `da${d.id}`, quando: d.assinado_em, categoria: "documentos", icone: FileSignature, cor: "text-success",
        texto: <>Assinado: <strong className="font-medium">{nome}</strong></>, detalhe: noSistema ? "pelo cliente, no portal" : "fora do sistema" });
      if (d.cancelado_em) out.push({ id: `dc${d.id}`, quando: d.cancelado_em, categoria: "documentos", icone: Ban, cor: "text-muted-foreground",
        texto: <>Cancelado: {nome}</> });
    }
    for (const e of evParcelas) {
      const dd = e.dados ?? {};
      const p = parc(e.parcela_id);
      const base = { id: `p${e.id}`, quando: e.created_at, categoria: "pagamentos" as const, detalhe: pessoa(e.autor_id) };
      if (e.tipo === "paga") out.push({ ...base, icone: CheckCircle2, cor: "text-success",
        texto: <><strong className="font-medium">{p}</strong> paga{dd.forma ? ` · ${dd.forma}` : ""}{dd.pago_em ? ` em ${dataBR(String(dd.pago_em))}` : ""}</>,
        detalhe: !e.autor_id && String(dd.obs ?? "").startsWith("PagBank") ? "Automático (PagBank)" : base.detalhe });
      else if (e.tipo === "pagamento_desfeito") out.push({ ...base, icone: Undo2, cor: "text-destructive",
        texto: <>Pagamento desfeito: {p}{dd.motivo ? ` — ${dd.motivo}` : ""}</> });
      else if (e.tipo === "criada") out.push({ ...base, icone: CircleDollarSign, cor: "text-muted-foreground",
        texto: <>{p} no plano: {reais(dd.valor)}, vence {dd.vencimento ? dataBR(String(dd.vencimento)) : "—"}</> });
      else if (e.tipo === "alterada") {
        const de = (dd.de ?? {}) as Record<string, unknown>, para = (dd.para ?? {}) as Record<string, unknown>;
        out.push({ ...base, icone: Pencil, cor: "text-muted-foreground",
          texto: <>{p} alterada: {reais(de.valor)} · {dataBR(String(de.vencimento))} → {reais(para.valor)} · {dataBR(String(para.vencimento))}</> });
      } else out.push({ ...base, icone: XCircle, cor: "text-muted-foreground", texto: <>{p} saiu do plano</> });
    }
    for (const x of cobrancas) {
      out.push({ id: `c${x.id}`, quando: x.created_at, categoria: "pagamentos", icone: Receipt, cor: "text-q-petrol",
        texto: <>{x.tipo === "boleto" ? "Boleto" : x.tipo === "pix" ? "PIX" : "Link de cartão"} emitido · {parc(x.parcela_id)}</>,
        detalhe: x.ambiente === "sandbox" ? "teste" : "PagBank" });
    }
    for (const o of ocorrencias) {
      out.push({ id: `o${o.id}`, quando: o.created_at, categoria: "cliente", icone: o.departamento?.urgente ? Bell : History, cor: o.departamento?.urgente ? "text-warning" : "text-q-petrol",
        texto: null, ocorrencia: o });
    }
    return out.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
  }, [movimentos, docs, evParcelas, cobrancas, ocorrencias, etapas, equipe, todasParcelas]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = filtro === "tudo" ? itens : itens.filter((i) => i.categoria === filtro);
  const contagem = (v: "tudo" | Categoria) => (v === "tudo" ? itens.length : itens.filter((i) => i.categoria === v).length);
  const ultimaEtapa = [...movimentos].reverse().find((m) => m.tipo !== "perdido");

  return (
    <Bloco titulo="Linha do tempo" icone={<History className="h-4 w-4 text-q-petrol" />}>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" onClick={() => setFiltro(f.v)} aria-pressed={filtro === f.v}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium sm:min-h-8 ${filtro === f.v ? "border-q-gold bg-q-gold/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}>
            {f.rotulo} <span className="tabular-nums opacity-70">{contagem(f.v)}</span>
          </button>
        ))}
      </div>
      {ultimaEtapa && !c.cancelado_em && (
        <p className="text-xs text-muted-foreground">Na etapa atual há {duracao(Date.now() - new Date(ultimaEtapa.created_at).getTime())}</p>
      )}
      {visiveis.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nada por aqui ainda.</p>
      ) : (
        <ol className="space-y-3 border-l border-border pl-4">
          {visiveis.map((i) => {
            const Icone = i.icone;
            const o = i.ocorrencia;
            return (
              <li key={i.id} className="relative">
                <span className={`absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card ${i.cor}`}><Icone className="h-4 w-4" /></span>
                {o ? (
                  <div className={`rounded-lg border p-3 ${o.departamento?.urgente ? "border-warning/50 bg-warning/5" : "border-border bg-accent/40"}`}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {o.departamento?.urgente ? <span className="text-warning">Urgente · </span> : null}Para o cliente
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {o.autor?.nome ?? "—"} em {dataHoraBR(o.created_at)}
                      {o.departamento ? ` · ${o.departamento.nome}` : ""}
                      {o.lido_pelo_cliente_em ? ` · lido pelo cliente em ${dataHoraBR(o.lido_pelo_cliente_em)}` : ""}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground">{i.texto}</p>
                    <p className="text-xs text-muted-foreground">{[dataHoraBR(i.quando), i.detalhe].filter(Boolean).join(" · ")}</p>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Bloco>
  );
}
