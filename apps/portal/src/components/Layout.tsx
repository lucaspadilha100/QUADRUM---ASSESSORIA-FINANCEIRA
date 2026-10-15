import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { FileText, Loader2, LogOut, Menu, MessageCircle, X } from "lucide-react";
import { useSessao } from "@/contexts/Sessao";
import { formatarDocumento } from "@/lib/formato";
import { useAvisos } from "@/lib/portal";
import simboloQ from "@/assets/simbolo-q.png";

// Duas colunas, como no portal antigo: menu fixo escuro à esquerda e o
// conteúdo sobre Off White com a marca d'água do Q. No celular o menu vira
// barra com hambúrguer que abre em tela cheia.

export function Layout() {
  const { user, cliente, carregando, sair } = useSessao();
  const [aberto, setAberto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setAberto(false), [pathname]);

  if (carregando) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!cliente) {
    // Logado sem ser cliente (ex.: conta da equipe): o mesmo Auth, outra porta.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Esta conta não é de cliente</h1>
        <p className="max-w-sm text-sm text-muted-foreground">O Portal do Cliente é para quem tem contrato com a Quadrum. A equipe usa o sistema administrativo.</p>
        <button onClick={sair} className="rounded-md border border-border px-4 py-2 text-sm">Sair</button>
      </div>
    );
  }

  const menu = <Menu_ nome={cliente.nome} documento={cliente.documento} onSair={sair} />;

  return (
    <div className="min-h-screen md:flex">
      <aside className="q-escuro q-nao-imprimir hidden w-[300px] shrink-0 bg-background md:fixed md:inset-y-0 md:flex md:flex-col">{menu}</aside>

      <header className="q-escuro q-nao-imprimir sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <button onClick={() => setAberto(true)} aria-label="Abrir menu" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"><Menu className="h-5 w-5" /></button>
        <img src={simboloQ} alt="" className="h-7 w-auto" />
        <span className="q-titulo-marca text-sm font-semibold">Quadrum</span>
      </header>
      {aberto && (
        <div className="q-escuro fixed inset-0 z-40 flex flex-col bg-background md:hidden">
          <button onClick={() => setAberto(false)} aria-label="Fechar menu" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"><X className="h-5 w-5" /></button>
          {menu}
        </div>
      )}

      <main className="relative min-h-screen flex-1 overflow-hidden md:ml-[300px] print:ml-0">
        <img src={simboloQ} alt="" aria-hidden className="q-nao-imprimir pointer-events-none fixed -bottom-24 -right-24 w-[480px] max-w-none select-none opacity-[0.04]" />
        <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10 print:max-w-none print:p-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Menu_({ nome, documento, onSair }: { nome: string; documento: string; onSair: () => void }) {
  const { data: avisos } = useAvisos();
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-6">
        <img src={simboloQ} alt="" className="h-10 w-auto" />
        <div>
          <p className="q-titulo-marca text-sm font-semibold text-foreground">Quadrum</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-q-gold">Portal do Cliente</p>
        </div>
      </div>
      <div className="border-b border-border px-6 py-5">
        <p className="text-[22px] font-semibold leading-tight text-foreground">{nome}</p>
        <p className="mt-1 text-sm text-muted-foreground">{formatarDocumento(documento)}</p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        <NavLink to="/contratos" className={item}><FileText className="h-5 w-5" /> Meus Contratos</NavLink>
        <NavLink to="/chat" className={item}>
          <MessageCircle className="h-5 w-5" /> Atendimento via Chat
          {avisos?.chat_nao_lido && <span className="ml-auto h-2.5 w-2.5 rounded-full bg-q-gold" aria-label="Novas mensagens" />}
        </NavLink>
        <button onClick={onSair} className={item({ isActive: false }) + " w-full"}><LogOut className="h-5 w-5" /> Sair</button>
      </nav>
      <p className="px-6 pb-6 text-xs text-muted-foreground">Juntos pelo seu recomeço.</p>
    </div>
  );
}
