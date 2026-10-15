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
  `auth.uid() is not null`: use `q_e_equipe()` / `q_e_gestor()` / `q_ve_*()`. O acesso do
  cliente entra por funções próprias, quando o portal existir.
- ⚠️ Função SECURITY DEFINER nova: `revoke execute ... from public, anon` e
  `grant` explícito — mesmo com os defaults já revogados.
- Documento (CPF/CNPJ) é gravado **só com dígitos** (CHECK garante).
- Consulta de lista que pode passar de 1.000 linhas usa `lib/lerTudo.ts`: o
  PostgREST corta em 1.000 **sem avisar**. Paginar exige ordem estável (`id`).

## Acesso — GESTOR e COLABORADOR (sem matriz de telas)
Pedido do dono do processo (15/10/2026): cada pessoa tem o seu perfil, e o
NÍVEL decide o que ela vê. O cliente do portal é usuário comum, sem nível.

```
GESTOR       vê e opera tudo; mantém cadastros, usuários; transfere carteira
COLABORADOR  vê só a PRÓPRIA carteira: clientes de que é consultor e o que
             pende deles (contratos, histórico, documentos, atendimentos),
             mais o atendimento em que é o responsável
```

- Equipe = linha ativa em `public.perfis`. Estar logado não basta: o
  `ProtectedRoute` barra quem não tem a linha, e a RLS é a trava.
- A regra é UMA, encadeada no banco: `q_ve_cliente` → `q_ve_contrato` /
  `q_ve_atendimento`. Tela nova que lista carteira não filtra por consultor à
  mão — a RLS já devolve só o que a pessoa pode ver.
- ⚠️ **Ninguém muda o próprio nível**: `trg_perfil_protege_acesso` recusa
  mudar `papel`, `ativo`, `unidade_id` e `email` para quem não é gestor. Coluna
  nova de ACESSO em `perfis` entra nessa lista.
- ⚠️ **Regra de LEITURA da própria tabela olha a COLUNA**, nunca uma função que
  relê a tabela: o Supabase confere a leitura da linha recém-gravada
  (RETURNING), e a função ainda não a enxerga — dá "new row violates
  row-level security" num cadastro legítimo. Medido no teste.
- ⚠️ O mesmo no WITH CHECK do UPDATE: é a coluna da linha nova que impede o
  colaborador de passar um cliente a outra pessoa.
- Corpo de função SQL guarda nome de tabela em TEXTO: renomeou tabela,
  recrie as funções que a citam (a 20261015010000 teve de fazer isso).

## Supabase
Projeto `qeahvsdlatrkdusxvbvv` (`https://qeahvsdlatrkdusxvbvv.supabase.co`).
Aplicadas (conferidas pelo retorno de cada bloco, 15/10/2026):
`20261015000000` (estrutura inicial) e `20261015010000` (gestor/colaborador e
perfis). Primeiro gestor: cadastrado à mão pelo bloco de bootstrap (não é
migração — depende do usuário criado em Authentication).

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
