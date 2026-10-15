import { useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { Sidebar, usePaginaAtual } from "@/shell";
import { Link } from "react-router-dom";
import { useAuth, PAPEL_LABEL } from "@/contexts/AuthContext";
import { MENU } from "@/lib/menu";
import simboloQ from "@/assets/simbolo-q.png";

const CHAVE_RECOLHIDO = "quadrum:sidebar:recolhido";

export function Layout() {
  const { perfil, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(CHAVE_RECOLHIDO) === "1"; } catch { return false; }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const n = !c;
      try { localStorage.setItem(CHAVE_RECOLHIDO, n ? "1" : "0"); } catch { /* sem storage: só não lembra */ }
      return n;
    });

  const mainRef = useRef<HTMLElement>(null);
  usePaginaAtual({ appName: "Quadrum Admin", sections: MENU, mainRef });

  const rodape = (
    <div className={collapsed ? "flex justify-center" : "flex items-center gap-2"}>
      {!collapsed && (
        <Link to="/perfil" title="Meu perfil" className="min-w-0 flex-1 rounded-md px-1 py-0.5 hover:bg-muted">
          <p className="truncate text-sm font-medium text-foreground">{perfil?.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {perfil ? PAPEL_LABEL[perfil.papel] : ""}
          </p>
        </Link>
      )}
      <button
        type="button"
        onClick={signOut}
        title="Sair"
        aria-label="Sair"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background supports-[height:100dvh]:h-dvh">
      {/* Barra do celular: no desktop o menu lateral já tem marca e botão. */}
      <header className="q-escuro flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src={simboloQ} alt="" className="h-7 w-auto" />
        <span className="q-titulo-marca text-sm font-semibold">Quadrum</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          brand={{ appName: "Quadrum Admin", logoSrc: simboloQ, href: "/" }}
          sections={MENU}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
          footer={rodape}
        />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
