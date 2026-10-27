import { useState, type ReactNode } from "react";
import {
  Archive, ArrowLeft, Bell, Car, Eye, FileSignature, Globe, Landmark, Loader2, MessageSquare, NotebookPen,
  RotateCcw, UserRound, Wallet, Workflow, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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
import { useContratoDocumento, type DadosContratoDocumento } from "@/hooks/useContratoDocumento";
import { DocumentosDoContrato } from "@/components/documento/DocumentosDoContrato";
import { Conversa } from "@/components/atendimento/Conversa";
import { SelectBanco } from "@/components/SelectBanco";
import { LinhaDoTempo } from "@/components/pipeline/LinhaDoTempo";
import { useDadosContrato } from "@/components/pipeline/DadosParaContrato";
import { EdicaoCliente } from "@/components/clientes/ClientePainel";
import { Bloco, Campo } from "@/components/Bloco";
import { Carregando } from "@/components/Estados";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// O card aberto. Abas: Contrato (tudo do contrato, um Salvar) · Cliente (tudo
// do cliente) · Histórico e Chat (o que o cliente lê no portal) · Documentos
// (gerar do modelo, assinado fora, e o que já foi). Painel LARGO no computador
// (cabeçalho e abas fixos no topo, seções em duas colunas) e tela cheia no
// celular.
// ─────────────────────────────────────────────────────────────────────────────

const NENHUM = "nenhum";

// Largura do painel: a mesma em Pipeline, Contratos, Documentos e Clientes.
export const PAINEL_LARGO = "w-full overflow-y-auto p-0 sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl";

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
      <SheetContent side="right" className={PAINEL_LARGO}>
        {contratoId && <ContratoPainel contratoId={contratoId} />}
      </SheetContent>
    </Sheet>
  );
}

/** O contrato inteiro, para morar dentro de uma barra lateral larga (`PAINEL_LARGO`). `voltar` põe o "← Voltar" no topo. */
export function ContratoPainel({ contratoId, voltar }: { contratoId: string; voltar?: { rotulo: string; onClick: () => void } }) {
  const { data: contrato, isLoading, error } = useContrato(contratoId);
  const botaoVoltar = voltar && (
    <button type="button" onClick={voltar.onClick}
      className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-q-petrol hover:underline">
      <ArrowLeft className="h-4 w-4" /> {voltar.rotulo}
    </button>
  );
  if (contrato) return <Conteudo key={contrato.id} c={contrato} voltar={botaoVoltar} />;
  return (
    <div className="px-4 py-5 sm:px-6">
      {botaoVoltar}
      {isLoading ? (
        <p className="flex items-center gap-2 pt-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
      ) : error ? (
        <p className="pt-10 text-sm text-destructive">Não foi possível abrir o contrato: {(error as Error).message}</p>
      ) : (
        <p className="pt-10 text-sm text-muted-foreground">Contrato não encontrado — ou é de outra carteira.</p>
      )}
    </div>
  );
}

const ABA = "shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2.5 pt-2 text-sm data-[state=active]:border-q-gold data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4";

function Conteudo({ c, voltar }: { c: ContratoPipeline; voltar?: ReactNode }) {
  const { data: etapas = [] } = useEtapas();
  const [painelUrl] = useParamUrl("painel", "dados");
  const [aba, setAba] = useState(painelUrl === "pendencias" ? "documentos" : painelUrl);
  // Sem o cliente (é de outra carteira), não há aba Cliente para abrir.
  const abaVisivel = aba === "cliente" && !c.cliente ? "dados" : aba;
  const etapa = etapas.find((e) => e.id === c.etapa_id);
  const dias = Math.max(0, Math.floor((Date.now() - new Date(c.etapa_desde).getTime()) / 86_400_000));
  return (
    <Tabs value={abaVisivel} onValueChange={(v) => setAba(v)} className="flex min-h-full flex-col">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        {voltar}
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:gap-4 sm:pr-10">
          <div className="min-w-0 pr-10 sm:flex-1 sm:pr-0">
            <p className="font-titulo text-xs font-semibold text-muted-foreground">CONTRATO #{c.numero}</p>
            <SheetTitle className="break-words text-xl sm:text-2xl">{c.cliente?.nome ?? "Cliente de outra carteira"}</SheetTitle>
            <SheetDescription className="break-words">
              {c.cliente ? formatarDocumento(c.cliente.documento) || "Sem CPF/CNPJ" : ""}
              {c.cliente?.telefone ? ` · ${c.cliente.telefone}` : ""}
              {c.cliente?.email ? ` · ${c.cliente.email}` : ""}
            </SheetDescription>
          </div>
          {/* O estado que liga ao portal, sempre à vista. */}
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
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-8">
          <Fato rotulo="Etapa" valor={etapa?.nome ?? "—"} extra={`${dias} dia${dias === 1 ? "" : "s"}`} cor={etapa?.cor} />
          <Fato rotulo="Consultor" valor={c.consultor?.nome ?? "Sem consultor"} />
          <Fato rotulo="Banco" valor={c.banco?.nome ?? "—"} />
          <Fato rotulo="Linha" valor={c.linha?.nome ?? "—"} />
        </dl>
      </div>
      {/* Só as abas ficam fixas no topo: no celular o cabeçalho inteiro tomaria metade da tela. */}
      <div className="sticky top-0 z-10 mt-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-5">
        <TabsList className="flex h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0">
          <TabsTrigger value="dados" className={ABA}>Contrato</TabsTrigger>
          {c.cliente && <TabsTrigger value="cliente" className={ABA}>Cliente</TabsTrigger>}
          <TabsTrigger value="documentos" className={ABA}>Documentos</TabsTrigger>
          <TabsTrigger value="historico" className={ABA}>Histórico</TabsTrigger>
          <TabsTrigger value="atendimentos" className={ABA}>Chat</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 px-4 pt-5 sm:px-6">
        <TabsContent value="dados" className="mt-0"><AbaContrato c={c} /></TabsContent>
        {c.cliente && (
          <TabsContent value="cliente" className="mt-0">
            <EdicaoCliente clienteId={c.cliente.id} largo />
          </TabsContent>
        )}
        <TabsContent value="documentos" className="mt-0 pb-6">
          <DocumentosDoContrato contrato={c} onCompletar={(onde) => setAba(onde === "cliente" ? "cliente" : "dados")} />
        </TabsContent>
        <TabsContent value="historico" className="mt-0 pb-6"><AbaHistorico contratoId={c.id} /></TabsContent>
        <TabsContent value="atendimentos" className="mt-0 pb-6"><AbaAtendimentos contratoId={c.id} /></TabsContent>
      </div>
    </Tabs>
  );
}

function Fato({ rotulo, valor, extra, cor }: { rotulo: string; valor: string; extra?: string; cor?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
        {cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />}
        <span className="truncate">{valor}</span>
        {extra && <span className="shrink-0 text-xs font-normal text-muted-foreground">· {extra}</span>}
      </dd>
    </div>
  );
}

// ── Contrato: o card + o que o contrato definitivo pede, num Salvar só ───────

const SEM_DADOS: DadosContratoDocumento = {
  titular_outro: false, titular_nome: null, titular_documento: null, titular_rg: null, titular_nascimento: null,
  titular_sexo: null, titular_endereco: null, renavam: null, chassi: null, veiculo_no_endereco: null,
  saldo_devedor: null, valor_parcela: null, parcela_balao: null, qtd_parcelas: null, parcelas_pagas: null,
  parcelas_atrasadas: null, ultima_parcela_paga: null, plano_valor_total: null, plano_entrada: null,
  plano_parcelas: null, plano_valor_parcela: null, plano_primeiro_vencimento: null, plano_forma: null, unidade_id: null,
};

function AbaContrato({ c }: { c: ContratoPipeline }) {
  const { data, isLoading } = useContratoDocumento(c.id);
  if (isLoading) return <Carregando />;
  const d = data ?? SEM_DADOS;
  // ⚠️ Reinicia pelos VALORES gravados, nunca pelo objeto: a tela relê sozinha
  // (ao vivo) e um objeto novo com os mesmos dados apagaria o que está sendo digitado.
  const chave = JSON.stringify([d, c.etapa_id, c.banco_id, c.linha_credito_id, c.veiculo, c.ano_modelo, c.placa, c.consultor_id, c.observacoes]);
  return <FormContrato key={chave} c={c} d={d} />;
}

function FormContrato({ c, d }: { c: ContratoPipeline; d: DadosContratoDocumento }) {
  const { isGestor, perfil } = useAuth();
  const { data: etapas = [] } = useEtapas();
  const { data: linhas = [] } = useLinhasCredito();
  const { data: equipe = [] } = useEquipe();
  const { data: unidades = [] } = useUnidades();
  const atualizar = useAtualizarContrato();

  const [etapaId, setEtapaId] = useState(c.etapa_id);
  const [bancoId, setBancoId] = useState(c.banco_id ?? NENHUM);
  const [linhaId, setLinhaId] = useState(c.linha_credito_id ?? NENHUM);
  const [veiculo, setVeiculo] = useState(c.veiculo ?? "");
  const [anoModelo, setAnoModelo] = useState(c.ano_modelo ?? "");
  const [placa, setPlaca] = useState(c.placa ?? "");
  const [consultorId, setConsultorId] = useState(c.consultor_id ?? NENHUM);
  const [unidadeId, setUnidadeId] = useState(d.unidade_id ?? NENHUM);
  const [observacoes, setObservacoes] = useState(c.observacoes ?? "");

  const linha = linhas.find((l) => l.id === linhaId);
  const comVeiculo = !!(linha?.tem_veiculo || veiculo.trim() || placa.trim());
  const dc = useDadosContrato(d, { comVeiculo, nomeCliente: c.cliente?.nome });
  const faltam = dc.faltam.titular + dc.faltam.veiculo + dc.faltam.financiamento + dc.faltam.plano;
  const vazio = (s: string) => s.trim() || null;
  const opc = (v: string) => (v === NENHUM ? null : v);

  const salvar = async () => {
    const extra = dc.campos();
    if (typeof extra === "string") return toast.error(extra);
    const campos: Record<string, unknown> = {
      ...extra,
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

  const icone = (I: typeof Car) => <I className="h-4 w-4 text-q-petrol" />;

  return (
    <div>
      {c.cancelado_em && c.motivo_cancelamento && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
          <span className="font-medium">Motivo da perda:</span> {c.motivo_cancelamento}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bloco titulo="Andamento" icone={icone(Workflow)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Campo rotulo="Unidade" className="sm:col-span-2">
              <Select value={unidadeId} onValueChange={setUnidadeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUM}>Sem unidade</SelectItem>
                  {unidades.filter((u) => u.ativo || u.id === d.unidade_id).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.nome}{u.cidade ? ` — ${u.cidade}${u.uf ? `/${u.uf}` : ""}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
        </Bloco>

        <Bloco titulo="Dívida" icone={icone(Landmark)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Banco"><SelectBanco valor={bancoId} onChange={setBancoId} manterId={c.banco_id} /></Campo>
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
        </Bloco>

        {comVeiculo && (
          <Bloco titulo="Veículo" icone={icone(Car)} faltam={dc.faltam.veiculo} className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Marca e modelo"><Input value={veiculo} onChange={(e) => setVeiculo(e.target.value)} /></Campo>
              <Campo rotulo="Ano/modelo"><Input value={anoModelo} onChange={(e) => setAnoModelo(e.target.value)} /></Campo>
              <Campo rotulo="Placa"><Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} /></Campo>
              {dc.veiculo}
            </div>
          </Bloco>
        )}

        <Bloco titulo="Financiamento" icone={icone(Wallet)} faltam={dc.faltam.financiamento} className="lg:col-span-2">
          {dc.financiamento}
        </Bloco>

        <Bloco titulo="Plano escolhido" icone={icone(FileSignature)} faltam={dc.faltam.plano} className="lg:col-span-2">
          {dc.plano}
        </Bloco>

        <Bloco titulo="Titular do financiamento" icone={icone(UserRound)} faltam={dc.faltam.titular}>
          {dc.titular}
        </Bloco>

        <Bloco titulo="Observações internas" icone={icone(NotebookPen)}>
          <Textarea rows={4} aria-label="Observações internas" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </Bloco>

        <LinhaDoTempo contratoId={c.id} className="lg:col-span-2" />
      </div>

      {/* Fixo no rodapé do painel: salvar não exige rolar até o fim. */}
      <div className="sticky bottom-0 -mx-4 mt-5 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6">
        {c.cancelado_em ? (
          <Button type="button" variant="outline" onClick={reabrir}><RotateCcw className="mr-2 h-4 w-4" /> Reabrir</Button>
        ) : (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={perder}>
            <XCircle className="mr-2 h-4 w-4" /> Marcar como perdido
          </Button>
        )}
        <span className={`ml-auto text-xs ${faltam ? "text-warning" : "text-success"}`}>
          {faltam ? `faltam ${faltam} para o contrato` : "contrato completo"}
        </span>
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
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

      <div className="min-w-0 space-y-2">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico: {(error as Error).message}</p>
      ) : ocorrencias.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">Nenhuma ocorrência lançada.</p>
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
      <div className="mx-auto max-w-3xl">
      <Conversa
        atendimento={{ id: aberto.id, numero: aberto.numero, arquivado_em: aberto.arquivado_em, setorNome: aberto.setor?.nome ?? null, titulo: aberto.titulo }}
        onVoltar={() => setAbertoId(null)}
      />
      </div>
    );
  }
  if (isLoading) return <p className="pt-2 text-sm text-muted-foreground">Carregando…</p>;
  if (error) return <p className="pt-2 text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
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
