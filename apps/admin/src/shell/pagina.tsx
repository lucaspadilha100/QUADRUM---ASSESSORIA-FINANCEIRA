import { useEffect, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ShellNavItem, ShellNavSection } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// O "chrome" da página: título da guia, rolagem e a tela de rota inexistente.
// O Layout chama `usePaginaAtual` e o
// catch-all de cada App.tsx renderiza `PaginaNaoEncontrada`.
// ─────────────────────────────────────────────────────────────────────────────

// Telas que não moram no menu.
const TITULOS_COMUNS: Record<string, string> = {
  "/perfil": "Meu perfil",
};

function itensDoMenu(sections: ShellNavSection[]): ShellNavItem[] {
  const todos: ShellNavItem[] = [];
  const andar = (itens: ShellNavItem[]) => {
    for (const i of itens) {
      todos.push(i);
      if (i.sub) andar(i.sub);
    }
  };
  for (const s of sections) andar(s.items);
  return todos;
}

/** O rótulo do item de menu que melhor casa com o caminho (o prefixo mais longo). */
export function tituloDaRota(
  pathname: string,
  sections: ShellNavSection[],
  extras: Record<string, string> = {},
): string | null {
  const exato = extras[pathname] ?? TITULOS_COMUNS[pathname];
  if (exato) return exato;

  let melhor: { label: string; tam: number } | null = null;
  for (const i of itensDoMenu(sections)) {
    const to = i.to.split("?")[0].replace(/\/$/, "") || "/";
    const casa = to === "/"
      ? pathname === "/"
      : pathname === to || pathname.startsWith(to + "/");
    if (casa && (!melhor || to.length > melhor.tam)) melhor = { label: i.label, tam: to.length };
  }
  return melhor?.label ?? null;
}

/**
 * Título da guia ("Clientes · Quadrum Admin") e rolagem de volta ao topo a cada
 * troca de página.
 *
 * ⚠️ A rolagem é do `<main>`, não da janela: no Layout o corpo é
 * `h-screen` e quem rola é o `<main className="overflow-y-auto">`. O
 * `ScrollRestoration` do React Router só cuida da janela — por isso a página
 * nova abria já rolada até onde a anterior estava.
 *
 * Só o CAMINHO dispara a rolagem: trocar filtro (`?aba=`, `?periodo=`) é a
 * mesma página, e voltar ao topo a cada clique de filtro seria pior.
 */
export function usePaginaAtual(opts: {
  appName: string;
  sections: ShellNavSection[];
  mainRef?: RefObject<HTMLElement | null>;
  titulos?: Record<string, string>;
}) {
  const { pathname } = useLocation();
  const { appName, sections, mainRef, titulos } = opts;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const t = tituloDaRota(pathname, sections, titulos);
    document.title = t ? `${t} · ${appName}` : appName;
    // `sections` é recriado a cada render no Layout; o título só muda com o
    // caminho, então ele não entra nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, appName]);

  useEffect(() => {
    mainRef?.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname, mainRef]);
}

/**
 * Rota que não existe. Antes o catch-all mandava para a home calado — link
 * quebrado ou antigo virava "a tela inicial", e ninguém sabia por quê.
 */
export function PaginaNaoEncontrada({ inicio = "/" }: { inicio?: string }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-5xl font-bold text-muted-foreground/40">404</p>
      <h1 className="text-lg font-semibold text-foreground">Página não encontrada</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        O endereço <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{pathname}</code>{" "}
        não existe neste sistema. O link pode estar desatualizado ou com erro de digitação.
      </p>
      <Link
        to={inicio}
        className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Ir para o início
      </Link>
    </div>
  );
}
