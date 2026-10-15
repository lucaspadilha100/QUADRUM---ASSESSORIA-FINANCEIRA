# Quadrum — instruções para o Claude

Sistema da **Quadrum Assessoria Financeira** (Natal-RN): negociação de dívidas,
redução de juros, proteção do nome, planejamento financeiro.

**Todos os commits são neste repositório.** O `carbohub-gestao` serve só de
REFERÊNCIA: telas e componentes de lá são portados para cá (copiar e adaptar),
nunca editados lá.

## Git
Tudo direto na **`main`**. Branch só quando o dono do processo PEDIR (para
testar algo fora da produção).

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

## Pipeline (kanban) — o CARD É O CONTRATO
Pedido do dono do processo (15/10/2026): a pipeline do CRM da Carbo (card,
arrastar e soltar), casando com o Portal do Cliente. Portada de
`carbohub-gestao/apps/crm` (KanbanDnd, KanbanBoard, LeadCard), sem funil,
repasse nem temperatura.

```
pipeline_etapas (CADASTRO)   colunas; uma com `aceita`
contratos.etapa_id           a coluna do card (NOT NULL; novo cai na 1ª ativa)
contratos.etapa_desde        "N dias nesta etapa" — quem grava é o gatilho
etapa `aceita`               → data_aceite = hoje → o cliente VÊ no portal
"Perdido"                    → cancelado_em (NÃO é etapa) → selo CANCELADO
```

- ⚠️ "Perdido" não é coluna: é `cancelado_em`, a mesma que o portal lê. Uma
  etapa "Perdido" seria a segunda verdade sobre o cancelamento.
- ⚠️ Voltar o card NÃO apaga `data_aceite`: aceite é fato, não posição.
- O card aberto tem as abas do PORTAL (Dados, Histórico, Atendimentos) mais
  Pendências, e cada aba diz o que o cliente vai ver. Histórico de
  departamento `urgente` não aparece na lista do cliente — só o aviso.
- `autoScroll` do quadro em 10% da borda: com 20% ele rolava antes da hora e
  o card caía na coluna vizinha (medido no teste de arraste).

## Portal do Cliente (`apps/portal`) — o cliente só fala com FUNÇÕES
Recriação do portal da Sete Capital (docs/mapeamento-portal-cliente.md):
login por CPF/CNPJ, Meus Contratos (avisos, pendências, abas Dados/Histórico/
Atendimentos) e o chat com o robô. Migração `20261015030000`.

```
login           CPF/CNPJ → e-mail SINTÉTICO <doc>@portal.quadrum.example
                q_portal_email() no banco = emailDoDocumento() no portal
senha           a EQUIPE gera no card (q_portal_definir_senha); sem cadastro
leitura         portal_eu · portal_contratos · portal_avisos · portal_setores
                portal_chat_ativo · portal_chat
escrita         portal_abrir_atendimento · portal_enviar_mensagem
                portal_marcar_historico_lido · portal_marcar_chat_lido
```

- ⚠️ **O cliente NÃO tem policy em tabela nenhuma.** Tudo passa pelas funções
  `portal_*`, que descobrem quem ele é pela SESSÃO (`q_cliente_da_sessao`) e
  nunca por id vindo da tela. Função nova do portal segue o mesmo molde.
- ⚠️ O TEXTO de histórico urgente nunca sai do banco: só `urgente_nao_lido`.
- ⚠️ As falas do ROBÔ são gravadas pelo banco (`portal_abrir_atendimento`), não
  pela tela — senão o cliente gravaria qualquer coisa "dita pelo robô". As
  frases no `Chat.tsx` são cópia de exibição; mudou lá, mude aqui.
- ⚠️ `q_portal_definir_senha` escreve em `auth.users` com os tokens `''`, nunca
  nulos: token nulo faz o Auth falhar no LOGIN ("Database error querying
  schema"), longe de onde o erro nasceu.
- O atendimento nasce com o CONSULTOR do contrato como responsável — é assim
  que o colaborador vê o chat do cliente dele.
- Sem tempo real: chat e avisos releem a cada 15 s (portal e admin).

⚠️ **Arquivos COPIADOS entre `admin` e `portal`** (mesmo conteúdo, mude nos
dois): `src/index.css` (tokens da marca), `src/lib/formato.ts`,
`src/lib/utils.ts`, `src/integrations/supabase/client.ts`, `.env`,
`tailwind.config.ts`, os `components/ui/*` em comum e os PNG da marca. Copiar
foi escolha (cada app builda sozinho no Vercel); o custo é esta lista.

## Supabase
Projeto `qeahvsdlatrkdusxvbvv` (`https://qeahvsdlatrkdusxvbvv.supabase.co`).
URL e anon key ficam em `apps/admin/.env`, VERSIONADO de propósito: são
públicas (vão no bundle). ⚠️ `service_role` nunca entra no repo.
O ambiente cloud do Claude bloqueia `*.supabase.co` por padrão — teste ao vivo
só com o host liberado em Network access.
Aplicadas (conferidas pelo retorno de cada bloco, 15/10/2026):
`20261015000000` (estrutura inicial) e `20261015010000` (gestor/colaborador e
perfis), `20261015020000` (pipeline), `20261015030000` (portal do cliente). Primeiro gestor: cadastrado à mão pelo bloco de bootstrap (não é
migração — depende do usuário criado em Authentication).

## Deploy (Vercel) — UM projeto, dois apps
Pedido do dono do processo (15/10/2026): admin e portal no MESMO projeto do
Vercel, mudando só o endereço. Um push na `main` = um deploy.

```
/          admin          apps/admin
/portal    Portal do Cliente   apps/portal (vite `base: "/portal/"`, router basename)
```

- O `vercel.json` da raiz instala os dois e chama `scripts/vercel-build.sh`,
  que junta os builds em `./dist` (admin na raiz, portal em `dist/portal`).
  As rewrites mandam `/portal/*` para o index do portal e o resto para o do admin.
- ⚠️ A raiz NÃO tem `package.json`: sem o `vercel.json` o Vercel chama
  `vite build` sem instalar nada (`vite: command not found`, o 1º deploy).
- ⚠️ São DOIS `vercel.json` com o MESMO efeito — o da raiz e o de
  `apps/admin` — porque o Root Directory do projeto no Vercel pode estar em
  qualquer um dos dois, e o Vercel lê só o da pasta escolhida. Os dois juntam
  admin + portal pelo `scripts/vercel-build.sh`. Mudou um, mude o outro.
- ⚠️ O Vercel publica em produção a branch PADRÃO do GitHub. Em 15/10 ela ainda
  era `claude/keen-turing-ftz5o8` (a primeira a subir): a `main` só gerava
  preview, e `/portal` abria o admin antigo. Enquanto a padrão não for a
  `main` (GitHub → Settings → Default branch; Vercel → Settings → Git →
  Production Branch), aquela branch é avançada até a `main` a cada entrega.
- ⚠️ Mesmo endereço ⇒ cada app guarda a sessão numa chave própria
  (`VITE_AUTH_STORAGE_KEY` no `.env` de cada um), senão abrir o portal
  derrubaria o login do admin no mesmo navegador.
- O diálogo "Acesso ao portal" monta o link com o endereço do próprio admin +
  `/portal`. `VITE_PORTAL_URL` só se o portal ganhar domínio próprio.

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
