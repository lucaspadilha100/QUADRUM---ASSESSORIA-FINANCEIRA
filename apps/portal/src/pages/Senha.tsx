import { toast } from "sonner";
import { TrocarSenha } from "@/components/TrocarSenha";

export default function Senha() {
  return (
    <div className="space-y-5">
      <h1 className="q-titulo-marca text-lg font-semibold text-foreground">Alterar senha</h1>
      <div className="max-w-md rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <TrocarSenha provisoria={false} onPronto={() => toast.success("Senha alterada.")} />
      </div>
    </div>
  );
}
