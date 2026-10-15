import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Archive, Bot, FileText, Loader2, MessageSquare, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chips } from "@/components/Chips";
import { Carregando, Falha } from "@/components/Estados";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { useAtrasado } from "@/hooks/usePagina";
import { Conversa } from "@/components/atendimento/Conversa";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartamentos, useEquipe } from "@/hooks/useCadastros";
import { useCaixaPagina, useDefinirResponsavel, useItemCaixa, type ItemCaixa } from "@/hooks/useCaixa";
import { useParamUrl } from "@/shell";
import { dataHoraBR } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// A caixa do chat do portal. O cliente abre o atendimento pelo robô do portal;
// aqui a equipe lê, responde e arquiva. Lista à esquerda, conversa à direita
// (no celular, uma de cada vez). Filtros e conversa aberta moram na URL.
// ─────────────────────────────────────────────────────────────────────────────

const TODOS = "todos";

function quando(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function Atendimentos() {
  const { isGestor } = useAuth();
  const { data: departamentos = [] } = useDepartamentos();
  const [aba, setAba] = useParamUrl("aba", "abertos");
  const [setor, setSetor] = useParamUrl("setor", TODOS);
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [abertoId, setAbertoId] = useParamUrl("atendimento", "");
  const pag = usePaginacaoUrl();

  const termo = useAtrasado(busca);
  const { data, isLoading, isFetching, error } = useCaixaPagina({
    busca: termo, setor: setor === TODOS ? null : setor, aba, pagina: pag.pagina, por: pag.por,
  });
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { abertos: 0, nao_lidas: 0, arquivados: 0 };
  const total = aba === "arquivados" ? cont.arquivados : aba === "nao_lidas" ? cont.nao_lidas : cont.abertos;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };

  // O aberto vem por ID: pode estar fora da página visível (link, aviso do painel).
  const { data: aberto } = useItemCaixa(abertoId || null);
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        titulo="Atendimentos"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-8 md:flex-row">
        {/* ── lista ─────────────────────────────────────────────────────── */}
        <section className={`flex min-h-0 flex-col md:w-[380px] md:shrink-0 ${abertoId ? "hidden md:flex" : "flex"}`}>
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar cliente, assunto ou nº" className="bg-card pl-9" />
              {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chips
                valor={aba}
                onChange={filtrar(setAba)}
                opcoes={[
                  { valor: "abertos", rotulo: `Abertos (${n(cont.abertos)})` },
                  { valor: "nao_lidas", rotulo: `Não lidos (${n(cont.nao_lidas)})` },
                  { valor: "arquivados", rotulo: `Arquivados (${n(cont.arquivados)})` },
                ]}
              />
            </div>
            <Select value={setor} onValueChange={filtrar(setSetor)}>
              <SelectTrigger className="bg-card" aria-label="Setor"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os setores</SelectItem>
                {departamentos.filter((d) => d.atende_chat || d.id === setor).map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card">
            {isLoading ? (
              <div className="p-4"><Carregando /></div>
            ) : error ? (
              <div className="p-3"><Falha erro={error as Error} /></div>
            ) : lista.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {cont.abertos + cont.arquivados === 0 && !termo
                  ? "Nenhum atendimento ainda."
                  : aba === "nao_lidas" ? "Nada por ler. 🎉" : "Nenhum atendimento com esse filtro."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {lista.map((i) => <ItemLista key={i.id} i={i} ativo={i.id === abertoId} onClick={() => setAbertoId(i.id)} />)}
              </ul>
            )}
          </div>
          <Paginacao pagina={pag.pagina} por={pag.por} total={total} onPagina={pag.irPara} onPor={pag.mudarPor} />
        </section>

        {/* ── conversa ──────────────────────────────────────────────────── */}
        <section className={`min-h-0 flex-1 flex-col rounded-xl border border-border bg-card p-3 sm:p-4 ${abertoId ? "flex" : "hidden md:flex"}`}>
          {aberto ? (
            <Painel item={aberto} onVoltar={() => setAbertoId("")} />
          ) : abertoId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Carregando…</div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8" />
              <p className="text-sm">Escolha um atendimento na lista.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ItemLista({ i, ativo, onClick }: { i: ItemCaixa; ativo: boolean; onClick: () => void }) {
  const doCliente = i.ultima_autor_tipo === "cliente";
  return (
    <li>
      <button type="button" onClick={onClick}
        className={`flex w-full gap-3 p-3 text-left transition-colors ${ativo ? "bg-accent" : "hover:bg-accent/50"}`}>
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${i.nao_lidas > 0 ? "bg-q-gold" : "bg-transparent"}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={`min-w-0 flex-1 truncate text-sm ${i.nao_lidas > 0 ? "font-semibold" : "font-medium"} text-foreground`}>{i.cliente_nome}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground">{quando(i.ultima_em ?? i.created_at)}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">#{i.numero} · {i.setor_nome ?? "—"} · {i.titulo}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-foreground/80">
            {i.arquivado_em && <Archive className="h-3 w-3 shrink-0 text-muted-foreground" />}
            {i.ultima_autor_tipo === "robo" && <Bot className="h-3 w-3 shrink-0" />}
            <span className="truncate">{i.ultima_corpo ? `${doCliente ? "" : "Você: "}${i.ultima_corpo}` : "Sem mensagens"}</span>
          </p>
        </div>
        {i.nao_lidas > 0 && (
          <span className="mt-0.5 h-5 min-w-5 shrink-0 rounded-full bg-q-gold px-1.5 text-center text-[11px] font-bold leading-5 text-q-onix">{i.nao_lidas}</span>
        )}
      </button>
    </li>
  );
}

function Painel({ item, onVoltar }: { item: ItemCaixa; onVoltar: () => void }) {
  const { isGestor } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const definir = useDefinirResponsavel();

  const trocarResponsavel = async (id: string) => {
    try {
      await definir.mutateAsync({ id: item.id, responsavelId: id === "ninguem" ? null : id });
      toast.success("Responsável atualizado.");
    } catch (e) {
      toast.error("Não foi possível trocar o responsável.", { description: (e as Error).message });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3 text-xs text-muted-foreground">
        <span>Aberto em {dataHoraBR(item.created_at)}</span>
        {item.contrato_id && (
          <Link to={`/contratos?contrato=${item.contrato_id}`} className="q-link inline-flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> Contrato #{item.contrato_numero}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-2">
          Responsável:
          {isGestor ? (
            <Select value={item.responsavel_id ?? "ninguem"} onValueChange={trocarResponsavel}>
              <SelectTrigger className="h-8 w-44" aria-label="Responsável"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguem">Ninguém</SelectItem>
                {equipe.filter((p) => p.ativo || p.id === item.responsavel_id).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <strong className="text-foreground">{item.responsavel_nome ?? "Ninguém"}</strong>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Conversa
          cheia
          onVoltar={onVoltar}
          atendimento={{
            id: item.id, numero: item.numero, arquivado_em: item.arquivado_em,
            setorNome: item.setor_nome, titulo: item.titulo, clienteNome: item.cliente_nome,
          }}
        />
      </div>
    </div>
  );
}
