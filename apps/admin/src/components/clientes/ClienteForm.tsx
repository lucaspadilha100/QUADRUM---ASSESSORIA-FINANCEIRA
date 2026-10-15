import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe } from "@/hooks/useCadastros";
import type { DadosCliente } from "@/hooks/useClientes";

const NENHUM = "nenhum";

/**
 * Os campos do cliente — o MESMO formulário no "Novo cliente" e na ficha.
 * Consultor: o gestor escolhe; o colaborador não vê o seletor (o cliente é
 * dele, e a RLS recusaria passar para outro).
 */
export function ClienteForm({ inicial, consultorInicial, onSalvar, salvando, rotuloSalvar, antes }: {
  inicial?: Partial<DadosCliente>;
  consultorInicial?: string | null;
  onSalvar: (d: DadosCliente) => void;
  salvando: boolean;
  rotuloSalvar: string;
  antes?: React.ReactNode;
}) {
  const { isGestor, perfil } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? "");
  const [consultor, setConsultor] = useState(consultorInicial ?? perfil?.id ?? NENHUM);

  useEffect(() => {
    setNome(inicial?.nome ?? ""); setTelefone(inicial?.telefone ?? ""); setEmail(inicial?.email ?? "");
    setObservacoes(inicial?.observacoes ?? ""); setConsultor(consultorInicial ?? perfil?.id ?? NENHUM);
  }, [inicial?.nome, inicial?.telefone, inicial?.email, inicial?.observacoes, consultorInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onSalvar({
      nome, telefone, email, observacoes,
      ...(isGestor ? { consultorId: consultor === NENHUM ? null : consultor } : {}),
    });
  };

  return (
    <form onSubmit={enviar} className="space-y-3">
      {antes}
      <div className="space-y-1.5">
        <Label htmlFor="cli-nome">Nome</Label>
        <Input id="cli-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cli-tel">Telefone</Label>
          <Input id="cli-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cli-mail">E-mail</Label>
          <Input id="cli-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      {isGestor && (
        <div className="space-y-1.5">
          <Label>Consultor (dono da carteira)</Label>
          <Select value={consultor} onValueChange={setConsultor}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Sem consultor</SelectItem>
              {equipe.filter((p) => p.ativo || p.id === consultorInicial).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">O colaborador só enxerga os clientes de que é consultor.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="cli-obs">Observações internas (o cliente NÃO vê)</Label>
        <Textarea id="cli-obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {rotuloSalvar}
        </Button>
      </div>
    </form>
  );
}
