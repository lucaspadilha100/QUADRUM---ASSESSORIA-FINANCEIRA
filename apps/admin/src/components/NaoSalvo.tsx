import { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as AD from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";
import { useVoltarFecha } from "@/shell/voltarFecha";

// ─────────────────────────────────────────────────────────────────────────────
// Alteração NÃO SALVA no painel (contrato, cliente). Cada formulário avisa se
// está diferente do que está gravado (`useNaoSalvo`); quem FECHA o painel (X,
// Esc, clique fora, Voltar, "← Voltar para o cliente") pergunta antes
// (`liberarSaida`): Salvar · Descartar · Continuar editando. Recarregar a
// página com algo pendente pede confirmação do navegador.
// ⚠️ Módulo, não Provider: um painel aberto por vez, e o painel de cliente e o
// de contrato estão em telas diferentes.
// ─────────────────────────────────────────────────────────────────────────────

interface Pendente { rotulo: string; salvar: () => Promise<boolean> }
const pendentes = new Map<string, Pendente>();

function aoRecarregar(e: BeforeUnloadEvent) {
  if (pendentes.size === 0) return;
  e.preventDefault();
  e.returnValue = "";
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", aoRecarregar);

/** O formulário avisa que tem alteração não salva (`sujo`) e como salvar (devolve se deu certo). */
export function useNaoSalvo(sujo: boolean, rotulo: string, salvar: () => Promise<boolean>) {
  const chave = useId();
  const ref = useRef(salvar);
  ref.current = salvar;
  useEffect(() => {
    if (sujo) pendentes.set(chave, { rotulo, salvar: () => ref.current() });
    else pendentes.delete(chave);
    return () => { pendentes.delete(chave); };
  }, [chave, sujo, rotulo]);
}

/** Pode fechar? Sem nada pendente, sim; com pendência, pergunta (e salva, se pedirem). */
export async function liberarSaida(): Promise<boolean> {
  if (pendentes.size === 0) return true;
  const lista = [...pendentes.values()];
  const escolha = await perguntar(lista.map((p) => p.rotulo));
  if (escolha === "continuar") return false;
  if (escolha === "descartar") { pendentes.clear(); return true; }
  for (const p of lista) if (!(await p.salvar())) return false;
  pendentes.clear();
  return true;
}

type Escolha = "salvar" | "descartar" | "continuar";

function perguntar(rotulos: string[]): Promise<Escolha> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const raiz = createRoot(host);
    const fim = (e: Escolha) => { resolve(e); setTimeout(() => { raiz.unmount(); host.remove(); }, 0); };
    raiz.render(<Janela rotulos={rotulos} onFim={fim} />);
  });
}

function Janela({ rotulos, onFim }: { rotulos: string[]; onFim: (e: Escolha) => void }) {
  const feito = useRef(false);
  const [salvando, setSalvando] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  useVoltarFecha();
  const terminar = (e: Escolha) => { if (feito.current) return; feito.current = true; if (e === "salvar") setSalvando(true); onFim(e); };
  const base = "inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium";
  return (
    <AD.Root open onOpenChange={(o) => { if (!o) terminar("continuar"); }}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-[100] bg-black/70" />
        <AD.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); botao.current?.focus(); }}
          className="fixed left-1/2 top-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 text-foreground shadow-lg"
        >
          <AD.Title className="text-lg font-semibold">Salvar as alterações?</AD.Title>
          <AD.Description className="mt-2 text-sm text-muted-foreground">
            Alterado e não salvo: {rotulos.join(" e ")}.
          </AD.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => terminar("continuar")}
              className={`${base} border border-input bg-background hover:bg-accent hover:text-accent-foreground`}>Continuar editando</button>
            <button type="button" onClick={() => terminar("descartar")}
              className={`${base} border border-destructive/40 bg-background text-destructive hover:bg-destructive/10`}>Descartar</button>
            <button ref={botao} type="button" onClick={() => terminar("salvar")} disabled={salvando}
              className={`${base} bg-primary text-primary-foreground hover:bg-primary/90`}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
