import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// O botão Voltar FECHA a janela aberta (diálogo, gaveta, confirmação), em vez
// de sair da página — o que todo mundo espera no celular, e no Android é o
// gesto mais usado. Montado dentro do DialogContent/SheetContent/
// AlertDialogContent de cada app, então vale para todo diálogo sem tocar em
// tela nenhuma.
//
// Como funciona: ao abrir, empurra uma entrada no histórico (mesma URL, com uma
// marca). O Voltar a consome e o diálogo recebe um Escape — o mesmo caminho do
// teclado, então diálogo que RECUSA Escape (formulário que não pode perder
// dado) continua recusando. Fechando de outro jeito (X, Cancelar, salvar), a
// entrada sobra e é retirada com `history.back()`.
//
// ⚠️ Três cuidados que não são enfeite:
//   1. A marca vai POR CIMA do `history.state` do React Router (`idx`, `key`).
//      Sem ele o roteador perde a conta do índice e o Voltar seguinte se perde.
//   2. Só retira a entrada se ela AINDA for a nossa. Se o diálogo fechou porque
//      alguém clicou num link dentro dele, o roteador já empurrou a página nova
//      — um `back()` ali desfaria a navegação.
//   3. Com dois diálogos empilhados, o Voltar só pode fechar o de CIMA: cada um
//      só reage quando a SUA marca sumiu do topo do histórico.
// ─────────────────────────────────────────────────────────────────────────────

const MARCA = "__quadrumDialogo";
let seq = 0;

export function useVoltarFecha() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const meu = ++seq;
    const nosso = () => (window.history.state as Record<string, unknown> | null)?.[MARCA] === meu;
    const pilha = () => {
      const s = window.history.state as Record<string, unknown> | null;
      return (s?.[`${MARCA}Pilha`] as number[] | undefined) ?? [];
    };

    const base = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.pushState(
      { ...base, [MARCA]: meu, [`${MARCA}Pilha`]: [...pilha(), meu] },
      "",
    );

    let fechadoPeloVoltar = false;
    const onPop = () => {
      // Ainda estou na pilha do topo? Então o Voltar foi de outro diálogo.
      if (nosso() || pilha().includes(meu)) return;
      fechadoPeloVoltar = true;
      window.removeEventListener("popstate", onPop);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (fechadoPeloVoltar) return;
      // Assíncrono: no StrictMode o efeito desmonta e remonta na hora, e o
      // remonte já empurrou outra marca — aí esta não é mais a do topo.
      setTimeout(() => { if (nosso()) window.history.back(); }, 0);
    };
  }, []);
}

/** Para montar DENTRO do conteúdo do diálogo: só existe enquanto ele está aberto. */
export function FecharComVoltar(): null {
  useVoltarFecha();
  return null;
}
