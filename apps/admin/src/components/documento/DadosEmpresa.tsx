import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useEmpresa, useSalvarEmpresa, type Empresa } from "@/hooks/useContratoDocumento";
import { Carregando } from "@/components/Estados";
import { formatarDocumento, mascararDocumento, soDigitos } from "@/lib/formato";

// A CONTRATADA dos documentos ({{empresa.*}}): uma linha só, o gestor mantém.

export const camposEmpresa = (e: Empresa | null | undefined) => [e?.nome, e?.cnpj, e?.endereco, e?.telefones, e?.email];
export const faltamEmpresa = (e: Empresa | null | undefined) => camposEmpresa(e).filter((v) => !v?.trim()).length;

export function DadosEmpresa() {
  const { data, isLoading } = useEmpresa();
  if (isLoading) return <Carregando />;
  return <Formulario key={JSON.stringify(data ?? null)} e={data ?? null} />;
}

function Formulario({ e }: { e: Empresa | null }) {
  const { isGestor } = useAuth();
  const salvar = useSalvarEmpresa();
  const [nome, setNome] = useState(e?.nome ?? "");
  const [cnpj, setCnpj] = useState(formatarDocumento(e?.cnpj));
  const [endereco, setEndereco] = useState(e?.endereco ?? "");
  const [telefones, setTelefones] = useState(e?.telefones ?? "");
  const [email, setEmail] = useState(e?.email ?? "");
  const faltam = [nome, cnpj, endereco, telefones, email].filter((v) => !v.trim()).length;

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (cnpj.trim() && soDigitos(cnpj).length !== 14) return toast.error("CNPJ tem 14 dígitos.");
    const vazio = (s: string) => s.trim() || null;
    try {
      await salvar.mutateAsync({ nome: vazio(nome), cnpj: soDigitos(cnpj) || null, endereco: vazio(endereco), telefones: vazio(telefones), email: vazio(email)?.toLowerCase() ?? null });
      toast.success("Dados da empresa salvos.");
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="q-titulo-marca text-xs text-foreground">Dados da empresa</h2>
        <span className={`text-xs ${faltam ? "text-warning" : "text-success"}`}>{faltam ? `faltam ${faltam}` : "completo"}</span>
      </div>
      <fieldset disabled={!isGestor} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="em-nome">Nome</Label><Input id="em-nome" value={nome} onChange={(x) => setNome(x.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="em-cnpj">CNPJ</Label><Input id="em-cnpj" inputMode="numeric" value={cnpj} onChange={(x) => setCnpj(mascararDocumento(x.target.value))} placeholder="00.000.000/0000-00" /></div>
        <div className="space-y-1.5"><Label htmlFor="em-mail">E-mail</Label><Input id="em-mail" type="email" value={email} onChange={(x) => setEmail(x.target.value)} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="em-end">Sede</Label><Input id="em-end" value={endereco} onChange={(x) => setEndereco(x.target.value)} placeholder="Rua, número, bairro, Natal/RN" /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="em-tel">Telefones</Label><Input id="em-tel" value={telefones} onChange={(x) => setTelefones(x.target.value)} placeholder="(84) 0000-0000, (84) 90000-0000" /></div>
      </fieldset>
      {isGestor && (
        <div className="flex justify-end">
          <Button type="submit" disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
        </div>
      )}
    </form>
  );
}
