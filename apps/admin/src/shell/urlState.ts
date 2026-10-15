import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// Estado de tela que mora na URL (`?aba=`, `?busca=`…), para F5, link
// compartilhado e o botão Voltar funcionarem como se espera de um app.
//
// ⚠️ Duas formas de gravar, e a diferença é o botão Voltar:
//   push    (padrão)  aba, período, filtro — o Voltar desfaz a troca
//   replace           busca digitada — uma entrada no histórico por LETRA
//                     faria o Voltar apagar a busca caractere a caractere
//
// ⚠️ O valor padrão NÃO vai para a URL: assim o endereço limpo continua
// significando "como a tela abre", e um link antigo sem o parâmetro não muda
// de sentido quando o padrão mudar.
//
// ⚠️ Cada chamada parte da URL ATUAL do navegador (`window.location.search`),
// NÃO do `prev` do `setSearchParams`: no React Router 6.30 a forma funcional
// recebe os parâmetros do ÚLTIMO RENDER, então dois filtros trocados no mesmo
// clique (o "Limpar" do intervalo zera `de` e `ate`) apagavam um ao outro e só
// o último sobrevivia. O `pushState` do roteador é síncrono, então a segunda
// chamada já enxerga o que a primeira gravou.
// ─────────────────────────────────────────────────────────────────────────────

// Duas trocas no MESMO clique (o "Limpar" zera `de` e `ate`) são UMA ação para
// quem clicou: a segunda grava com `replace`, para o Voltar desfazer as duas
// juntas em vez de parar num estado intermediário que ninguém viu.
let gravouNesteClique = false;

export function useParamUrl(
  chave: string,
  padrao = "",
  opts: { replace?: boolean } = {},
): [string, (valor: string | null | undefined) => void] {
  const [params, setParams] = useSearchParams();
  const valor = params.get(chave) ?? padrao;

  const definir = useCallback(
    (novo: string | null | undefined) => {
      const p = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );
      if (novo == null || novo === "" || novo === padrao) p.delete(chave);
      else p.set(chave, novo);
      const substituir = (opts.replace ?? false) || gravouNesteClique;
      gravouNesteClique = true;
      queueMicrotask(() => { gravouNesteClique = false; });
      setParams(p, { replace: substituir });
    },
    [chave, padrao, opts.replace, setParams],
  );

  return [valor, definir];
}
