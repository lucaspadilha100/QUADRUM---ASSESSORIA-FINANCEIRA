import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, ChevronDown, Globe, Loader2, LogIn, Monitor, Search, Smartphone, UserX, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/Avatar";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { PAPEL_LABEL, useAuth } from "@/contexts/AuthContext";
import { useAtrasado, useRpcPagina } from "@/hooks/usePagina";
import { supabase } from "@/integrations/supabase/client";
import { dataHoraBR, formatarDocumento, mensagemDeErro } from "@/lib/formato";
import { PaginaNaoEncontrada, useParamUrl } from "@/shell";

// Só o ADMINISTRADOR (o banco recusa os outros: q_acessos_pessoas/q_acessos_de).
// Os números do topo seguem o filtro de TIPO e ignoram busca e situação; cada
// cartão filtra a lista pela situação (migração 20261025000000).

type Status = "hoje" | "7d" | "30d" | "inativo" | "nunca";
type App = "admin" | "portal";

interface Pessoa {
  user_id: string; nome: string; identificador: string | null; tipo: "equipe" | "cliente";
  papel: "admin" | "gestor" | "colaborador" | null; ativo: boolean; avatar_url: string | null;
  ultimo_acesso: string | null; ultimo_registro: string | null; ip: string | null; app: App | null;
  user_agent: string | null; acessos_30d: number; status: Status;
}
interface Resumo { pessoas: number; hoje: number; d7: number; d30: number; inativo: number; nunca: number; logins_hoje: number }
interface Dia { dia: string; logins: number; pessoas: number }
interface Contagem { todos: number; equipe: number; clientes: number }
interface Dados { linhas: Pessoa[]; total: number; contagem: Contagem; resumo: Resumo; por_dia: Dia[] }
interface Acesso { id: string; app: App; ip: string | null; user_agent: string | null; created_at: string }

const SITUACAO: Record<Status, { rotulo: string; ponto: string; texto: string }> = {
  hoje:    { rotulo: "Hoje",         ponto: "bg-success",          texto: "text-success" },
  "7d":    { rotulo: "Esta semana",  ponto: "bg-q-petrol",         texto: "text-q-petrol" },
  "30d":   { rotulo: "Este mês",     ponto: "bg-muted-foreground", texto: "text-muted-foreground" },
  inativo: { rotulo: "Inativo",      ponto: "bg-warning",          texto: "text-warning" },
  nunca:   { rotulo: "Nunca entrou", ponto: "bg-muted-foreground/30",           texto: "text-muted-foreground" },
};
const FILTRO_STATUS: Record<string, string> = {
  hoje: "Acessaram hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", inativo: "Inativos", nunca: "Nunca entraram",
};

const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");

function haQuanto(iso: string | null) {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

/** "Chrome · Windows" e se é celular, a partir do navegador gravado. */
function dispositivo(ua: string | null) {
  if (!ua) return null;
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return { texto: [nav, so].filter(Boolean).join(" · "), celular: /Android|iPhone|iPad|Mobile/.test(ua) };
}

const nomeApp = (a: App | null) => (a === "portal" ? "Portal do Cliente" : a === "admin" ? "Admin" : null);

export default function Acessos() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <PaginaNaoEncontrada />;
  return <Tela />;
}

function Tela() {
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [tipo, setTipo] = useParamUrl("tipo", "todos");
  const [status, setStatus] = useParamUrl("status", "todos");
  const [aberto, setAberto] = useParamUrl("pessoa", "");
  const pag = usePaginacaoUrl();
  const termo = useAtrasado(busca);
  const { data: bruto, isLoading, isFetching, error } = useRpcPagina<Pessoa, Contagem>(["acessos", "pessoas"], "q_acessos_pessoas", {
    p_busca: termo, p_tipo: tipo, p_status: status, p_pagina: pag.pagina, p_por: pag.por,
  }, { refetchInterval: 60_000 });
  const data = bruto as unknown as Dados | undefined;
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { todos: 0, equipe: 0, clientes: 0 };
  const r = data?.resumo;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };
  const alternarStatus = (s: string) => filtrar(setStatus)(status === s ? "todos" : s);

  return (
    <div>
      <PageHeader titulo="Últimos acessos" />

      <div className="space-y-6 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cartao icone={LogIn} rotulo="Acessaram hoje" valor={r?.hoje} detalhe={r ? `${n(r.logins_hoje)} login${r.logins_hoje === 1 ? "" : "s"}` : undefined}
            ativo={status === "hoje"} onClick={() => alternarStatus("hoje")} carregando={isLoading} />
          <Cartao icone={CalendarDays} rotulo="Últimos 7 dias" valor={r?.d7} detalhe={r ? `de ${n(r.pessoas)}` : undefined}
            ativo={status === "7d"} onClick={() => alternarStatus("7d")} carregando={isLoading} />
          <Cartao icone={CalendarClock} rotulo="Últimos 30 dias" valor={r?.d30} detalhe={r ? `${n(r.inativo)} inativo${r.inativo === 1 ? "" : "s"}` : undefined}
            ativo={status === "30d"} onClick={() => alternarStatus("30d")} carregando={isLoading} />
          <Cartao icone={UserX} rotulo="Nunca entraram" valor={r?.nunca} destaque={(r?.nunca ?? 0) > 0}
            ativo={status === "nunca"} onClick={() => alternarStatus("nunca")} carregando={isLoading} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <LoginsPorDia dias={data?.por_dia ?? []} carregando={isLoading} />
          <Distribuicao r={r} status={status} onStatus={alternarStatus} />
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar nome, e-mail ou CPF/CNPJ" className="bg-card pl-9" />
              {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            <Chips valor={tipo} onChange={filtrar(setTipo)} opcoes={[
              { valor: "todos", rotulo: `Todos (${n(cont.todos)})` },
              { valor: "equipe", rotulo: `Equipe (${n(cont.equipe)})` },
              { valor: "clientes", rotulo: `Clientes (${n(cont.clientes)})` },
            ]} />
            {status !== "todos" && FILTRO_STATUS[status] && (
              <button type="button" onClick={() => filtrar(setStatus)("todos")}
                className="inline-flex items-center gap-1.5 rounded-full border border-q-gold/60 bg-q-gold/10 px-3 py-2 text-xs font-medium text-foreground sm:py-1.5">
                {FILTRO_STATUS[status]} <X className="h-3.5 w-3.5" aria-label="Tirar filtro" />
              </button>
            )}
          </div>

          {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : lista.length === 0 ? <Vazio texto="Ninguém com esse filtro." /> : (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="hidden border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground lg:table-header-group">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Pessoa</th>
                      <th className="px-4 py-2.5 font-medium">Situação</th>
                      <th className="px-4 py-2.5 font-medium">Último acesso</th>
                      <th className="px-4 py-2.5 font-medium">Origem</th>
                      <th className="px-4 py-2.5 font-medium">Dispositivo</th>
                      <th className="px-4 py-2.5 text-right font-medium">30 dias</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lista.map((p) => (
                      <Linha key={p.user_id} p={p} aberta={aberto === p.user_id} onAlternar={() => setAberto(aberto === p.user_id ? "" : p.user_id)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao pagina={pag.pagina} por={pag.por} total={data?.total ?? 0} onPagina={pag.irPara} onPor={pag.mudarPor} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Cartao({ icone: Icone, rotulo, valor, detalhe, destaque, ativo, onClick, carregando }: {
  icone: ComponentType<{ className?: string }>; rotulo: string; valor: number | undefined; detalhe?: string;
  destaque?: boolean; ativo: boolean; onClick: () => void; carregando: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={`flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent ${
        ativo ? "border-q-gold ring-1 ring-q-gold" : destaque ? "border-warning/60" : "border-border hover:border-q-gold/60"}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-q-onix text-q-gold"><Icone className="h-4 w-4" /></span>
      <span className="font-titulo text-2xl font-bold tabular-nums text-foreground">{carregando ? "—" : n(valor)}</span>
      <span className="text-xs leading-tight text-muted-foreground">{rotulo}{detalhe && !carregando ? ` · ${detalhe}` : ""}</span>
    </button>
  );
}

function LoginsPorDia({ dias, carregando }: { dias: Dia[]; carregando: boolean }) {
  const maior = Math.max(1, ...dias.map((d) => d.logins));
  const total = dias.reduce((s, d) => s + d.logins, 0);
  const rotuloDia = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 lg:col-span-2">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="q-titulo-marca text-xs text-foreground">Logins · 14 dias</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{carregando ? "" : `${n(total)} no período`}</span>
      </div>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5">
        {dias.map((d, i) => {
          const hoje = i === dias.length - 1;
          return (
            <div key={d.dia} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              title={`${rotuloDia(d.dia)}: ${d.logins} login${d.logins === 1 ? "" : "s"} · ${d.pessoas} pessoa${d.pessoas === 1 ? "" : "s"}`}>
              <span className={`text-[10px] tabular-nums ${d.logins ? "text-foreground" : "text-transparent"}`}>{d.logins}</span>
              <div className={`w-full rounded-t ${hoje ? "bg-q-gold" : "bg-q-gold/55 group-hover:bg-q-gold/80"}`}
                style={{ height: `${d.logins ? Math.max(4, (d.logins / maior) * 100) : 2}%`, opacity: d.logins ? 1 : 0.35 }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 sm:gap-1.5">
        {dias.map((d, i) => (
          <span key={d.dia} className={`min-w-0 flex-1 text-center text-[10px] tabular-nums ${i === dias.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"} ${i % 2 && i !== dias.length - 1 ? "invisible sm:visible" : ""}`}>
            {rotuloDia(d.dia).slice(0, 2)}
          </span>
        ))}
      </div>
    </section>
  );
}

function Distribuicao({ r, status, onStatus }: { r: Resumo | undefined; status: string; onStatus: (s: string) => void }) {
  const faixas: { s: Status; v: number }[] = r ? [
    { s: "hoje", v: r.hoje }, { s: "7d", v: r.d7 - r.hoje }, { s: "30d", v: r.d30 - r.d7 },
    { s: "inativo", v: r.inativo }, { s: "nunca", v: r.nunca },
  ] : [];
  const total = Math.max(1, r?.pessoas ?? 0);
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="q-titulo-marca text-xs text-foreground">Situação</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{r ? `${n(r.pessoas)} pessoa${r.pessoas === 1 ? "" : "s"}` : ""}</span>
      </div>
      <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
        {faixas.map((f) => f.v > 0 && <div key={f.s} className={SITUACAO[f.s].ponto} style={{ width: `${(f.v / total) * 100}%` }} />)}
      </div>
      <ul className="space-y-1">
        {faixas.map((f) => {
          // "Esta semana" e "Este mês" são faixas (sem o anterior); o filtro
          // equivalente é o acumulado, então essas duas não filtram daqui.
          const filtro = f.s === "hoje" || f.s === "inativo" || f.s === "nunca" ? f.s : null;
          const conteudo = (
            <>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SITUACAO[f.s].ponto}`} />
              <span className="flex-1 text-foreground">{SITUACAO[f.s].rotulo}</span>
              <span className="tabular-nums text-muted-foreground">{Math.round((f.v / total) * 100)}%</span>
              <span className="w-8 text-right font-semibold tabular-nums text-foreground">{n(f.v)}</span>
            </>
          );
          return (
            <li key={f.s}>
              {filtro ? (
                <button type="button" onClick={() => onStatus(filtro)} aria-pressed={status === filtro}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent sm:min-h-8 ${status === filtro ? "bg-accent" : ""}`}>
                  {conteudo}
                </button>
              ) : (
                <div className="flex min-h-9 items-center gap-2 px-2 text-sm sm:min-h-8">{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Linha({ p, aberta, onAlternar }: { p: Pessoa; aberta: boolean; onAlternar: () => void }) {
  const quem = p.tipo === "cliente" ? formatarDocumento(p.identificador ?? "") : p.identificador;
  const sit = SITUACAO[p.status] ?? SITUACAO.nunca;
  const disp = dispositivo(p.user_agent);
  const perfil = p.tipo === "cliente" ? "Cliente" : p.papel ? PAPEL_LABEL[p.papel] : "Equipe";
  return (
    <>
      <tr onClick={onAlternar} aria-expanded={aberta} className={`block cursor-pointer hover:bg-accent/50 lg:table-row ${aberta ? "bg-accent/40" : ""} ${!p.ativo ? "opacity-60" : ""}`}>
        <td className="block px-4 pt-3 lg:table-cell lg:py-3">
          <div className="flex items-center gap-3">
            <Avatar nome={p.nome} url={p.avatar_url} className="h-9 w-9 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground sm:truncate">{p.nome}</p>
              <p className="break-all text-xs text-muted-foreground sm:truncate sm:break-normal">{quem}</p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform lg:hidden ${aberta ? "rotate-180" : ""}`} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-12">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.tipo === "cliente" ? "bg-muted text-muted-foreground" : "bg-q-onix text-q-gold"}`}>{perfil}</span>
            {!p.ativo && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Desativado</span>}
          </div>
        </td>
        <td className="block px-4 pt-2 lg:table-cell lg:py-3 lg:pl-4">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${sit.texto}`}>
            <span className={`h-2 w-2 rounded-full ${sit.ponto}`} /> {sit.rotulo}
          </span>
        </td>
        <td className="block px-4 lg:table-cell lg:py-3">
          {p.ultimo_acesso ? (
            <>
              <p className="text-sm font-medium text-foreground">{haQuanto(p.ultimo_acesso)}</p>
              <p className="text-xs text-muted-foreground">{dataHoraBR(p.ultimo_acesso)}</p>
            </>
          ) : <span className="text-xs text-muted-foreground">—</span>}
        </td>
        <td className="block px-4 text-xs text-muted-foreground lg:table-cell lg:py-3">
          {nomeApp(p.app) ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              {p.app === "portal" ? <Globe className="h-3.5 w-3.5 text-q-petrol" /> : <Monitor className="h-3.5 w-3.5 text-q-gold" />}
              {nomeApp(p.app)}
            </span>
          ) : <span>—</span>}
          {p.ip && <p className="font-mono text-[11px]">{p.ip}</p>}
        </td>
        <td className="block px-4 text-xs text-muted-foreground lg:table-cell lg:py-3">
          {disp ? (
            <span className="inline-flex items-center gap-1.5">
              {disp.celular ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />} {disp.texto}
            </span>
          ) : "—"}
        </td>
        <td className="block px-4 pb-3 text-xs text-muted-foreground lg:table-cell lg:py-3 lg:text-right lg:text-sm">
          <span className="font-semibold tabular-nums text-foreground">{n(p.acessos_30d)}</span>
          <span className="lg:hidden"> login{p.acessos_30d === 1 ? "" : "s"} em 30 dias</span>
        </td>
        <td className="hidden pr-4 lg:table-cell">
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${aberta ? "rotate-180" : ""}`} />
        </td>
      </tr>
      {aberta && (
        <tr className="block lg:table-row">
          <td colSpan={7} className="block bg-muted/30 lg:table-cell"><Historico userId={p.user_id} /></td>
        </tr>
      )}
    </>
  );
}

function Historico({ userId }: { userId: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["acessos", "de", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("q_acessos_de", { p_user: userId, p_limite: 30 });
      if (error) throw new Error(mensagemDeErro(error));
      return data as Acesso[];
    },
  });
  if (isLoading) return <p className="px-4 py-3 text-sm text-muted-foreground">Carregando…</p>;
  if (error) return <p className="px-4 py-3 text-sm text-destructive">{(error as Error).message}</p>;
  if (data.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum login registrado.</p>;
  return (
    <div className="px-4 py-3">
      <p className="q-titulo-marca mb-2 text-[11px] text-muted-foreground">Histórico de logins · {n(data.length)}</p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card lg:hidden">
        {data.map((a) => {
          const d = dispositivo(a.user_agent);
          return (
            <li key={a.id} className="flex items-start gap-2.5 px-3 py-2 text-xs">
              {a.app === "portal" ? <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-q-petrol" /> : <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-q-gold" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{dataHoraBR(a.created_at)} · {nomeApp(a.app)}</p>
                <p className="break-all text-muted-foreground">{[a.ip, d?.texto].filter(Boolean).join(" · ") || "—"}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <table className="w-full text-xs">
          <thead className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Data e hora</th>
              <th className="px-3 py-2 font-medium">Sistema</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Dispositivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((a) => {
              const d = dispositivo(a.user_agent);
              return (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{dataHoraBR(a.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      {a.app === "portal" ? <Globe className="h-3.5 w-3.5 text-q-petrol" /> : <Monitor className="h-3.5 w-3.5 text-q-gold" />}
                      {nomeApp(a.app)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{a.ip ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {d ? <span className="inline-flex items-center gap-1.5">{d.celular ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />} {d.texto}</span> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
