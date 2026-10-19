import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Globe, Loader2, Monitor, Search } from "lucide-react";
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

interface Pessoa {
  user_id: string; nome: string; identificador: string | null; tipo: "equipe" | "cliente";
  papel: "admin" | "gestor" | "colaborador" | null; ativo: boolean; avatar_url: string | null; banned_until: string | null;
  ultimo_acesso: string | null; ip: string | null; app: "admin" | "portal" | null; acessos_30d: number;
}
interface Contagem { todos: number; equipe: number; clientes: number }
interface Acesso { id: string; app: "admin" | "portal"; ip: string | null; user_agent: string | null; created_at: string }

function haQuanto(iso: string | null) {
  if (!iso) return "nunca entrou";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

/** "Chrome · Windows" a partir do navegador gravado. */
function navegador(ua: string | null) {
  if (!ua) return null;
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const s = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return [b, s].filter(Boolean).join(" · ");
}

export default function Acessos() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <PaginaNaoEncontrada />;
  return <Lista />;
}

function Lista() {
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [tipo, setTipo] = useParamUrl("tipo", "todos");
  const [aberto, setAberto] = useParamUrl("pessoa", "");
  const pag = usePaginacaoUrl();
  const termo = useAtrasado(busca);
  const { data, isLoading, isFetching, error } = useRpcPagina<Pessoa, Contagem>(["acessos", "pessoas"], "q_acessos_pessoas", {
    p_busca: termo, p_tipo: tipo, p_pagina: pag.pagina, p_por: pag.por,
  }, { refetchInterval: 60_000 });
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { todos: 0, equipe: 0, clientes: 0 };
  const total = tipo === "equipe" ? cont.equipe : tipo === "clientes" ? cont.clientes : cont.todos;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div>
      <PageHeader titulo="Últimos acessos" />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
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
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : lista.length === 0 ? <Vazio texto="Ninguém com esse filtro." /> : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {lista.map((p) => {
                const ab = aberto === p.user_id;
                const quem = p.tipo === "cliente" ? formatarDocumento(p.identificador ?? "") : p.identificador;
                return (
                  <li key={p.user_id}>
                    <button type="button" onClick={() => setAberto(ab ? "" : p.user_id)} aria-expanded={ab}
                      className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/50">
                      <Avatar nome={p.nome} url={p.avatar_url} className="h-10 w-10 text-sm" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground sm:truncate">{p.nome}</p>
                        <p className="break-all text-xs text-muted-foreground sm:truncate sm:break-normal">{quem}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.tipo === "cliente" ? "bg-muted text-muted-foreground" : "bg-q-onix text-q-gold"}`}>
                            {p.tipo === "cliente" ? "Cliente" : p.papel ? PAPEL_LABEL[p.papel] : "Equipe"}
                          </span>
                          {!p.ativo && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Desativado</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm ${p.ultimo_acesso ? "font-medium text-foreground" : "text-muted-foreground"}`}>{haQuanto(p.ultimo_acesso)}</p>
                        {p.ultimo_acesso && <p className="text-xs text-muted-foreground">{dataHoraBR(p.ultimo_acesso)}</p>}
                        <p className="text-xs text-muted-foreground">{n(p.acessos_30d)} em 30 dias</p>
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${ab ? "rotate-180" : ""}`} />
                    </button>
                    {ab && <Historico userId={p.user_id} />}
                  </li>
                );
              })}
            </ul>
            <Paginacao pagina={pag.pagina} por={pag.por} total={total} onPagina={pag.irPara} onPor={pag.mudarPor} />
          </>
        )}
      </div>
    </div>
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
  return (
    <div className="border-t border-border bg-muted/30 px-4 py-3">
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p>
        : error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
        : data.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum acesso registrado.</p> : (
          <ol className="space-y-2">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                {a.app === "portal" ? <Globe className="h-4 w-4 shrink-0 text-q-petrol" /> : <Monitor className="h-4 w-4 shrink-0 text-q-gold" />}
                <span className="font-medium text-foreground">{dataHoraBR(a.created_at)}</span>
                <span className="text-xs text-muted-foreground">{a.app === "portal" ? "Portal do Cliente" : "Admin"}</span>
                {a.ip && <span className="text-xs text-muted-foreground">IP {a.ip}</span>}
                {navegador(a.user_agent) && <span className="text-xs text-muted-foreground">{navegador(a.user_agent)}</span>}
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}
