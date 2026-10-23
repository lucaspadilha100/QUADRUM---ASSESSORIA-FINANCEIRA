import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Building2, FileText, Loader2, Plus, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Carregando, Falha } from "@/components/Estados";
import { BuscaContrato, type ContratoEscolhido } from "@/components/busca/BuscaContrato";
import { TextoDocumento } from "@/components/documento/DocumentoImpresso";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentoTipos } from "@/hooks/useCadastros";
import { useCatalogo, useModelos, usePrevia, useSalvarModelo, type Modelo } from "@/hooks/useModelos";
import { useTermos } from "@/hooks/useLgpd";
import { TermoPrivacidade } from "@/components/documento/TermoPrivacidade";
import { DadosEmpresa, faltamEmpresa } from "@/components/documento/DadosEmpresa";
import { useEmpresa } from "@/hooks/useContratoDocumento";
import { useAtrasado } from "@/hooks/usePagina";
import { confirmar, useParamUrl } from "@/shell";

// ─────────────────────────────────────────────────────────────────────────────
// Os modelos de contrato, termo, declaração e procuração. O texto leva campos
// entre chaves duplas ({{cliente.nome}}) que o BANCO preenche ao gerar. A
// lista de campos vem do banco (`q_documento_catalogo`) — é a mesma que a
// geração conhece, então a tela não oferece campo que não existe.
//
// Editar o texto sobe a VERSÃO; documento já gerado não muda (é congelado).
// Modelo nasce INATIVO: texto jurídico vai ao cliente depois de revisado.
// ─────────────────────────────────────────────────────────────────────────────

const NOVO = "novo";
const PRIVACIDADE = "privacidade";
const EMPRESA = "empresa";

export default function Modelos() {
  const { isGestor } = useAuth();
  const { data: modelos = [], isLoading, error } = useModelos();
  const { data: tipos = [] } = useDocumentoTipos();
  const [abertoId, setAbertoId] = useParamUrl("modelo", "");
  const aberto = abertoId === NOVO ? null : modelos.find((m) => m.id === abertoId) ?? null;
  const nomeTipo = (c: string) => tipos.find((t) => t.codigo === c)?.nome ?? c;
  const { data: lgpd } = useTermos();
  const termoEmVigor = lgpd?.termos.find((t) => t.ativo);
  const { data: empresa } = useEmpresa();
  const faltaEmpresa = empresa === undefined ? 0 : faltamEmpresa(empresa);

  return (
    <div>
      <PageHeader
        titulo="Modelos de documento"
        acoes={isGestor ? <Button onClick={() => setAbertoId(NOVO)}><Plus className="mr-1.5 h-4 w-4" /> Novo modelo</Button> : undefined}
      />
      <div className="grid gap-4 px-4 py-4 sm:px-8 lg:grid-cols-[280px_1fr]">
        <aside>
          {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {modelos.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setAbertoId(m.id)}
                    className={`flex w-full items-start gap-2 p-3 text-left ${m.id === abertoId ? "bg-accent" : "hover:bg-accent/50"}`}>
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-q-petrol" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{m.nome}</span>
                      <span className="block text-[11px] text-muted-foreground">{nomeTipo(m.tipo)} · versão {m.versao}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.ativo ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                      {m.ativo ? "ativo" : "inativo"}
                    </span>
                  </button>
                </li>
              ))}
              {modelos.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nenhum modelo.</li>}
              <li>
                <button type="button" onClick={() => setAbertoId(EMPRESA)}
                  className={`flex w-full items-start gap-2 p-3 text-left ${abertoId === EMPRESA ? "bg-accent" : "hover:bg-accent/50"}`}>
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-q-petrol" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">Dados da empresa</span>
                    <span className="block text-[11px] text-muted-foreground">{empresa?.nome ?? "Contratada"}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${faltaEmpresa ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>
                    {faltaEmpresa ? `faltam ${faltaEmpresa}` : "completo"}
                  </span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => setAbertoId(PRIVACIDADE)}
                  className={`flex w-full items-start gap-2 p-3 text-left ${abertoId === PRIVACIDADE ? "bg-accent" : "hover:bg-accent/50"}`}>
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-q-petrol" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">Política de Privacidade (LGPD)</span>
                    <span className="block text-[11px] text-muted-foreground">Aceite no portal{termoEmVigor ? ` · versão ${termoEmVigor.versao}` : ""}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${termoEmVigor ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                    {termoEmVigor ? "em vigor" : "rascunho"}
                  </span>
                </button>
              </li>
            </ul>
          )}
        </aside>
        <section>
          {abertoId === EMPRESA ? (
            <DadosEmpresa />
          ) : abertoId === PRIVACIDADE ? (
            <TermoPrivacidade />
          ) : abertoId ? (
            <Editor key={abertoId} modelo={aberto} somenteLeitura={!isGestor} onCriado={setAbertoId} />
          ) : (
            <div className="flex h-60 items-center justify-center rounded-xl border border-dashed border-border bg-card text-sm text-muted-foreground">
              Escolha um modelo para ver ou editar.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Editor({ modelo, somenteLeitura, onCriado }: { modelo: Modelo | null; somenteLeitura: boolean; onCriado: (id: string) => void }) {
  const { data: tipos = [] } = useDocumentoTipos();
  const { data: catalogo = [] } = useCatalogo();
  const salvar = useSalvarModelo();
  const [nome, setNome] = useState(modelo?.nome ?? "");
  const [tipo, setTipo] = useState(modelo?.tipo ?? "");
  const [ativo, setAtivo] = useState(modelo?.ativo ?? false);
  const [corpo, setCorpo] = useState(modelo?.corpo ?? "# TÍTULO DO DOCUMENTO\n\n{{cliente.qualificacao}}.\n\nNatal/RN, {{data.extenso}}.");
  const [contrato, setContrato] = useState<ContratoEscolhido | null>(null);
  const texto = useRef<HTMLTextAreaElement>(null);
  const corpoAtrasado = useAtrasado(corpo, 500);
  const { data: previa, isFetching, error } = usePrevia(corpoAtrasado, contrato?.id ?? null);

  useEffect(() => {
    if (modelo) { setNome(modelo.nome); setTipo(modelo.tipo); setAtivo(modelo.ativo); setCorpo(modelo.corpo); }
  }, [modelo?.id, modelo?.versao]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    const g: Record<string, typeof catalogo> = {};
    for (const c of catalogo) (g[c.grupo] ||= []).push(c);
    return Object.entries(g);
  }, [catalogo]);

  const inserir = (chave: string) => {
    const el = texto.current;
    const marca = `{{${chave}}}`;
    if (!el) { setCorpo((c) => c + marca); return; }
    const ini = el.selectionStart, fim = el.selectionEnd;
    const novo = corpo.slice(0, ini) + marca + corpo.slice(fim);
    setCorpo(novo);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + marca.length, ini + marca.length); });
  };

  const mudou = !modelo || nome !== modelo.nome || tipo !== modelo.tipo || ativo !== modelo.ativo || corpo !== modelo.corpo;

  const gravar = async () => {
    if (!nome.trim() || !tipo) return toast.error("Dê um nome e escolha o tipo de documento.");
    if (previa && previa.desconhecidas.length > 0) {
      return toast.error("O texto usa campos que não existem.", { description: previa.desconhecidas.map((d) => `{{${d}}}`).join(", ") });
    }
    if (ativo && (!modelo || !modelo.ativo)) {
      const ok = await confirmar({
        titulo: "Ativar este modelo?",
        mensagem: "A equipe passa a poder gerar este documento para os clientes assinarem no portal. Confira o texto com o jurídico antes.",
        confirmar: "Ativar",
      });
      if (!ok) return;
    }
    try {
      const id = await salvar.mutateAsync({ id: modelo?.id, campos: { nome: nome.trim(), tipo, ativo, corpo } });
      toast.success(modelo && corpo !== modelo.corpo ? `Salvo — versão ${modelo.versao + 1}. Documentos já gerados não mudam.` : "Modelo salvo.");
      if (!modelo) onCriado(id);
    } catch (e) {
      toast.error("Não foi possível salvar.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="mod-nome">Nome</Label>
          <Input id="mod-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={somenteLeitura} />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={tipo} onValueChange={setTipo} disabled={somenteLeitura}>
            <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>{tipos.map((t) => <SelectItem key={t.codigo} value={t.codigo}>{t.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Switch checked={ativo} onCheckedChange={setAtivo} disabled={somenteLeitura} /> Ativo
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="mod-corpo">Texto do modelo</Label>
            <span className="text-[11px] text-muted-foreground">{modelo ? `versão ${modelo.versao}` : "novo"}</span>
          </div>
          <Textarea id="mod-corpo" ref={texto} value={corpo} onChange={(e) => setCorpo(e.target.value)} readOnly={somenteLeitura}
            rows={22} className="font-mono text-[13px] leading-relaxed" />
          {!somenteLeitura && (
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Campos — clique para inserir no cursor</p>
              <div className="space-y-2">
                {grupos.map(([grupo, campos]) => (
                  <div key={grupo}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{grupo}</p>
                    <div className="flex flex-wrap gap-1">
                      {campos.map((c) => (
                        <button key={c.chave} type="button" onClick={() => inserir(c.chave)} title={`{{${c.chave}}}`}
                          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:border-q-gold hover:bg-accent">
                          {c.rotulo}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Prévia</Label>
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <BuscaContrato valor={contrato} onChange={setContrato} placeholder="Preencher com os dados de um contrato…" />
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {previa && previa.desconhecidas.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Campos que não existem (erro de digitação?): {previa.desconhecidas.map((d) => `{{${d}}}`).join(", ")}
            </p>
          )}
          {previa && contrato && previa.faltando.length > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
              Para este contrato faltam: {previa.faltando.map((f) => f.rotulo ?? f.chave).join(", ")} — a geração seria recusada.
            </p>
          )}
          <div className="max-h-[640px] overflow-y-auto rounded-xl border border-border bg-background p-5">
            {previa ? <TextoDocumento texto={previa.texto} /> : <p className="text-sm text-muted-foreground">Montando…</p>}
          </div>
        </div>
      </div>

      {!somenteLeitura && (
        <div className="flex justify-end">
          <Button onClick={gravar} disabled={!mudou || salvar.isPending}>
            {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar modelo
          </Button>
        </div>
      )}
    </div>
  );
}
