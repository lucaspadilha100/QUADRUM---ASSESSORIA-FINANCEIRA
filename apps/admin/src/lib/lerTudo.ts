// Lê TODAS as linhas de uma consulta do PostgREST, em páginas.
//
// ⚠️ POR QUE ISTO EXISTE
//
// Consulta sem `.limit()` nem `.range()` NÃO devolve tudo: o PostgREST aplica
// um teto (1.000 linhas neste projeto) e **não avisa** — não há erro, não há
// campo "truncado", a resposta parece completa.
//
// Medido em 21/09/2026 no Dashboard Comercial: 1.170 pedidos contavam e a tela
// mostrava 865, com out/25 até jun/26 zerados. A consulta era
// `.order("data_efetiva", { ascending: false })` sem teto — ou seja, as 1.000
// MAIS RECENTES, e o histórico caía fora em silêncio.
//
// ⚠️ E o defeito é invisível até a tabela passar do teto. Abaixo de 1.000
// linhas vem tudo e a tela está certa; ao cruzar, os meses mais antigos somem
// um a um, do mais velho para o mais novo, sem nada quebrar. É a mesma família
// do `ascending: true` + `.limit()` do Carbo Chat — lá vinha o começo, aqui
// vinha o fim, e nos dois casos o que falta não se anuncia.
//
// ⚠️ ORDEM ESTÁVEL É OBRIGATÓRIA. Paginar por `range` pede que a ordenação
// seja determinística: `data_efetiva` é DATE e tem centenas de empates por dia,
// então sem um critério de desempate único (`id`) o Postgres pode devolver a
// mesma linha em duas páginas e nenhuma vez uma outra. Quem chama precisa
// encadear um `.order("id", ...)` depois do critério principal.
//
// Não confunda com um filtro: isto lê TUDO o que a consulta seleciona. Se o
// conjunto é grande, o lugar de encolher é o `where`, não aqui.

type Pagina<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

const TAMANHO_PADRAO = 1000;

// Teto de sanidade: sem ele, um filtro esquecido vira um laço que baixa a
// tabela inteira e trava a aba. Falhar alto e explicando é melhor que rodar
// para sempre.
const TETO_ABSURDO = 200_000;

export async function lerTudo<T>(
  pagina: (de: number, ate: number) => Pagina<T>,
  tamanho: number = TAMANHO_PADRAO,
): Promise<T[]> {
  const tudo: T[] = [];

  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw new Error(error.message);

    const lote = data ?? [];
    tudo.push(...lote);

    // Página incompleta = acabou. É o único sinal confiável de fim: o
    // PostgREST não diz quantas linhas existem a menos que se peça `count`.
    if (lote.length < tamanho) return tudo;

    if (tudo.length >= TETO_ABSURDO) {
      throw new Error(
        `lerTudo: passou de ${TETO_ABSURDO.toLocaleString("pt-BR")} linhas. ` +
          "Isso é falta de filtro na consulta, não volume real.",
      );
    }
  }
}
