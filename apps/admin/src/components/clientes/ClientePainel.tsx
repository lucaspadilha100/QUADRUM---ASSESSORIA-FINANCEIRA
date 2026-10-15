import { ChevronRight, CheckCircle2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import { AcessoPortal } from "@/components/AcessoPortal";
import { Carregando, Falha } from "@/components/Estados";
import { useEtapas } from "@/hooks/useCadastros";
import { useAtualizarCliente, useCliente } from "@/hooks/useClientes";
import { dataBR, formatarDocumento } from "@/lib/formato";

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
        tipoPessoa={cliente.tipo_pessoa}
        consultorInicial={cliente.consultor_id}
        rotuloSalvar="Salvar cliente"
        salvando={atualizar.isPending}
        onSalvar={async (d) => {
          try {
            await atualizar.mutateAsync({ id: cliente.id, ...d });
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
        <p className="font-titulo text-xs font-semibold text-muted-foreground">CLIENTE · {cliente.tipo_pessoa}</p>
        <SheetTitle className="text-xl">{cliente.nome}</SheetTitle>
        <SheetDescription>{formatarDocumento(cliente.documento)} · cadastrado em {dataBR(cliente.created_at)}</SheetDescription>
      </SheetHeader>

      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Contratos</h3>
        {cliente.contratos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            Nenhum contrato. Crie na Pipeline com o CPF/CNPJ deste cliente.
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
