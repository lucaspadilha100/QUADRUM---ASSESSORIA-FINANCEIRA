import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileText, Globe, MessagesSquare, PenLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Falha } from "@/components/Estados";
import { useEtapas } from "@/hooks/useCadastros";
import { useCaixa } from "@/hooks/useCaixa";
import { useDocumentosTodos } from "@/hooks/useDocumentosTodos";
import { useContratosPipeline } from "@/hooks/usePipeline";
import { diasDesde } from "@/lib/formato";

// O painel lê as MESMAS consultas das telas (pipeline, caixa, documentos):
// a RLS já recorta — gestor vê a Quadrum inteira, colaborador a carteira dele.
// Cada número é um link para a lista que ele resume, já filtrada.

const PARADO_DIAS = 7;

export default function Painel() {
  const { perfil, isGestor } = useAuth();
  const contratos = useContratosPipeline();
  const etapas = useEtapas();
  const caixa = useCaixa();
  const docs = useDocumentosTodos();
  const primeiroNome = perfil?.nome?.split(" ")[0] ?? "";

  const lista = contratos.data ?? [];
  const ativos = lista.filter((c) => !c.cancelado_em);
  const andamento = ativos.filter((c) => !c.data_aceite);
  const noPortal = ativos.filter((c) => c.data_aceite);
  const parados = ativos
    .filter((c) => diasDesde(c.etapa_desde) >= PARADO_DIAS)
    .sort((a, b) => a.etapa_desde.localeCompare(b.etapa_desde));
  const abertos = (caixa.data ?? []).filter((i) => !i.arquivado_em);
  const naoLidos = abertos.filter((i) => i.nao_lidas > 0);
  const pendentes = (docs.data ?? []).filter((d) => !d.assinado_em);

  const etapasVisiveis = (etapas.data ?? []).filter((e) => e.ativo || ativos.some((c) => c.etapa_id === e.id));
  const porEtapa = etapasVisiveis.map((e) => ({ ...e, qtd: ativos.filter((c) => c.etapa_id === e.id).length }));
  const maior = Math.max(1, ...porEtapa.map((e) => e.qtd));
  const nomeEtapa = (id: string) => etapas.data?.find((e) => e.id === id)?.nome ?? "—";

  const carregando = contratos.isLoading || caixa.isLoading || docs.isLoading;
  const falha = (contratos.error ?? caixa.error ?? docs.error ?? etapas.error) as Error | null;

  return (
    <div>
      <PageHeader
        titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}
        descricao={isGestor ? "A Quadrum hoje: tudo o que o cliente vê no Portal nasce aqui." : "A sua carteira hoje."}
      />

      <div className="space-y-6 px-4 py-6 sm:px-8">
        {falha && <Falha erro={falha} />}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero to="/contratos?situacao=andamento" icone={FileText} rotulo="Contratos em andamento" valor={andamento.length} carregando={carregando} />
          <Numero to="/contratos?situacao=portal" icone={Globe} rotulo="No Portal do Cliente" valor={noPortal.length} carregando={carregando} />
          <Numero to="/atendimentos?aba=nao_lidas" icone={MessagesSquare} rotulo="Atendimentos por ler" valor={naoLidos.length}
            detalhe={`${abertos.length} aberto${abertos.length === 1 ? "" : "s"}`} destaque={naoLidos.length > 0} carregando={carregando} />
          <Numero to="/documentos" icone={PenLine} rotulo="Assinaturas pendentes" valor={pendentes.length} carregando={carregando} />
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
                        <span className="truncate text-foreground group-hover:underline">
                          {e.nome}{e.aceita && <span className="ml-1.5 text-[11px] text-muted-foreground">(cliente vê no portal)</span>}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">{e.qtd}</span>
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
              <span className="text-xs text-muted-foreground">{parados.length} contrato{parados.length === 1 ? "" : "s"}</span>
            </div>
            {parados.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{carregando ? "Carregando…" : "Nenhum contrato parado. 🎉"}</p>
            ) : (
              <ul className="divide-y divide-border">
                {parados.slice(0, 8).map((c) => {
                  const dias = diasDesde(c.etapa_desde);
                  return (
                    <li key={c.id}>
                      <Link to={`/contratos?contrato=${c.id}`} className="flex items-center gap-3 py-2.5 hover:bg-accent/50">
                        <AlertTriangle className={`h-4 w-4 shrink-0 ${dias >= 15 ? "text-destructive" : "text-warning"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">#{c.numero} · {c.cliente?.nome ?? "Cliente de outra carteira"}</p>
                          <p className="truncate text-xs text-muted-foreground">{nomeEtapa(c.etapa_id)} · {c.consultor?.nome ?? "Sem consultor"}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{dias}d</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {parados.length > 8 && <Link to="/contratos" className="q-link mt-2 inline-block text-xs">Ver todos os contratos</Link>}
          </section>
        </div>

        {naoLidos.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="q-titulo-marca text-xs text-foreground">Clientes esperando resposta</h2>
              <Link to="/atendimentos?aba=nao_lidas" className="q-link text-xs">Abrir atendimentos</Link>
            </div>
            <ul className="divide-y divide-border">
              {naoLidos.slice(0, 6).map((i) => (
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
      <span className="font-titulo text-2xl font-bold tabular-nums text-foreground">{carregando ? "—" : valor}</span>
      <span className="text-xs leading-tight text-muted-foreground">{rotulo}{detalhe && !carregando ? ` · ${detalhe}` : ""}</span>
    </Link>
  );
}
