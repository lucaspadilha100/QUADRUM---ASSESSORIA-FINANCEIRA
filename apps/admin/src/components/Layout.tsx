import { Suspense, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Carregando } from "@/components/Estados";
import { TopBar } from "@/components/TopBar";
import { Sidebar, usePaginaAtual } from "@/shell";
import { MENU, MENU_ADMIN } from "@/lib/menu";
import { useAuth } from "@/contexts/AuthContext";
import { useAoVivo } from "@/hooks/useAoVivo";
import simbolo from "@/assets/simbolo.png";

const CHAVE_RECOLHIDO = "quadrum:sidebar:recolhido";

export function Layout() {
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

  const { isAdmin } = useAuth();
  const menu = isAdmin ? [...MENU, ...MENU_ADMIN] : MENU;
  const mainRef = useRef<HTMLElement>(null);
  usePaginaAtual({ appName: "TriConecta Admin", sections: menu, mainRef });
  useAoVivo();

  return (
    <div className="flex h-screen overflow-hidden bg-background supports-[height:100dvh]:h-dvh">
      <Sidebar
        brand={{ appName: "TriConecta Admin", logoSrc: simbolo, href: "/" }}
        sections={menu}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Suspense fallback={<Carregando />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
