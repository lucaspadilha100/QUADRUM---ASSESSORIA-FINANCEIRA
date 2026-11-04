import type { ReactNode } from "react";

// Uma seção do painel (contrato, cliente): título, o que falta e os campos.
// "faltam N" é BOTÃO: leva ao primeiro campo vazio da seção.

export function Bloco({ titulo, icone, faltam, className = "", children }: {
  titulo: string;
  icone?: ReactNode;
  faltam?: number | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-faltam={faltam ?? 0} className={`q-secao min-w-0 scroll-mt-16 overflow-hidden rounded-xl ${className}`}>
      <header className="q-secao-titulo flex min-h-11 items-center gap-2 px-4 py-2">
        {icone}
        <h3 className="q-titulo-marca text-[11px] font-semibold text-foreground">{titulo}</h3>
        {faltam != null && (faltam ? (
          <button type="button" onClick={(e) => focarVazio(e.currentTarget.closest("section"))}
            className="ml-auto min-h-8 rounded px-1.5 text-xs font-medium text-warning hover:bg-warning/10 hover:underline">
            faltam {faltam}
          </button>
        ) : (
          <span className="ml-auto text-xs text-success">completo</span>
        ))}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

const vazio = (el: Element) => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() === "" && !el.disabled && el.type !== "hidden" && el.type !== "file";
  if (el.getAttribute("role") === "combobox") {
    return el.hasAttribute("data-placeholder") || /não informado/i.test(el.textContent ?? "");
  }
  return false;
};

/** Rola até a seção e põe o cursor no primeiro campo vazio dela. */
export function focarVazio(secao: Element | null) {
  if (!secao) return;
  secao.scrollIntoView({ behavior: "smooth", block: "start" });
  const alvo = [...secao.querySelectorAll("input, textarea, button[role=combobox]")].find(vazio) as HTMLElement | undefined;
  if (alvo) setTimeout(() => alvo.focus({ preventScroll: true }), 350);
}

/** A primeira seção (dentro de `raiz`) com campo faltando: rola até ela e foca o campo. */
export function irParaPrimeiraFalta(raiz: Element | null) {
  const secao = raiz?.querySelector("section[data-faltam]:not([data-faltam='0'])") ?? null;
  focarVazio(secao);
}

// O <label> envolve o campo: o rótulo fica ligado a ele (leitor de tela, clique).
export function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 space-y-1.5 ${className}`}>
      <span className="block text-sm font-medium leading-none">{rotulo}</span>
      {children}
    </label>
  );
}
