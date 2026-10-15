import { useEffect, useState } from "react";
import { Archive, Bell, CheckCircle2, Eye, Globe, Loader2, MessageSquare, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmar, pedirTexto } from "@/shell";
import { useAuth } from "@/contexts/AuthContext";
import {
  useBancos, useDepartamentos, useDocumentoTipos, useEquipe, useEtapas, useLinhasCredito,
} from "@/hooks/useCadastros";
import {
  useAtendimentosDoContrato, useAtualizarContrato, useDocumentos, useHistorico,
  useLancarOcorrencia, useSalvarDocumento, type ContratoPipeline,
} from "@/hooks/usePipeline";
import { Conversa } from "@/components/atendimento/Conversa";
import { AcessoPortal } from "@/components/AcessoPortal";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// O card aberto. As abas são as MESMAS do Portal do Cliente (Dados, Histórico,
// Atendimentos) mais as Pendências — porque tudo o que o cliente lê lá é
// escrito aqui. Cada aba diz, na própria tela, o que o cliente vai ver.
// ─────────────────────────────────────────────────────────────────────────────

const NENHUM = "nenhum";

export function ContratoDetalhe({ contrato, onFechar }: { contrato: ContratoPipeline | null; onFechar: () => void }) {
  return (
    <Sheet open={!!contrato} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {contrato && <Conteudo c={contrato} />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({ c }: { c: ContratoPipeline }) {
  const { data: etapas = [] } = useEtapas();
  const etapaAceite = etapas.find((e) => e.aceita && e.ativo);
  return (
    <>
      <SheetHeader className="pr-8 text-left">
        <p className="font-titulo text-xs font-semibold text-muted-foreground">CONTRATO #{c.numero}</p>
        <SheetTitle className="text-xl">{c.cliente?.nome ?? "Cliente de outra carteira"}</SheetTitle>
        <SheetDescription>
          {c.cliente ? formatarDocumento(c.cliente.documento) : "Você é consultor deste contrato, mas o cliente é de outra carteira."}
          {c.cliente?.telefone ? ` · ${c.cliente.telefone}` : ""}
        </SheetDescription>
        {/* O estado que liga ao portal, sempre à vista. */}
        <div className="pt-1">
          {c.cancelado_em ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Perdido em {dataBR(c.cancelado_em)} — no portal aparece como CONTRATO CANCELADO
            </span>
          ) : c.data_aceite ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-q-onix px-2.5 py-1 text-xs font-medium text-q-gold">
              <Globe className="h-3.5 w-3.5" /> No portal desde {dataBR(c.data_aceite)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" /> O cliente ainda não vê este contrato
              {etapaAceite ? ` (aparece ao chegar em "${etapaAceite.nome}")` : ""}
            </span>
          )}
        </div>
      </SheetHeader>

      <Tabs defaultValue="dados" className="mt-5">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="documentos">Pendências</TabsTrigger>
          <TabsTrigger value="atendimentos">Atendim.</TabsTrigger>
        </TabsList>
        <TabsContent value="dados"><AbaDados c={c} /></TabsContent>
        <TabsContent value="historico"><AbaHistorico contratoId={c.id} /></TabsContent>
        <TabsContent value="documentos"><AbaDocumentos contratoId={c.id} /></TabsContent>
        <TabsContent value="atendimentos"><AbaAtendimentos contratoId={c.id} /></TabsContent>
      </Tabs>
    </>
  );
}

// ── Dados ────────────────────────────────────────────────────────────────────

function AbaDados({ c }: { c: ContratoPipeline }) {
  const { isGestor, perfil } = useAuth();
  const { data: etapas = [] } = useEtapas();
  const { data: bancos = [] } = useBancos();
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

  useEffect(() => {
    setEtapaId(c.etapa_id); setBancoId(c.banco_id ?? NENHUM); setLinhaId(c.linha_credito_id ?? NENHUM);
    setVeiculo(c.veiculo ?? ""); setAnoModelo(c.ano_modelo ?? ""); setPlaca(c.placa ?? "");
    setConsultorId(c.consultor_id ?? NENHUM); setObservacoes(c.observacoes ?? "");
  }, [c]);

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
          <Select value={bancoId} onValueChange={setBancoId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Não informado</SelectItem>
              {bancos.filter((b) => b.ativo || b.id === c.banco_id).map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
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

      <Campo rotulo="Observações internas (o cliente NÃO vê)">
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
        {/* Diz ANTES do clique o que o cliente vai ver. */}
        <p className="text-[11px] text-muted-foreground">
          {dep?.urgente
            ? "Departamento urgente: o texto NÃO aparece na lista do cliente — ele recebe o aviso \"Você tem uma mensagem urgente\" até ler."
            : "O cliente lê isto na aba Histórico do portal, com o seu nome, a data e a hora."}
        </p>
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
                  <Bell className="h-3 w-3" /> Urgente — o cliente vê só o aviso
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
    </div>
  );
}

// ── Pendências: documentos a assinar ─────────────────────────────────────────

function AbaDocumentos({ contratoId }: { contratoId: string }) {
  const { data: docs = [], isLoading, error } = useDocumentos(contratoId);
  const { data: tipos = [] } = useDocumentoTipos();
  const salvar = useSalvarDocumento();
  const [tipo, setTipo] = useState("");
  const [link, setLink] = useState("");

  const adicionar = async () => {
    if (!tipo) return;
    try {
      await salvar.mutateAsync({ contratoId, campos: { tipo, link_assinatura: link.trim() || null } });
      setTipo(""); setLink("");
      toast.success("Pendência criada.");
    } catch (e) {
      toast.error("Não foi possível criar.", { description: (e as Error).message });
    }
  };

  const marcar = async (id: string, assinado: boolean) => {
    try {
      await salvar.mutateAsync({ contratoId, id, campos: { assinado_em: assinado ? new Date().toISOString() : null } });
    } catch (e) {
      toast.error("Não foi possível atualizar.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label>Nova pendência de assinatura</Label>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger><SelectValue placeholder="Documento" /></SelectTrigger>
            <SelectContent>
              {tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.codigo} value={t.codigo}>{t.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link para assinar (opcional)" />
          <Button type="button" onClick={adicionar} disabled={!tipo || salvar.isPending}>Adicionar</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Aparece para o cliente em "Pendências do contrato", com o botão de assinar, até ser marcada como assinada.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
      ) : docs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma pendência.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              {d.assinado_em ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-warning" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{d.tipo_info?.nome ?? d.tipo}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.assinado_em ? `Assinado em ${dataHoraBR(d.assinado_em)}` : "Pendente"}
                  {d.link_assinatura ? (
                    <> · <a href={d.link_assinatura} target="_blank" rel="noreferrer" className="q-link">link</a></>
                  ) : null}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => marcar(d.id, !d.assinado_em)}>
                {d.assinado_em ? "Desfazer" : "Marcar assinado"}
              </Button>
            </li>
          ))}
        </ul>
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
      <p className="text-[11px] text-muted-foreground">
        O cliente abre o atendimento pelo chat do portal. Clique para ver a conversa e responder.
      </p>
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
