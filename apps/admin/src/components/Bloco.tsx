import type { ReactNode } from "react";

// Uma seção do painel (contrato, cliente): título, o que falta e os campos.

export function Bloco({ titulo, icone, faltam, className = "", children }: {
  titulo: string;
  icone?: ReactNode;
  faltam?: number | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card ${className}`}>
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-4 py-2">
        {icone}
        <h3 className="q-titulo-marca text-[11px] font-semibold text-foreground">{titulo}</h3>
        {faltam != null && (
          <span className={`ml-auto text-xs ${faltam ? "text-warning" : "text-success"}`}>{faltam ? `faltam ${faltam}` : "completo"}</span>
        )}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
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
