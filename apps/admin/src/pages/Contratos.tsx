import { useState } from "react";
import { Globe, Loader2, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { ContratoDetalhe } from "@/components/pipeline/ContratoDetalhe";
import { NovoCardDialog } from "@/components/pipeline/NovoCardDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe, useEtapas } from "@/hooks/useCadastros";
import { useAtrasado, useRpcPagina } from "@/hooks/usePagina";
import type { LinhaContrato } from "@/hooks/usePipeline";
import { useParamUrl } from "@/shell";
import { dataBR, diasDesde, formatarDocumento } from "@/lib/formato";

// A carteira em LISTA, uma página por vez (`q_contratos_pagina`): procurar,
// filtrar e conferir. Abrir um contrato mostra o MESMO painel da Pipeline.

const TODAS = "todas";
type Contagem = { todos: number; ativos: number; andamento: number; portal: number; perdido: number };

export default function Contratos() {
  const { isGestor } = useAuth();
  const { data: etapas = [] } = useEtapas();
  const { data: equipe = [] } = useEquipe();
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [filtro, setFiltro] = useParamUrl("situacao", "todos");
  const [etapa, setEtapa] = useParamUrl("etapa", TODAS);
  const [consultor, setConsultor] = useParamUrl("consultor", TODAS);
  const [abertoId, setAbertoId] = useParamUrl("contrato", "");
  const pag = usePaginacaoUrl();
  const [novo, setNovo] = useState(false);

  const termo = useAtrasado(busca);
  const { data, isLoading, isFetching, error } = useRpcPagina<LinhaContrato, Contagem>(["contratos", "pagina"], "q_contratos_pagina", {
    p_busca: termo,
    p_etapa: etapa === TODAS ? null : etapa,
    p_consultor: consultor === TODAS ? null : consultor,
    p_situacao: filtro,
    p_pagina: pag.pagina,
    p_por: pag.por,
  });
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { todos: 0, ativos: 0, andamento: 0, portal: 0, perdido: 0 };
  const total = (cont as unknown as Record<string, number>)[filtro] ?? cont.todos;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div>
      <PageHeader
        titulo="Contratos"
        acoes={<Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo contrato</Button>}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ, placa ou nº" className="bg-card pl-9" />
          {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <Select value={etapa} onValueChange={filtrar(setEtapa)}>
          <SelectTrigger className="w-full bg-card sm:w-56" aria-label="Etapa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as etapas</SelectItem>
            {etapas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        {isGestor && (
          <Select value={consultor} onValueChange={filtrar(setConsultor)}>
            <SelectTrigger className="w-full bg-card sm:w-52" aria-label="Consultor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todos os consultores</SelectItem>
              {equipe.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Chips
          valor={filtro}
          onChange={filtrar(setFiltro)}
          opcoes={[
            { valor: "todos", rotulo: `Todos (${n(cont.todos)})` },
            { valor: "andamento", rotulo: `Em andamento (${n(cont.andamento)})` },
            { valor: "portal", rotulo: `No portal (${n(cont.portal)})` },
            { valor: "perdido", rotulo: `Perdidos (${n(cont.perdido)})` },
          ]}
        />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? (
          <Carregando />
        ) : error ? (
          <Falha erro={error as Error} />
        ) : lista.length === 0 ? (
          <Vazio texto={cont.todos === 0 && !termo && etapa === TODAS && consultor === TODAS ? "Nenhum contrato ainda." : "Nenhum contrato com esse filtro."} />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="hidden border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground md:table-header-group">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Nº</th>
                    <th className="px-4 py-2.5 font-medium">Cliente</th>
                    <th className="px-4 py-2.5 font-medium">Etapa</th>
                    <th className="px-4 py-2.5 font-medium">Banco · linha</th>
                    <th className="px-4 py-2.5 font-medium">Consultor</th>
                    <th className="px-4 py-2.5 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lista.map((c) => {
                    const dias = diasDesde(c.etapa_desde);
                    return (
                      <tr key={c.id} onClick={() => setAbertoId(c.id)} className={`block cursor-pointer hover:bg-accent/50 md:table-row ${c.situacao === "perdido" ? "opacity-70" : ""}`}>
                        <td className="inline-block px-4 pt-3 font-titulo text-xs font-semibold text-muted-foreground md:table-cell md:py-3 md:text-sm md:text-foreground">#{c.numero}</td>
                        <td className="block px-4 md:table-cell md:py-3">
                          <p className="font-medium text-foreground">{c.cliente_nome ?? "Cliente de outra carteira"}</p>
                          <p className="text-xs text-muted-foreground">{c.cliente_documento ? formatarDocumento(c.cliente_documento) : "—"}{c.placa ? ` · ${c.placa}` : ""}</p>
                        </td>
                        <td className="block px-4 md:table-cell md:py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.etapa_cor ?? "#94A3B8" }} />
                            {c.etapa_nome ?? "—"}
                          </span>
                          {!c.cancelado_em && <p className={`text-[11px] ${dias >= 7 ? "text-destructive" : dias >= 3 ? "text-warning" : "text-muted-foreground"}`}>{dias} dia{dias === 1 ? "" : "s"} nesta etapa</p>}
                        </td>
                        <td className="block px-4 text-xs text-muted-foreground md:table-cell md:py-3 md:text-sm">
                          {[c.banco_nome, c.linha_nome].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="block px-4 text-xs text-muted-foreground md:table-cell md:py-3 md:text-sm md:text-foreground">
                          <span className="md:hidden">Consultor: </span>{c.consultor_nome ?? "Sem consultor"}
                        </td>
                        <td className="block px-4 pb-3 md:table-cell md:py-3">
                          {c.situacao === "perdido" ? (
                            <span className="text-xs font-medium text-destructive">Perdido em {dataBR(c.cancelado_em)}</span>
                          ) : c.situacao === "portal" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-q-onix px-2 py-0.5 text-[11px] font-medium text-q-gold"><Globe className="h-3 w-3" /> No portal desde {dataBR(c.data_aceite)}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Em andamento</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacao pagina={pag.pagina} por={pag.por} total={total} onPagina={pag.irPara} onPor={pag.mudarPor} />
          </>
        )}
      </div>

      <NovoCardDialog aberto={novo} etapaInicial={null} onFechar={() => setNovo(false)} />
      <ContratoDetalhe contratoId={abertoId || null} onFechar={() => setAbertoId("")} />
    </div>
  );
}
