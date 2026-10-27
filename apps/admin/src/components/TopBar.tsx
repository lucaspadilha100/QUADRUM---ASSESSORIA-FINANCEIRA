import { Link } from "react-router-dom";
import { KeyRound, LogOut, Menu, Moon, Sun, UserCircle } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/Avatar";
import { Notificacoes } from "@/components/Notificacoes";
import { PAPEL_LABEL, useAuth } from "@/contexts/AuthContext";
import { useTema } from "@/hooks/useTema";
import simbolo from "@/assets/simbolo.png";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { perfil, signOut } = useAuth();
  const { tema, alternar } = useTema();
  const papel = perfil ? [PAPEL_LABEL[perfil.papel], perfil.departamento_nome].filter(Boolean).join(" · ") : "";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-5">
      <button type="button" onClick={onMenu} aria-label="Abrir menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted md:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <Link to="/" className="flex items-center gap-2 md:hidden">
        <img src={simbolo} alt="" className="h-7 w-auto" />
        <span className="q-titulo-marca text-sm font-semibold">TriConecta</span>
      </Link>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <Notificacoes />
        <button type="button" onClick={alternar} aria-label={tema === "escuro" ? "Tema claro" : "Tema escuro"} title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {tema === "escuro" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ml-1 flex items-center gap-2.5 rounded-full p-1 transition-colors hover:bg-muted sm:pr-3">
              <Avatar nome={perfil?.nome} url={perfil?.avatar_url} className="h-8 w-8" />
              <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
                <span className="max-w-[200px] truncate text-sm font-medium text-foreground">{perfil?.nome}</span>
                <span className="max-w-[200px] truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{papel}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate">{perfil?.nome}</span>
              <span className="truncate text-[11px] font-normal text-muted-foreground">{perfil?.email}</span>
              {papel && <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-q-gold">{papel}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/perfil"><UserCircle className="mr-2 h-4 w-4" /> Meu perfil</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/perfil?aba=senha"><KeyRound className="mr-2 h-4 w-4" /> Trocar senha</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
