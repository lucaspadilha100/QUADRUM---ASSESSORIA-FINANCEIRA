import { useState, type FormEvent } from "react";
import { Bell, Loader2, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartamentos, useSalvarDepartamento, type Departamento } from "@/hooks/useCadastros";

// ─────────────────────────────────────────────────────────────────────────────
// Departamentos (quem lança histórico) e setores (quem recebe o chat) são a
// MESMA lista, com duas marcas:
//   Atende no chat  aparece no robô do portal ("com qual setor deseja falar?")
//   Urgente         o histórico dele NÃO aparece na lista do cliente — gera só o
//                   aviso "Você tem uma mensagem urgente" (os "4 e 9" do portal antigo)
// Nada se apaga: desative. Histórico e atendimentos antigos apontam para a linha.
// ─────────────────────────────────────────────────────────────────────────────

export default function Departamentos() {
  const { isGestor } = useAuth();
  const { data: lista = [], isLoading, error } = useDepartamentos();
  const salvar = useSalvarDepartamento();
  const [editando, setEditando] = useState<Departamento | "novo" | null>(null);

  const alternar = async (d: Departamento, campo: "atende_chat" | "urgente" | "ativo", valor: boolean) => {
    try {
      await salvar.mutateAsync({ id: d.id, campos: { [campo]: valor } });
    } catch (e) {
      toast.error("Não foi possível salvar.", { description: (e as Error).message });
    }
  };

  return (
    <div>
      <PageHeader
        titulo="Departamentos e setores"
        descricao="Quem lança histórico no contrato e quem recebe o chat do Portal do Cliente."
        acoes={isGestor ? <Button onClick={() => setEditando("novo")}><Plus className="mr-1.5 h-4 w-4" /> Novo departamento</Button> : undefined}
      />

      <div className="grid gap-3 px-4 pt-4 text-xs text-muted-foreground sm:grid-cols-2 sm:px-8">
        <p className="flex gap-2 rounded-lg border border-border bg-card p-3"><MessageSquare className="h-4 w-4 shrink-0 text-q-petrol" />
          <span><strong className="text-foreground">Atende no chat:</strong> aparece no robô do portal quando o cliente escolhe com qual setor falar.</span></p>
        <p className="flex gap-2 rounded-lg border border-border bg-card p-3"><Bell className="h-4 w-4 shrink-0 text-warning" />
          <span><strong className="text-foreground">Urgente:</strong> o histórico lançado com ele não aparece na lista do cliente — gera só o aviso "Você tem uma mensagem urgente".</span></p>
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : lista.length === 0 ? (
          <Vazio texto="Nenhum departamento cadastrado." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="px-4 py-2.5 text-center font-medium">Atende no chat</th>
                  <th className="px-4 py-2.5 text-center font-medium">Urgente</th>
                  <th className="px-4 py-2.5 text-center font-medium">Ativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((d) => (
                  <tr key={d.id} className={d.ativo ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      {isGestor ? (
                        <button type="button" onClick={() => setEditando(d)} className="font-medium text-foreground hover:underline">{d.nome}</button>
                      ) : <span className="font-medium">{d.nome}</span>}
                      {!d.ativo && <span className="ml-2 text-xs text-muted-foreground">(desativado)</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={d.atende_chat} disabled={!isGestor || salvar.isPending} onCheckedChange={(v) => alternar(d, "atende_chat", v)} aria-label={`${d.nome} atende no chat`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={d.urgente} disabled={!isGestor || salvar.isPending} onCheckedChange={(v) => alternar(d, "urgente", v)} aria-label={`${d.nome} é urgente`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={d.ativo} disabled={!isGestor || salvar.isPending} onCheckedChange={(v) => alternar(d, "ativo", v)} aria-label={`${d.nome} ativo`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isGestor && <p className="mt-3 text-xs text-muted-foreground">Só um gestor altera os departamentos.</p>}
      </div>

      <EditarDepartamento alvo={editando} total={lista.length} onFechar={() => setEditando(null)} />
    </div>
  );
}

function EditarDepartamento({ alvo, total, onFechar }: { alvo: Departamento | "novo" | null; total: number; onFechar: () => void }) {
  const salvar = useSalvarDepartamento();
  const novo = alvo === "novo";
  const d = novo || !alvo ? null : alvo;
  const [nome, setNome] = useState("");
  const [ordem, setOrdem] = useState("");
  const [chave, setChave] = useState<string | null>(null);
  const atual = novo ? "novo" : d?.id ?? null;
  if (atual !== chave) {
    setChave(atual);
    setNome(d?.nome ?? "");
    setOrdem(String(d?.ordem ?? (total + 1) * 10));
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      await salvar.mutateAsync({ id: d?.id, campos: { nome: nome.trim(), ordem: Number(ordem) || 0 } });
      toast.success(novo ? "Departamento criado." : "Departamento salvo.");
      onFechar();
    } catch (err) {
      const msg = (err as Error).message;
      toast.error("Não foi possível salvar.", { description: /duplicate|unique/i.test(msg) ? "Já existe um departamento com esse nome." : msg });
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{novo ? "Novo departamento" : "Editar departamento"}</DialogTitle>
          <DialogDescription>As marcas "atende no chat" e "urgente" mudam direto na lista.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dep-nome">Nome</Label>
            <Input id="dep-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-ordem">Ordem na lista</Label>
            <Input id="dep-ordem" type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Menor aparece primeiro, inclusive no robô do portal.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={!nome.trim() || salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
