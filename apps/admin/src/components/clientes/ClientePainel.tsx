import { useEffect, useState } from "react";
import { ChevronRight, CheckCircle2, Download, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import { AcessoPortal } from "@/components/AcessoPortal";
import { Carregando, Falha } from "@/components/Estados";
import { useEtapas } from "@/hooks/useCadastros";
import { useAtualizarCliente, useCliente } from "@/hooks/useClientes";
import { dataBR, dataHoraBR, documentoValido, formatarDocumento, mascararDocumento, soDigitos } from "@/lib/formato";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { exportarCliente, useAceiteDoCliente } from "@/hooks/useLgpd";

// ─────────────────────────────────────────────────────────────────────────────
// A ficha do cliente, em DOIS lugares e um componente só:
//   - Clientes → abrir um cliente (ClientePainel, com a lista de contratos);
//   - o card do contrato → aba "Cliente" (EdicaoCliente), para completar os
//     dados SEM sair do contrato. Antes o card mandava para outra tela e não
//     havia como voltar ao contrato.
// ─────────────────────────────────────────────────────────────────────────────

export function EdicaoCliente({ clienteId, comPortal = true }: { clienteId: string; comPortal?: boolean }) {
  const { data: cliente, isLoading, error } = useCliente(clienteId);
  const atualizar = useAtualizarCliente();
  // CPF/CNPJ: opcional até a etapa do portal. Depois do acesso ao portal ele é
  // o login e fica travado (o banco também recusa mudar).
  const [doc, setDoc] = useState("");
  useEffect(() => setDoc(formatarDocumento(cliente?.documento)), [cliente?.documento]);
  if (isLoading) return <Carregando />;
  if (error) return <Falha erro={error as Error} />;
  if (!cliente) return <p className="text-sm text-muted-foreground">Cliente não encontrado — ou é de outra carteira.</p>;
  return (
    <div className="space-y-5">
      {comPortal && (
        <section className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4 text-q-petrol" /> Portal do Cliente</p>
          <AcessoPortal cliente={cliente} />
        </section>
      )}
      <ClienteForm
        inicial={{ nome: cliente.nome, telefone: cliente.telefone ?? "", email: cliente.email ?? "", observacoes: cliente.observacoes ?? "" }}
        inicialDocumento={cliente}
        tipoPessoa={soDigitos(doc).length === 14 ? "PJ" : soDigitos(doc).length === 11 ? "PF" : null}
        antes={
          <div className="space-y-1.5">
            <Label htmlFor="cli-doc">CPF ou CNPJ</Label>
            <Input id="cli-doc" inputMode="numeric" value={doc} disabled={!!cliente.user_id}
              onChange={(e) => setDoc(mascararDocumento(e.target.value))} placeholder="000.000.000-00" />
          </div>
        }
        consultorInicial={cliente.consultor_id}
        rotuloSalvar="Salvar cliente"
        salvando={atualizar.isPending}
        onSalvar={async (d) => {
          const novo = soDigitos(doc);
          if (novo && !documentoValido(novo)) return toast.error("CPF tem 11 dígitos e CNPJ, 14.");
          const mudouDoc = !cliente.user_id && novo !== (cliente.documento ?? "");
          try {
            await atualizar.mutateAsync({ id: cliente.id, ...d, ...(mudouDoc ? { documento: novo } : {}) });
            toast.success("Cliente salvo.");
          } catch (e) {
            toast.error("Não foi possível salvar.", { description: (e as Error).message });
          }
        }}
      />
    </div>
  );
}

export function ClientePainel({ clienteId, onAbrirContrato }: { clienteId: string; onAbrirContrato: (id: string) => void }) {
  const { data: cliente, isLoading, error } = useCliente(clienteId);
  const { data: etapas = [] } = useEtapas();
  const etapaNome = (id: string) => etapas.find((e) => e.id === id)?.nome ?? "—";

  if (isLoading) return <Carregando />;
  if (error) return <Falha erro={error as Error} />;
  if (!cliente) return <p className="pt-10 text-sm text-muted-foreground">Cliente não encontrado — ou é de outra carteira.</p>;

  return (
    <>
      <SheetHeader className="pr-8 text-left">
        <p className="font-titulo text-xs font-semibold text-muted-foreground">CLIENTE{cliente.documento ? ` · ${cliente.tipo_pessoa}` : ""}</p>
        <SheetTitle className="text-xl">{cliente.nome}</SheetTitle>
        <SheetDescription>{formatarDocumento(cliente.documento) || "Sem CPF/CNPJ"} · cadastrado em {dataBR(cliente.created_at)}</SheetDescription>
        <Lgpd clienteId={clienteId} documento={cliente.documento} />
      </SheetHeader>

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Contratos</h3>
        {cliente.contratos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            Nenhum contrato.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {[...cliente.contratos].sort((a, b) => b.numero - a.numero).map((k) => (
              <li key={k.id}>
                {/* Abre o contrato AQUI, na mesma barra, com "voltar para o cliente". */}
                <button type="button" onClick={() => onAbrirContrato(k.id)}
                  className="flex w-full items-center gap-3 p-3 text-left text-sm text-foreground hover:bg-accent/50">
                  <span className="font-titulo font-semibold">#{k.numero}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{etapaNome(k.etapa_id)}</span>
                  {k.cancelado_em ? (
                    <span className="text-xs text-destructive">Perdido</span>
                  ) : k.data_aceite ? (
                    <span className="inline-flex items-center gap-1 text-xs text-q-petrol"><CheckCircle2 className="h-3.5 w-3.5" /> No portal</span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-semibold">Dados</h3>
        <EdicaoCliente clienteId={clienteId} />
      </section>
    </>
  );
}

function Lgpd({ clienteId, documento }: { clienteId: string; documento: string | null }) {
  const { isGestor } = useAuth();
  const { data: aceite } = useAceiteDoCliente(clienteId);
  const [exportando, setExportando] = useState(false);
  const exportar = async () => {
    setExportando(true);
    try { await exportarCliente(clienteId, documento ?? clienteId); toast.success("Arquivo gerado."); }
    catch (e) { toast.error("Não foi possível exportar.", { description: (e as Error).message }); }
    finally { setExportando(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {aceite && (
        <span className={`inline-flex items-center gap-1 text-xs ${aceite.termo.ativo ? "text-success" : "text-muted-foreground"}`}>
          <ShieldCheck className="h-3.5 w-3.5" /> Privacidade v{aceite.termo.versao} aceita em {dataHoraBR(aceite.aceito_em)}
        </span>
      )}
      {isGestor && (
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={exportar} disabled={exportando}>
          {exportando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />} Exportar dados (LGPD)
        </Button>
      )}
    </div>
  );
}
