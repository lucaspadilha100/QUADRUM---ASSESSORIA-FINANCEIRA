import { useMemo, useState } from "react";
import { Globe, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { ContratoDetalhe } from "@/components/pipeline/ContratoDetalhe";
import { NovoCardDialog } from "@/components/pipeline/NovoCardDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useEtapas } from "@/hooks/useCadastros";
import { useContratosPipeline, type ContratoPipeline } from "@/hooks/usePipeline";
import { useParamUrl } from "@/shell";
import { dataBR, diasDesde, formatarDocumento, soDigitos } from "@/lib/formato";

// A mesma carteira da Pipeline, em LISTA: para procurar, filtrar e conferir.
// Abrir um contrato mostra o MESMO painel da Pipeline (ContratoDetalhe).

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const TODAS = "todas";

type Situacao = "andamento" | "portal" | "perdido";
const situacao = (c: ContratoPipeline): Situacao => (c.cancelado_em ? "perdido" : c.data_aceite ? "portal" : "andamento");

export default function Contratos() {
  const { isGestor } = useAuth();
  const { data: contratos = [], isLoading, error } = useContratosPipeline();
  const { data: etapas = [] } = useEtapas();
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [filtro, setFiltro] = useParamUrl("situacao", "todos");
  const [etapa, setEtapa] = useParamUrl("etapa", TODAS);
  const [abertoId, setAbertoId] = useParamUrl("contrato", "");
  const [novo, setNovo] = useState(false);

  const conta = (s: Situacao) => contratos.filter((c) => situacao(c) === s).length;
  const etapaDe = (id: string) => etapas.find((e) => e.id === id);

  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    const dig = soDigitos(busca);
    return contratos
      .filter((c) => filtro === "todos" || situacao(c) === filtro)
      .filter((c) => etapa === TODAS || c.etapa_id === etapa)
      .filter((c) => !t
        || semAcento(c.cliente?.nome ?? "").includes(t)
        || (dig.length >= 3 && (c.cliente?.documento ?? "").includes(dig))
        || semAcento(c.placa ?? "").includes(t)
        || String(c.numero) === t.replace("#", ""))
      .sort((a, b) => b.numero - a.numero);
  }, [contratos, busca, filtro, etapa]);

  const aberto = contratos.find((c) => c.id === abertoId) ?? null;

  return (
    <div>
      <PageHeader
        titulo="Contratos"
        descricao={isGestor ? "Todos os contratos da Quadrum." : "Os contratos da sua carteira."}
        acoes={<Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo contrato</Button>}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ, placa ou nº" className="bg-card pl-9" />
        </div>
        <Select value={etapa} onValueChange={setEtapa}>
          <SelectTrigger className="w-full bg-card sm:w-56" aria-label="Etapa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as etapas</SelectItem>
            {etapas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Chips
          valor={filtro}
          onChange={setFiltro}
          opcoes={[
            { valor: "todos", rotulo: `Todos (${contratos.length})` },
            { valor: "andamento", rotulo: `Em andamento (${conta("andamento")})` },
            { valor: "portal", rotulo: `No portal (${conta("portal")})` },
            { valor: "perdido", rotulo: `Perdidos (${conta("perdido")})` },
          ]}
        />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? (
          <Carregando />
        ) : error ? (
          <Falha erro={error as Error} />
        ) : lista.length === 0 ? (
          <Vazio texto={contratos.length === 0 ? "Nenhum contrato ainda. Crie o primeiro pelo botão Novo contrato." : "Nenhum contrato com esse filtro."} />
        ) : (
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
                  const e = etapaDe(c.etapa_id);
                  const s = situacao(c);
                  const dias = diasDesde(c.etapa_desde);
                  return (
                    <tr key={c.id} onClick={() => setAbertoId(c.id)} className={`block cursor-pointer hover:bg-accent/50 md:table-row ${s === "perdido" ? "opacity-70" : ""}`}>
                      <td className="inline-block px-4 pt-3 font-titulo text-xs font-semibold text-muted-foreground md:table-cell md:py-3 md:text-sm md:text-foreground">#{c.numero}</td>
                      <td className="block px-4 md:table-cell md:py-3">
                        <p className="font-medium text-foreground">{c.cliente?.nome ?? "Cliente de outra carteira"}</p>
                        <p className="text-xs text-muted-foreground">{c.cliente ? formatarDocumento(c.cliente.documento) : "—"}{c.placa ? ` · ${c.placa}` : ""}</p>
                      </td>
                      <td className="block px-4 md:table-cell md:py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e?.cor ?? "#94A3B8" }} />
                          {e?.nome ?? "—"}
                        </span>
                        {!c.cancelado_em && <p className={`text-[11px] ${dias >= 7 ? "text-destructive" : dias >= 3 ? "text-warning" : "text-muted-foreground"}`}>{dias} dia{dias === 1 ? "" : "s"} nesta etapa</p>}
                      </td>
                      <td className="block px-4 text-xs text-muted-foreground md:table-cell md:py-3 md:text-sm">
                        {[c.banco?.nome, c.linha?.nome].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="block px-4 text-xs text-muted-foreground md:table-cell md:py-3 md:text-sm md:text-foreground">
                        <span className="md:hidden">Consultor: </span>{c.consultor?.nome ?? "Sem consultor"}
                      </td>
                      <td className="block px-4 pb-3 md:table-cell md:py-3">
                        {s === "perdido" ? (
                          <span className="text-xs font-medium text-destructive">Perdido em {dataBR(c.cancelado_em)}</span>
                        ) : s === "portal" ? (
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
        )}
      </div>

      <NovoCardDialog aberto={novo} etapaInicial={null} onFechar={() => setNovo(false)} />
      <ContratoDetalhe contrato={aberto} onFechar={() => setAbertoId("")} />
    </div>
  );
}
