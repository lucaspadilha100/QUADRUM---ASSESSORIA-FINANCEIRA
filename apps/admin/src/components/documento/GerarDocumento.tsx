import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextoDocumento } from "@/components/documento/DocumentoImpresso";
import { useContratoDocumento } from "@/hooks/useContratoDocumento";
import { useGerarDocumento, useModelos, usePrevia } from "@/hooks/useModelos";
import { useAtualizarContrato } from "@/hooks/usePipeline";
import { NENHUM, SelectBanco } from "@/components/SelectBanco";

// ─────────────────────────────────────────────────────────────────────────────
// Escolher o MODELO, ver a prévia JÁ PREENCHIDA com os dados deste contrato, e
// gerar. Quem preenche é o banco (a prévia usa a mesma montagem da geração):
// o que aparece aqui é o que o cliente vai ler e assinar.
// Faltando dado, a prévia mostra o campo como [rótulo] e a geração é recusada
// — com o link para completar a ficha do cliente.
// ─────────────────────────────────────────────────────────────────────────────

export function GerarDocumento({ contrato, onGerado, onCompletar }: {
  contrato: { id: string; numero: number; cliente_id?: string | null; data_aceite?: string | null };
  onGerado?: (id: string) => void;
  /** Leva para onde se completa o que falta — SEM sair da tela (aba do card, ou o card por cima). */
  onCompletar?: (onde: "cliente" | "dados") => void;
}) {
  const { data: modelos = [], isLoading } = useModelos();
  const ativos = modelos.filter((m) => m.ativo);
  const [modeloId, setModeloId] = useState("");
  const modelo = ativos.find((m) => m.id === modeloId) ?? null;
  const { data: previa, isFetching, error } = usePrevia(modelo ? modelo.corpo : null, contrato.id);
  const gerar = useGerarDocumento();

  const faltando = previa?.faltando ?? [];
  const { data: extra } = useContratoDocumento(contrato.id);
  // Cada campo que falta mora num lugar: o do CONTRATO (banco, placa, plano…)
  // na aba Contrato; o da EMPRESA em Modelos → Dados da empresa; o resto
  // (cliente, representante) na ficha do cliente. O TITULAR do financiamento
  // é do contrato quando é outra pessoa; senão, são os dados do próprio cliente.
  const lugar = (chave: string) =>
    chave.startsWith("empresa.") ? "empresa"
      : chave.startsWith("contrato.") || (chave.startsWith("titular.") && extra?.titular_outro) ? "contrato"
      : "cliente";
  const doContrato = faltando.filter((f) => lugar(f.chave) === "contrato");
  const daEmpresa = faltando.filter((f) => lugar(f.chave) === "empresa");
  // Do titular = do cliente: não repete o que o cliente já mostra.
  const rotulosCliente = new Set(faltando.filter((f) => f.chave.startsWith("cliente.")).map((f) => f.chave.slice(8)));
  const doCliente = faltando.filter((f) => lugar(f.chave) === "cliente"
    && !(f.chave.startsWith("titular.") && rotulosCliente.has(f.chave.slice(8).replace("cpf", "documento"))));
  const nomes = (l: typeof faltando) => l.map((f) => f.rotulo ?? f.chave).join(", ");
  // Banco é o que mais falta (e o mais escondido): escolhe-se AQUI, no aviso.
  const faltaBanco = doContrato.some((f) => f.chave === "contrato.banco");
  const outrosDoContrato = doContrato.filter((f) => f.chave !== "contrato.banco");
  const desconhecidas = previa?.desconhecidas ?? [];
  const pode = !!modelo && !!previa && faltando.length === 0 && desconhecidas.length === 0;

  const enviar = async () => {
    if (!modelo) return;
    try {
      const id = await gerar.mutateAsync({ contratoId: contrato.id, modeloId: modelo.id });
      toast.success(contrato.data_aceite ? "Documento gerado." : "Documento gerado.");
      setModeloId("");
      onGerado?.(id);
    } catch (e) {
      toast.error("Não foi possível gerar.", { description: (e as Error).message });
    }
  };

  if (!isLoading && ativos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        Nenhum modelo ativo. <Link to="/cadastros/modelos" className="q-link">Modelos de documento</Link>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Modelo</Label>
        <Select value={modeloId} onValueChange={setModeloId}>
          <SelectTrigger><SelectValue placeholder={isLoading ? "Carregando…" : "Escolha o modelo"} /></SelectTrigger>
          <SelectContent>
            {ativos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {modelo && (
        <>
          {error ? (
            <p className="text-sm text-destructive">Não foi possível montar a prévia: {(error as Error).message}</p>
          ) : !previa || isFetching ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Montando a prévia…</p>
          ) : (
            <>
              {(faltando.length > 0 || desconhecidas.length > 0) && (
                <div className="rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-foreground"><AlertTriangle className="h-4 w-4 text-warning" /> Ainda não dá para gerar</p>
                  {doCliente.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      Falta nos <strong className="text-foreground">dados do cliente</strong>: <strong className="text-foreground">{nomes(doCliente)}</strong>.{" "}
                      {onCompletar
                        ? <button type="button" onClick={() => onCompletar("cliente")} className="q-link font-medium">Completar os dados do cliente</button>
                        : contrato.cliente_id && <Link to={`/clientes?cliente=${contrato.cliente_id}`} className="q-link">Completar os dados do cliente</Link>}
                    </p>
                  )}
                  {faltaBanco && <BancoAqui contratoId={contrato.id} />}
                  {outrosDoContrato.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      Falta no <strong className="text-foreground">contrato</strong>: <strong className="text-foreground">{nomes(outrosDoContrato)}</strong>.{" "}
                      {onCompletar
                        ? <button type="button" onClick={() => onCompletar("dados")} className="q-link font-medium">Preencher no contrato</button>
                        : <Link to={`/contratos?contrato=${contrato.id}`} className="q-link">Preencher no contrato</Link>}
                    </p>
                  )}
                  {daEmpresa.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      Falta nos <strong className="text-foreground">dados da empresa</strong>: <strong className="text-foreground">{nomes(daEmpresa)}</strong>.{" "}
                      <Link to="/cadastros/modelos?modelo=empresa" className="q-link">Dados da empresa</Link>
                    </p>
                  )}
                  {desconhecidas.length > 0 && (
                    <p className="mt-1 text-muted-foreground">O modelo usa campos que não existem: {desconhecidas.map((d) => `{{${d}}}`).join(", ")}. Corrija o modelo.</p>
                  )}
                </div>
              )}
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-background p-4">
                <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Prévia
                </p>
                <TextoDocumento texto={previa.texto} />
              </div>
            </>
          )}
          <div className="flex items-center justify-end gap-2">
            {!contrato.data_aceite && <p className="mr-auto text-[11px] text-warning">Contrato ainda não aceito.</p>}
            <Button type="button" onClick={enviar} disabled={!pode || gerar.isPending}>
              {gerar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Gerar e enviar ao portal
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** O banco do contrato, escolhido e gravado direto no aviso — a prévia atualiza sozinha. */
function BancoAqui({ contratoId }: { contratoId: string }) {
  const [bancoId, setBancoId] = useState(NENHUM);
  const atualizar = useAtualizarContrato();
  const salvar = async () => {
    try {
      await atualizar.mutateAsync({ id: contratoId, campos: { banco_id: bancoId } });
      toast.success("Banco salvo no contrato.");
    } catch (e) {
      toast.error("Não foi possível salvar o banco.", { description: (e as Error).message });
    }
  };
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-muted-foreground">Falta o <strong className="text-foreground">banco</strong> deste contrato — escolha aqui:</p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[200px] flex-1"><SelectBanco valor={bancoId} onChange={setBancoId} /></div>
        <Button type="button" onClick={salvar} disabled={bancoId === NENHUM || atualizar.isPending}>
          {atualizar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar banco
        </Button>
      </div>
    </div>
  );
}
