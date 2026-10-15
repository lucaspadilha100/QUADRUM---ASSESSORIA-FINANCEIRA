# Quadrum — instruções para o Claude

Sistema da **Quadrum Assessoria Financeira** (Natal-RN): negociação de dívidas,
redução de juros, proteção do nome, planejamento financeiro.

**Todos os commits são neste repositório.** O `carbohub-gestao` serve só de
REFERÊNCIA: telas e componentes de lá são portados para cá (copiar e adaptar),
nunca editados lá.

## Ordem do projeto
1. **Admin** (`apps/admin`) — back-office da equipe. Vem PRIMEIRO porque tudo o
   que o cliente vê nasce aqui.
2. **Portal do Cliente** (`apps/portal`) — recriação do portal da Sete Capital
   com a marca Quadrum. Especificação: `docs/mapeamento-portal-cliente.md`.

## Stack
React 18 + TypeScript + Vite · Tailwind + shadcn/ui · TanStack Query ·
**Supabase** (Postgres + Auth + RLS) · Vercel.

## Banco
- Migração nova em `supabase/migrations/` com timestamp sequencial. O Claude
  não tem acesso ao banco: **entregue os blocos prontos para colar no SQL
  Editor, na mesma mensagem**, cada um com o que faz e o que esperar de volta.
- Bloco que altera dado vem depois de um bloco que MEDE o estado.
- **Toda regra nova ganha teste em `supabase/testes/rls.mjs`** (Postgres real em
  memória, `npm test`). Rode antes de entregar SQL.
- Listas de negócio são **CADASTRO, nunca CHECK** (setor, banco, linha de
  crédito, tipo de documento): item novo é INSERT, sem deploy.
- **Nada se apaga — desativa.** Cliente, contrato e histórico não têm DELETE.
- A regra mora no **banco**, não na tela (um atendimento ativo por cliente,
  arquivado é só leitura, mensagem não se reescreve).
- ⚠️ **O cliente do portal também é `authenticated`.** Nunca `using (true)` nem
  `auth.uid() is not null`: use `q_e_equipe()` / `q_e_gestor()`. O acesso do
  cliente entra por funções próprias, quando o portal existir.
- ⚠️ Função SECURITY DEFINER nova: `revoke execute ... from public, anon` e
  `grant` explícito — mesmo com os defaults já revogados.
- Documento (CPF/CNPJ) é gravado **só com dígitos** (CHECK garante).
- Consulta de lista que pode passar de 1.000 linhas usa `lib/lerTudo.ts`: o
  PostgREST corta em 1.000 **sem avisar**. Paginar exige ordem estável (`id`).

## Acesso
- Equipe = linha ativa em `public.equipe` (`papel` gestor | membro). Estar logado
  não basta: o `ProtectedRoute` barra quem não tem a linha, e a RLS é a trava.
- Gestor mantém cadastros e equipe; membro opera carteira e atendimento.

## Marca (`docs/marca/`)
Preto Onix `#0B0B0B` · Dourado `#D4AF37` · Cinza Grafite `#2E2E2E` ·
Off White `#F5F5F5` · Azul Petróleo `#0E4A5A`. Montserrat nos títulos (caixa
alta, espaçado: `.q-titulo-marca`), Inter no texto.
- Tokens em `apps/admin/src/index.css` (tripletos HSL: use `hsl(var(--x))`).
- ⚠️ Botão dourado leva texto **Preto Onix**, nunca branco (sem contraste).
- Vermelho só para erro/alerta. Azul Petróleo para link e foco.
- `.q-escuro` escurece qualquer bloco (menu, login) sem mudar componente.
- ⚠️ `simbolo-q.png`/`logotipo.png` são RECORTES provisórios do manual, feitos
  para fundo escuro. Trocar pelos SVG oficiais quando chegarem.

## Verificar de verdade
Dentro de `apps/admin`: `npm run typecheck` (`tsc -b --force` — o `tsc
--noEmit -p tsconfig.json` passa sem checar nada) **e** `npm run build` (o
esbuild não checa tipos).

## Tela nova
Entra no `src/lib/menu.ts` (o título da guia sai de lá) e no `App.tsx`.
Navegação é `<Link>`, nunca `onClick={() => navigate()}`.
