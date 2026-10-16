import { useSyncExternalStore } from "react";

// Tema claro/escuro. A escolha fica no navegador (admin e portal moram no mesmo
// endereço, então valem para os dois); sem escolha, segue o sistema.
// O `index.html` aplica a classe ANTES do React, senão a tela pisca clara.
// Estado ÚNICO para a página: dois botões (celular e computador) nunca discordam.
// ⚠️ Arquivo COPIADO, idêntico, em apps/admin e apps/portal.

export type Tema = "claro" | "escuro";
const CHAVE = "quadrum-tema";
const ouvintes = new Set<() => void>();

const atual = (): Tema => (document.documentElement.classList.contains("dark") ? "escuro" : "claro");

function definir(t: Tema) {
  document.documentElement.classList.toggle("dark", t === "escuro");
  try { localStorage.setItem(CHAVE, t); } catch { /* só não lembra */ }
  ouvintes.forEach((f) => f());
}

export function useTema() {
  const tema = useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f); }, atual, () => "claro" as Tema);
  return { tema, alternar: () => definir(tema === "escuro" ? "claro" : "escuro") };
}
