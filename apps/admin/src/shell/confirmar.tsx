import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as AD from "@radix-ui/react-alert-dialog";
import { useVoltarFecha } from "./voltarFecha";

// ─────────────────────────────────────────────────────────────────────────────
// Confirmação e pergunta curta no visual do sistema, no lugar de
// `window.confirm`/`window.prompt` — a janelinha cinza do navegador, que não
// segue o tema, não diz qual ação é perigosa e no celular aparece como alerta
// do sistema operacional.
//
//   if (!(await confirmar({ titulo: "Apagar o mapa?", confirmar: "Apagar", perigo: true }))) return;
//   const motivo = await pedirTexto({ titulo: "Por que cancelar?", obrigatorio: true });
//
// ⚠️ É IMPERATIVO de propósito (devolve uma Promise, como o `confirm`): assim
// trocar o nativo é uma linha, sem estado novo na tela nem Provider nos oito
// apps. Monta a própria raiz no `<body>`; o tema vem da classe `dark` no
// `<html>`, então segue claro/escuro sem receber nada.
//
// ⚠️ Esc e o Voltar do navegador CANCELAM — nunca confirmam.
//
// ⚠️ É o MESMO Radix dos diálogos dos apps (`@radix-ui/react-alert-dialog`, no
// `dedupe` do vite.config de cada app), e não uma `div` própria: aberto POR
// CIMA de outro diálogo, só o Radix sabe empilhar — com uma `div`, o diálogo de
// baixo tomava o foco de volta e fechava no clique.
// ─────────────────────────────────────────────────────────────────────────────

interface Base {
  titulo: string;
  mensagem?: string;
  /** Texto do botão de confirmar (padrão "Confirmar"). */
  confirmar?: string;
  cancelar?: string;
  /** Ação destrutiva: botão vermelho. */
  perigo?: boolean;
}

interface ComTexto extends Base {
  rotulo?: string;
  placeholder?: string;
  valorInicial?: string;
  /** Recusa confirmar com o campo vazio. */
  obrigatorio?: boolean;
  multilinha?: boolean;
}

type Resultado = { ok: boolean; texto: string };

function abrir(opts: ComTexto, comTexto: boolean): Promise<Resultado> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const raiz = createRoot(host);
    const fim = (r: Resultado) => {
      resolve(r);
      // Fora do evento que fechou: desmontar a raiz no meio do clique dela
      // própria faz o React reclamar.
      setTimeout(() => { raiz.unmount(); host.remove(); }, 0);
    };
    raiz.render(<Janela opts={opts} comTexto={comTexto} onFim={fim} />);
  });
}

function Janela({ opts, comTexto, onFim }: {
  opts: ComTexto; comTexto: boolean; onFim: (r: Resultado) => void;
}) {
  const [texto, setTexto] = useState(opts.valorInicial ?? "");
  const botao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const feito = useRef(false);
  useVoltarFecha();

  const podeConfirmar = !comTexto || !opts.obrigatorio || texto.trim().length > 0;
  const terminar = (r: Resultado) => {
    if (feito.current) return;
    feito.current = true;
    onFim(r);
  };
  const confirmar = () => { if (podeConfirmar) terminar({ ok: true, texto: texto.trim() }); };
  const cancelar = () => terminar({ ok: false, texto: "" });

  const corBotao = opts.perigo
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90";
  const campoCls =
    "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <AD.Root open onOpenChange={(o) => { if (!o) cancelar(); }}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-[100] bg-black/70" />
        <AD.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); (comTexto ? campo.current : botao.current)?.focus(); }}
          className="fixed left-1/2 top-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 text-foreground shadow-lg"
        >
          <AD.Title className="text-lg font-semibold">{opts.titulo}</AD.Title>
          {opts.mensagem ? (
            <AD.Description className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
              {opts.mensagem}
            </AD.Description>
          ) : (
            <AD.Description className="sr-only">{opts.titulo}</AD.Description>
          )}
          {comTexto && (
            <label className="mt-4 block text-sm font-medium">
              {opts.rotulo}
              {opts.multilinha ? (
                <textarea
                  ref={campo}
                  rows={3}
                  value={texto}
                  placeholder={opts.placeholder}
                  onChange={(e) => setTexto(e.target.value)}
                  className={campoCls}
                />
              ) : (
                <input
                  ref={campo}
                  value={texto}
                  placeholder={opts.placeholder}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } }}
                  className={campoCls}
                />
              )}
            </label>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancelar}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              {opts.cancelar ?? "Cancelar"}
            </button>
            <button
              ref={botao}
              type="button"
              onClick={confirmar}
              disabled={!podeConfirmar}
              className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 ${corBotao}`}
            >
              {opts.confirmar ?? "Confirmar"}
            </button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

/** Substituto de `window.confirm`. Resolve `true` só no clique em confirmar. */
export async function confirmar(opts: Base): Promise<boolean> {
  return (await abrir(opts, false)).ok;
}

/** Substituto de `window.prompt`. Resolve o texto (sem espaços nas pontas) ou `null` se cancelou. */
export async function pedirTexto(opts: ComTexto): Promise<string | null> {
  const r = await abrir(opts, true);
  return r.ok ? r.texto : null;
}
