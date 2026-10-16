import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileText, Globe, MessagesSquare, PenLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Falha } from "@/components/Estados";
import { useEtapas } from "@/hooks/useCadastros";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { diasDesde, mensagemDeErro } from "@/lib/formato";

// Os números são CONTADOS NO BANCO (`q_painel`) — o painel não baixa a
// carteira para contar. A RLS recorta: gestor vê a Quadrum inteira,
// colaborador a carteira dele. Cada número é um link para a lista que ele
// resume, já filtrada.

const PARADO_DIAS = 7;

interface DadosPainel {
  andamento: number;
  portal: number;
  perdidos: number;
  por_etapa: Record<string, number>;
  parados_total: number;
  parados: { id: string; numero: number; etapa_desde: string; cliente_nome: string | null; consultor_nome: string | null; etapa_nome: string | null }[];
  atendimentos_abertos: number;
  atendimentos_nao_lidos: number;
  esperando: { id: string; cliente_nome: string; setor_nome: string | null; titulo: string; ultima_corpo: string | null; nao_lidas: number }[];
  assinaturas_pendentes: number;
}

function usePainel() {
  return useQuery({
    queryKey: ["painel"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_painel", { p_parado_dias: PARADO_DIAS });
      if (error) throw new Error(mensagemDeErro(error));
      return data as DadosPainel;
    },
  });
}

// Quanto tempo cada etapa leva (passagens dos últimos 90 dias). Sem a
// migração 20261020000000, só não mostra.
function useTempoPorEtapa() {
  return useQuery({
    queryKey: ["painel", "tempo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_tempo_por_etapa", { p_dias: 90 });
      if (error) return {} as Record<string, number>;
      return Object.fromEntries((data as { etapa_id: string; media_dias: number }[]).map((x) => [x.etapa_id, Number(x.media_dias)]));
    },
  });
}

export default function Painel() {
  const { perfil, isGestor } = useAuth();
  const painel = usePainel();
  const { data: tempo = {} } = useTempoPorEtapa();
  const etapas = useEtapas();
  const primeiroNome = perfil?.nome?.split(" ")[0] ?? "";
  const p = painel.data;

  const porEtapa = (etapas.data ?? [])
    .filter((e) => e.ativo || (p?.por_etapa[e.id] ?? 0) > 0)
    .map((e) => ({ ...e, qtd: p?.por_etapa[e.id] ?? 0 }));
  const maior = Math.max(1, ...porEtapa.map((e) => e.qtd));
  const carregando = painel.isLoading;
  const falha = (painel.error ?? etapas.error) as Error | null;
  const parados = p?.parados ?? [];
  const naoLidos = p?.esperando ?? [];
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");

  return (
    <div>
      <PageHeader
        titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}
      />

      <div className="space-y-6 px-4 py-6 sm:px-8">
        {falha && <Falha erro={falha} />}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero to="/contratos?situacao=andamento" icone={FileText} rotulo="Contratos em andamento" valor={p?.andamento ?? 0} carregando={carregando} />
          <Numero to="/contratos?situacao=portal" icone={Globe} rotulo="No Portal do Cliente" valor={p?.portal ?? 0} carregando={carregando} />
          <Numero to="/atendimentos?aba=nao_lidas" icone={MessagesSquare} rotulo="Atendimentos por ler" valor={p?.atendimentos_nao_lidos ?? 0}
            detalhe={`${n(p?.atendimentos_abertos)} aberto${p?.atendimentos_abertos === 1 ? "" : "s"}`} destaque={(p?.atendimentos_nao_lidos ?? 0) > 0} carregando={carregando} />
          <Numero to="/documentos" icone={PenLine} rotulo="Assinaturas pendentes" valor={p?.assinaturas_pendentes ?? 0} carregando={carregando} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="q-titulo-marca text-xs text-foreground">Contratos por etapa</h2>
              <Link to="/pipeline" className="q-link text-xs">Abrir pipeline</Link>
            </div>
            {porEtapa.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{carregando ? "Carregando…" : "Nenhuma etapa cadastrada."}</p>
            ) : (
              <ul className="space-y-2.5">
                {porEtapa.map((e) => (
                  <li key={e.id}>
                    <Link to={`/contratos?etapa=${e.id}`} className="group block">
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-foreground group-hover:underline">
                          {e.nome}
                          {tempo[e.id] != null && <span className="ml-1.5 text-xs text-muted-foreground">≈ {tempo[e.id].toLocaleString("pt-BR")} {tempo[e.id] === 1 ? "dia" : "dias"}</span>}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">{n(e.qtd)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${(e.qtd / maior) * 100}%`, background: e.cor }} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="q-titulo-marca text-xs text-foreground">Parados há {PARADO_DIAS}+ dias</h2>
              <span className="text-xs text-muted-foreground">{n(p?.parados_total)} contrato{p?.parados_total === 1 ? "" : "s"}</span>
            </div>
            {parados.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{carregando ? "Carregando…" : "Nenhum contrato parado. 🎉"}</p>
            ) : (
              <ul className="divide-y divide-border">
                {parados.map((c) => {
                  const dias = diasDesde(c.etapa_desde);
                  return (
                    <li key={c.id}>
                      <Link to={`/contratos?contrato=${c.id}`} className="flex items-center gap-3 py-2.5 hover:bg-accent/50">
                        <AlertTriangle className={`h-4 w-4 shrink-0 ${dias >= 15 ? "text-destructive" : "text-warning"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">#{c.numero} · {c.cliente_nome ?? "Cliente de outra carteira"}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.etapa_nome ?? "—"} · {c.consultor_nome ?? "Sem consultor"}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{dias}d</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {(p?.parados_total ?? 0) > parados.length && <Link to="/contratos" className="q-link mt-2 inline-block text-xs">Ver todos os contratos</Link>}
          </section>
        </div>

        {naoLidos.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="q-titulo-marca text-xs text-foreground">Clientes esperando resposta</h2>
              <Link to="/atendimentos?aba=nao_lidas" className="q-link text-xs">Abrir atendimentos</Link>
            </div>
            <ul className="divide-y divide-border">
              {naoLidos.map((i) => (
                <li key={i.id}>
                  <Link to={`/atendimentos?atendimento=${i.id}`} className="flex items-center gap-3 py-2.5 hover:bg-accent/50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-q-gold" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{i.cliente_nome} <span className="font-normal text-muted-foreground">· {i.setor_nome ?? "—"}</span></p>
                      <p className="truncate text-xs text-muted-foreground">{i.ultima_corpo ?? i.titulo}</p>
                    </div>
                    <span className="h-5 min-w-5 shrink-0 rounded-full bg-q-gold px-1.5 text-center text-[11px] font-bold leading-5 text-q-onix">{i.nao_lidas}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Numero({ to, icone: Icone, rotulo, valor, detalhe, destaque, carregando }: {
  to: string; icone: ComponentType<{ className?: string }>; rotulo: string; valor: number;
  detalhe?: string; destaque?: boolean; carregando: boolean;
}) {
  return (
    <Link to={to}
      className={`group flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:bg-accent ${destaque ? "border-q-gold" : "border-border hover:border-q-gold/60"}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-q-onix text-q-gold"><Icone className="h-4 w-4" /></span>
      <span className="font-titulo text-2xl font-bold tabular-nums text-foreground">{carregando ? "—" : valor.toLocaleString("pt-BR")}</span>
      <span className="text-xs leading-tight text-muted-foreground">{rotulo}{detalhe && !carregando ? ` · ${detalhe}` : ""}</span>
    </Link>
  );
}
