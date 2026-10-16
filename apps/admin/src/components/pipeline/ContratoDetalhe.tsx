import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Archive, ArrowLeft, Bell, Eye, Globe, Loader2, MessageSquare, RotateCcw, UserPen, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmar, pedirTexto, useParamUrl } from "@/shell";
import { useAuth } from "@/contexts/AuthContext";
import {
  useDepartamentos, useEquipe, useEtapas, useLinhasCredito, useUnidades,
} from "@/hooks/useCadastros";
import {
  LIMITE_HISTORICO, useAtendimentosDoContrato, useAtualizarContrato, useContrato, useHistorico,
  useLancarOcorrencia, type ContratoPipeline,
} from "@/hooks/usePipeline";
import { DocumentosDoContrato } from "@/components/documento/DocumentosDoContrato";
import { Conversa } from "@/components/atendimento/Conversa";
import { SelectBanco } from "@/components/SelectBanco";
import { AcessoPortal } from "@/components/AcessoPortal";
import { EdicaoCliente } from "@/components/clientes/ClientePainel";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// O card aberto. As abas são as MESMAS do Portal do Cliente (Dados, Histórico,
// Atendimentos) mais as Pendências — porque tudo o que o cliente lê lá é
// escrito aqui. Cada aba diz, na própria tela, o que o cliente vai ver.
// ─────────────────────────────────────────────────────────────────────────────

const NENHUM = "nenhum";

// O painel lê o contrato pelo ID, direto do banco: a lista ao lado é uma
// PÁGINA, e o link direto (?contrato=…) tem de abrir mesmo fora dela.
// O "falta RG" troca de ABA aqui dentro, em vez de mandar para outra tela —
// antes não havia como voltar. `?painel=cliente` só ABRE o painel numa aba
// (é o que a tela de Documentos usa); trocar de aba depois fica no painel.
// ⚠️ Trocar de aba NÃO grava no histórico: uma entrada nova por cima apagava a
// marca do "Voltar fecha o diálogo", e confirmar qualquer coisa dentro do
// painel (cancelar documento) passava a FECHAR o painel inteiro.
export function ContratoDetalhe({ contratoId, onFechar }: { contratoId: string | null; onFechar: () => void }) {
  const [, setPainel] = useParamUrl("painel", "dados");
  return (
    <Sheet open={!!contratoId} onOpenChange={(o) => { if (!o) { setPainel(null); onFechar(); } }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {contratoId && <ContratoPainel contratoId={contratoId} />}
      </SheetContent>
    </Sheet>
  );
}

/** O contrato inteiro, para morar dentro de uma barra lateral. `voltar` põe o "← Voltar" no topo. */
export function ContratoPainel({ contratoId, voltar }: { contratoId: string; voltar?: { rotulo: string; onClick: () => void } }) {
  const { data: contrato, isLoading, error } = useContrato(contratoId);
  return (
    <>
      {voltar && (
        <button type="button" onClick={voltar.onClick}
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-q-petrol hover:underline">
          <ArrowLeft className="h-4 w-4" /> {voltar.rotulo}
        </button>
      )}
      {isLoading ? (
        <p className="flex items-center gap-2 pt-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : error ? (
        <p className="pt-10 text-sm text-destructive">Não foi possível abrir o contrato: {(error as Error).message}</p>
      ) : contrato ? (
        <Conteudo key={contrato.id} c={contrato} />
      ) : (
        <p className="pt-10 text-sm text-muted-foreground">Contrato não encontrado — ou é de outra carteira.</p>
      )}
    </>
  );
}

function Conteudo({ c }: { c: ContratoPipeline }) {
  const { data: etapas = [] } = useEtapas();
  const etapaAceite = etapas.find((e) => e.aceita && e.ativo);
  const [painelUrl] = useParamUrl("painel", "dados");
  const [aba, setAba] = useState(painelUrl);
  // Sem o cliente (é de outra carteira), não há aba Cliente para abrir.
  const abaVisivel = aba === "cliente" && !c.cliente ? "dados" : aba;
  return (
    <>
      <SheetHeader className="pr-8 text-left">
        <p className="font-titulo text-xs font-semibold text-muted-foreground">CONTRATO #{c.numero}</p>
        <SheetTitle className="text-xl">{c.cliente?.nome ?? "Cliente de outra carteira"}</SheetTitle>
        <SheetDescription>
          {c.cliente ? formatarDocumento(c.cliente.documento) : ""}
          {c.cliente?.telefone ? ` · ${c.cliente.telefone}` : ""}
        </SheetDescription>
        {/* O estado que liga ao portal, sempre à vista. */}
        <div className="pt-1">
          {c.cancelado_em ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Perdido em {dataBR(c.cancelado_em)}
            </span>
          ) : c.data_aceite ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-q-onix px-2.5 py-1 text-xs font-medium text-q-gold">
              <Globe className="h-3.5 w-3.5" /> No portal desde {dataBR(c.data_aceite)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" /> Fora do portal
            </span>
          )}
        </div>
      </SheetHeader>

      <Tabs value={abaVisivel} onValueChange={(v) => setAba(v)} className="mt-5">
        <TabsList className={`flex w-full sm:grid ${c.cliente ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          <TabsTrigger value="dados" className="shrink-0 px-3 text-sm sm:px-1">Contrato</TabsTrigger>
          {c.cliente && <TabsTrigger value="cliente" className="shrink-0 px-3 text-sm sm:px-1">Cliente</TabsTrigger>}
          <TabsTrigger value="historico" className="shrink-0 px-3 text-sm sm:px-1">Histórico</TabsTrigger>
          <TabsTrigger value="documentos" className="shrink-0 px-3 text-sm sm:px-1">Pendências</TabsTrigger>
          <TabsTrigger value="atendimentos" className="shrink-0 px-3 text-sm sm:px-1">Chat</TabsTrigger>
        </TabsList>
        <TabsContent value="dados"><AbaDados c={c} onEditarCliente={() => setAba("cliente")} /></TabsContent>
        {c.cliente && (
          <TabsContent value="cliente" className="pt-2">
            <EdicaoCliente clienteId={c.cliente.id} />
          </TabsContent>
        )}
        <TabsContent value="historico"><AbaHistorico contratoId={c.id} /></TabsContent>
        <TabsContent value="documentos">
          <DocumentosDoContrato contrato={c} onCompletar={(onde) => setAba(onde === "cliente" ? "cliente" : "dados")} />
        </TabsContent>
        <TabsContent value="atendimentos"><AbaAtendimentos contratoId={c.id} /></TabsContent>
      </Tabs>
    </>
  );
}

// ── Dados ────────────────────────────────────────────────────────────────────

function AbaDados({ c, onEditarCliente }: { c: ContratoPipeline; onEditarCliente: () => void }) {
  const { isGestor, perfil } = useAuth();
  const { data: etapas = [] } = useEtapas();
  const { data: linhas = [] } = useLinhasCredito();
  const { data: equipe = [] } = useEquipe();
  const atualizar = useAtualizarContrato();

  const [etapaId, setEtapaId] = useState(c.etapa_id);
  const [bancoId, setBancoId] = useState(c.banco_id ?? NENHUM);
  const [linhaId, setLinhaId] = useState(c.linha_credito_id ?? NENHUM);
  const [veiculo, setVeiculo] = useState(c.veiculo ?? "");
  const [anoModelo, setAnoModelo] = useState(c.ano_modelo ?? "");
  const [placa, setPlaca] = useState(c.placa ?? "");
  const [consultorId, setConsultorId] = useState(c.consultor_id ?? NENHUM);
  const [observacoes, setObservacoes] = useState(c.observacoes ?? "");
  const { data: unidades = [] } = useUnidades();
  // A unidade não vem na lista (é um campo só do card): lê-se à parte.
  const { data: unidadeAtual } = useQuery({
    queryKey: ["contrato", c.id, "unidade"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("unidade_id").eq("id", c.id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.unidade_id as string | null) ?? null;
    },
  });
  const [unidadeId, setUnidadeId] = useState(NENHUM);
  useEffect(() => { setUnidadeId(unidadeAtual ?? NENHUM); }, [unidadeAtual]);

  useEffect(() => {
    setEtapaId(c.etapa_id); setBancoId(c.banco_id ?? NENHUM); setLinhaId(c.linha_credito_id ?? NENHUM);
    setVeiculo(c.veiculo ?? ""); setAnoModelo(c.ano_modelo ?? ""); setPlaca(c.placa ?? "");
    setConsultorId(c.consultor_id ?? NENHUM); setObservacoes(c.observacoes ?? "");
    // ⚠️ Pelos VALORES, não pelo objeto: a tela relê sozinha (ao vivo) e um
    // objeto novo com os mesmos dados apagaria o que a pessoa está digitando.
  }, [c.id, c.etapa_id, c.banco_id, c.linha_credito_id, c.veiculo, c.ano_modelo, c.placa, c.consultor_id, c.observacoes]);

  const linha = linhas.find((l) => l.id === linhaId);
  const vazio = (s: string) => s.trim() || null;
  const opc = (v: string) => (v === NENHUM ? null : v);

  const salvar = async () => {
    const campos: Record<string, unknown> = {
      etapa_id: etapaId,
      banco_id: opc(bancoId),
      linha_credito_id: opc(linhaId),
      veiculo: vazio(veiculo),
      ano_modelo: vazio(anoModelo),
      placa: vazio(placa)?.toUpperCase() ?? null,
      observacoes: vazio(observacoes),
      unidade_id: opc(unidadeId),
    };
    // Transferir de consultor é do gestor (a RLS recusaria o colaborador).
    if (isGestor) campos.consultor_id = opc(consultorId);
    try {
      await atualizar.mutateAsync({ id: c.id, campos });
      toast.success("Contrato salvo.");
    } catch (e) {
      toast.error("Não foi possível salvar.", { description: (e as Error).message });
    }
  };

  const perder = async () => {
    const motivo = await pedirTexto({
      titulo: "Marcar como perdido?",
      mensagem: "O contrato sai da pipeline. Se o cliente já o vê no portal, ele passa a aparecer como CONTRATO CANCELADO.",
      rotulo: "Motivo",
      multilinha: true,
      obrigatorio: true,
      confirmar: "Marcar como perdido",
      perigo: true,
    });
    if (!motivo) return;
    try {
      await atualizar.mutateAsync({
        id: c.id,
        campos: { cancelado_em: new Date().toISOString(), cancelado_por: perfil?.id ?? null, motivo_cancelamento: motivo.trim() },
      });
      toast.success("Contrato marcado como perdido.");
    } catch (e) {
      toast.error("Não foi possível marcar.", { description: (e as Error).message });
    }
  };

  const reabrir = async () => {
    if (!(await confirmar({ titulo: "Reabrir o contrato?", mensagem: "Ele volta para a pipeline, na etapa em que estava.", confirmar: "Reabrir" }))) return;
    try {
      await atualizar.mutateAsync({ id: c.id, campos: { cancelado_em: null, cancelado_por: null, motivo_cancelamento: null } });
      toast.success("Contrato reaberto.");
    } catch (e) {
      toast.error("Não foi possível reabrir.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {c.cliente && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-foreground">{c.cliente.nome}</p>
          <p className="text-muted-foreground">
            {formatarDocumento(c.cliente.documento)}
            {c.cliente.telefone ? ` · ${c.cliente.telefone}` : ""}
            {c.cliente.email ? ` · ${c.cliente.email}` : ""}
          </p>
          <AcessoPortal cliente={c.cliente} />
          <button type="button" onClick={onEditarCliente} className="q-link mt-2 inline-flex items-center gap-1 text-xs font-medium">
            <UserPen className="h-3.5 w-3.5" /> Editar dados do cliente
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Etapa">
          <Select value={etapaId} onValueChange={setEtapaId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {etapas.filter((e) => e.ativo || e.id === c.etapa_id).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Consultor">
          {isGestor ? (
            <Select value={consultorId} onValueChange={setConsultorId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Sem consultor</SelectItem>
                {equipe.filter((p) => p.ativo || p.id === c.consultor_id).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={c.consultor?.nome ?? "Sem consultor"} disabled />
          )}
        </Campo>
        <Campo rotulo="Banco">
          <SelectBanco valor={bancoId} onChange={setBancoId} manterId={c.banco_id} />
        </Campo>
        <Campo rotulo="Unidade">
          <Select value={unidadeId} onValueChange={setUnidadeId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Sem unidade</SelectItem>
              {unidades.filter((u) => u.ativo || u.id === unidadeAtual).map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.nome}{u.cidade ? ` — ${u.cidade}${u.uf ? `/${u.uf}` : ""}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Linha de crédito">
          <Select value={linhaId} onValueChange={setLinhaId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Não informada</SelectItem>
              {linhas.filter((l) => l.ativo || l.id === c.linha_credito_id).map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      </div>

      {(linha?.tem_veiculo || c.placa || c.veiculo) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Veículo"><Input value={veiculo} onChange={(e) => setVeiculo(e.target.value)} /></Campo>
          <Campo rotulo="Ano/modelo"><Input value={anoModelo} onChange={(e) => setAnoModelo(e.target.value)} /></Campo>
          <Campo rotulo="Placa"><Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} /></Campo>
        </div>
      )}

      <Campo rotulo="Observações internas">
        <Textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Campo>

      {c.cancelado_em && c.motivo_cancelamento && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
          <span className="font-medium">Motivo da perda:</span> {c.motivo_cancelamento}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        {c.cancelado_em ? (
          <Button type="button" variant="outline" onClick={reabrir}><RotateCcw className="mr-2 h-4 w-4" /> Reabrir</Button>
        ) : (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={perder}>
            <XCircle className="mr-2 h-4 w-4" /> Marcar como perdido
          </Button>
        )}
        <Button type="button" onClick={salvar} disabled={atualizar.isPending}>
          {atualizar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

// ── Histórico: o que o cliente lê na aba Histórico do portal ─────────────────

function AbaHistorico({ contratoId }: { contratoId: string }) {
  const { data: ocorrencias = [], isLoading, error } = useHistorico(contratoId);
  const { data: departamentos = [] } = useDepartamentos();
  const lancar = useLancarOcorrencia();
  const [texto, setTexto] = useState("");
  const [depId, setDepId] = useState(NENHUM);
  const dep = departamentos.find((d) => d.id === depId);

  const enviar = async () => {
    if (!texto.trim()) return;
    try {
      await lancar.mutateAsync({ contratoId, texto, departamentoId: depId === NENHUM ? null : depId });
      setTexto("");
      toast.success(dep?.urgente ? "Aviso urgente lançado." : "Ocorrência lançada.");
    } catch (e) {
      toast.error("Não foi possível lançar.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label htmlFor="ocorrencia">Nova ocorrência</Label>
        <Textarea id="ocorrencia" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: Proposta enviada ao banco. Aguardando retorno em até 5 dias úteis." />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={depId} onValueChange={setDepId}>
            <SelectTrigger className="h-9 w-auto min-w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Sem departamento</SelectItem>
              {departamentos.filter((d) => d.ativo).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.nome}{d.urgente ? " (urgente)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="ml-auto" onClick={enviar} disabled={!texto.trim() || lancar.isPending}>
            {lancar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lançar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico: {(error as Error).message}</p>
      ) : ocorrencias.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma ocorrência lançada.</p>
      ) : (
        <ul className="space-y-2">
          {ocorrencias.map((o) => (
            <li key={o.id} className={`rounded-lg border p-3 ${o.departamento?.urgente ? "border-warning/50 bg-warning/5" : "border-border bg-accent/40"}`}>
              {o.departamento?.urgente && (
                <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-warning">
                  <Bell className="h-3 w-3" /> Urgente
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-foreground">{o.texto}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {o.autor?.nome ?? "—"} em {dataHoraBR(o.created_at)}
                {o.departamento ? ` · ${o.departamento.nome}` : ""}
                {o.lido_pelo_cliente_em ? ` · lido pelo cliente em ${dataHoraBR(o.lido_pelo_cliente_em)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {ocorrencias.length >= LIMITE_HISTORICO && (
        <p className="text-center text-[11px] text-muted-foreground">Mostrando as {LIMITE_HISTORICO} ocorrências mais recentes.</p>
      )}
    </div>
  );
}

// ── Atendimentos: os chats deste contrato (a caixa completa é outra tela) ─────

function AbaAtendimentos({ contratoId }: { contratoId: string }) {
  const { data: lista = [], isLoading, error } = useAtendimentosDoContrato(contratoId);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const aberto = lista.find((a) => a.id === abertoId) ?? null;

  if (aberto) {
    return (
      <Conversa
        atendimento={{ id: aberto.id, numero: aberto.numero, arquivado_em: aberto.arquivado_em, setorNome: aberto.setor?.nome ?? null, titulo: aberto.titulo }}
        onVoltar={() => setAbertoId(null)}
      />
    );
  }
  if (isLoading) return <p className="pt-2 text-sm text-muted-foreground">Carregando…</p>;
  if (error) return <p className="pt-2 text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>;
  return (
    <div className="space-y-3 pt-2">
      {lista.length === 0 ? (
        // Mesmo texto que o cliente vê na aba Atendimentos do portal.
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum atendimento encontrado!</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lista.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setAbertoId(a.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/60">
                {a.arquivado_em ? <Archive className="h-4 w-4 shrink-0 text-muted-foreground" /> : <MessageSquare className="h-4 w-4 shrink-0 text-q-petrol" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{a.titulo}</p>
                  <p className="text-[11px] text-muted-foreground">
                    #{a.numero} · {a.setor?.nome ?? "—"} · aberto em {dataHoraBR(a.created_at)}
                    {a.arquivado_em ? " · arquivado" : " · em aberto"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{rotulo}</Label>
      {children}
    </div>
  );
}
