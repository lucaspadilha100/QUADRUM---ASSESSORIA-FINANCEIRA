import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { MENU } from "@/lib/menu";

export default function Painel() {
  const { perfil } = useAuth();
  const primeiroNome = perfil?.nome?.split(" ")[0] ?? "";
  const atalhos = MENU.flatMap((s) => s.items).filter((i) => i.to !== "/");

  return (
    <div>
      <PageHeader
        titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}
        descricao="Back-office da Quadrum: tudo o que o cliente vê no Portal nasce aqui."
      />
      <div className="grid gap-3 px-4 py-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
        {atalhos.map((i) => (
          <Link
            key={i.to}
            to={i.to}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-q-gold/60 hover:bg-accent"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-q-onix text-q-gold">
              <i.icon className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium text-foreground">{i.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
