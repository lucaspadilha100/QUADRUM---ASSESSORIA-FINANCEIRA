import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useBancos, useCriarBanco } from "@/hooks/useCadastros";
import { pedirTexto } from "@/shell";

// O banco do contrato, com "+ Cadastrar banco…" para o GESTOR (a RLS só deixa
// gestor criar cadastro). Quem não é gestor vê o aviso de pedir a um.
// `NENHUM` = sem banco (o Radix Select não aceita item de valor vazio).

export const NENHUM = "nenhum";
const NOVO = "__novo__";

export function SelectBanco({ valor, onChange, manterId }: {
  valor: string;
  onChange: (id: string) => void;
  manterId?: string | null;   // banco já gravado que foi desativado continua na lista
}) {
  const { isGestor } = useAuth();
  const { data: bancos = [] } = useBancos();
  const criar = useCriarBanco();
  const lista = bancos.filter((b) => b.ativo || b.id === manterId);
  // O banco recém-cadastrado é escolhido ANTES de a lista recarregar; o
  // rótulo vem daqui, senão o campo ficaria em branco com o banco escolhido.
  const [criado, setCriado] = useState<{ id: string; nome: string } | null>(null);
  const rotulo = valor === NENHUM ? "Não informado"
    : bancos.find((b) => b.id === valor)?.nome ?? (criado?.id === valor ? criado.nome : "");

  const escolher = async (v: string) => {
    if (v !== NOVO) return onChange(v);
    const nome = await pedirTexto({ titulo: "Cadastrar banco", rotulo: "Nome do banco", obrigatorio: true, confirmar: "Cadastrar" });
    if (!nome?.trim()) return;
    const ja = bancos.find((b) => b.nome.trim().toLowerCase() === nome.trim().toLowerCase());
    if (ja) { onChange(ja.id); return; }
    try {
      const id = await criar.mutateAsync(nome);
      setCriado({ id, nome: nome.trim() });
      onChange(id);
      toast.success(`Banco "${nome.trim()}" cadastrado.`);
    } catch (e) {
      toast.error("Não foi possível cadastrar o banco.", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-1">
      <Select value={valor} onValueChange={escolher}>
        <SelectTrigger><SelectValue>{rotulo}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value={NENHUM}>Não informado</SelectItem>
          {lista.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
          {isGestor && (
            <>
              <SelectSeparator />
              <SelectItem value={NOVO}><span className="inline-flex items-center gap-1.5 text-q-petrol"><Plus className="h-3.5 w-3.5" /> Cadastrar banco…</span></SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      {lista.length === 0 && !isGestor && (
        <p className="text-[11px] text-muted-foreground">Nenhum banco cadastrado. Peça a um gestor para cadastrar.</p>
      )}
    </div>
  );
}
