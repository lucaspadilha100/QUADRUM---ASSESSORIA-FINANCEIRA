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
- ⚠️ **Lista de carteira NÃO baixa tudo**: tela de lista pede UMA página ao
  banco (`q_*_pagina`, ver "Escala"). `lib/lerTudo.ts` fica só para cadastro
  curto que precise ler inteiro: o PostgREST corta em 1.000 **sem avisar**, e
  paginar exige ordem estável (`id`).

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
- O PORTAL não tem tempo real (o cliente não tem policy em tabela, o Realtime
  não teria o que lhe entregar): Meus Contratos relê a cada 20 s, o chat aberto
  a cada 5 s. O ADMIN é ao vivo (ver "Ao vivo").

⚠️ **Arquivos COPIADOS entre `admin` e `portal`** (mesmo conteúdo, mude nos
dois): `src/components/documento/DocumentoImpresso.tsx` (o documento e o
manifesto de assinatura), `src/index.css` (tokens da marca), `src/lib/formato.ts`,
`src/lib/utils.ts`, `src/integrations/supabase/client.ts`, `.env`,
`tailwind.config.ts`, `src/components/TrocarSenha.tsx`, os `components/ui/*` em comum e os PNG da marca. Copiar
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
`20261016000000` (criar usuário da equipe, sobra um gestor, caixa de
atendimentos) — aplicada e conferida em 15/10/2026 (3 funções, 1 gatilho,
caixa com `security_invoker=true`). Sem ela, Usuários e Atendimentos abrem
com erro.
`20261017000000` (escala) e `20261017010000` (modelos e assinatura) —
aplicadas e conferidas em 15/10/2026 (7 + 7 funções, 4 modelos inativos, as 4
views com `security_invoker=true`, nenhum cliente sem `busca`). Sem elas,
Painel, Pipeline, Clientes, Contratos, Documentos e Atendimentos abrem com erro.
`20261018000000` (ao vivo) — aplicada e conferida em 15/10/2026 (8 tabelas na
publicação `supabase_realtime`). Sem ela o admin funciona, mas só atualiza com
F5 ou ao voltar à aba.
`20261018010000` (senha provisória) — aplicada e conferida em 15/10/2026 (3
funções, 3 gatilhos, 2 contas marcadas provisórias). Login de teste
`teste@email.com` (gestor) criado pelo SQL Editor, sem senha provisória.
`20261019000000` (notificações, departamento, fotos) — aplicada e conferida em
16/10/2026 (9 funções, 5 gatilhos, coluna `departamento_id`, bucket
`avatares` público com 4 regras).

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
⚠️ **Sem texto explicando a tela, o campo ou o botão** (pedido do dono do
processo, 15/10/2026: "polui demais o sistema"). Nada de descrição sob o
título, dica sob o campo, rótulo com parêntese "(o cliente vê…)" nem
parágrafo dizendo o que acontece ao clicar. Fica o que é DADO ou ESTADO:
valores, contagens, vazio, erro, confirmação de ação destrutiva. Descrição de
diálogo que o Radix exige vai `sr-only`.
Entra no `src/lib/menu.ts` (o título da guia sai de lá) e no `App.tsx`.
Navegação é `<Link>`, nunca `onClick={() => navigate()}`.
Filtro, aba, busca e item aberto moram na URL (`useParamUrl`): F5 e link
copiado reabrem a mesma coisa. O Painel linka cada número para a lista já
filtrada (`/contratos?situacao=portal`, `/atendimentos?aba=nao_lidas`).
⚠️ **Celular é uso de verdade** (pedido do dono do processo, 16/10/2026: o
cliente usa o portal pelo celular, e a equipe usa o admin em emergência).
Referência 360 px (conferido também em 320 e 390): nada rola de lado, alvo de
toque ≥ 36 px no celular (`min-h-9`/`h-10` com `sm:` voltando ao compacto),
campo de digitação com 16 px no celular (o iPhone dá zoom em campo menor),
texto de documento justificado só a partir de `sm`, 4+ abas viram grade 2×2
(portal) ou rolagem (painel do contrato), tabela larga rola dentro do cartão,
e lista não corta nome no celular (empilha; `truncate` só a partir de `sm`).
⚠️ **Data é `components/CampoData.tsx`, nunca `<input type="date">`**: o
calendário do navegador muda de ano clicando mês a mês (pedido do dono do
processo, 15/10/2026). O nosso aceita digitar DD/MM/AAAA e tem mês e ano em
lista; o valor é o mesmo "AAAA-MM-DD".

## Telas do admin (15/10/2026)
Painel · Pipeline · Atendimentos · Clientes · Contratos · Documentos p/ assinar ·
Modelos de documento · Bancos · Linhas de crédito · Unidades · Departamentos e
setores · Usuários. Bancos, Linhas e Unidades usam o MESMO componente
(`components/CadastroSimples.tsx`): lista, busca, novo/editar e ativar na linha.
- Quando falta banco para gerar documento, o banco se escolhe NO PRÓPRIO
  AVISO (`BancoAqui` no `GerarDocumento`), com "+ Cadastrar banco…" para o
  gestor. A Unidade do contrato (que o portal mostra) fica na aba Contrato.
- O painel do contrato (`ContratoDetalhe`/`ContratoPainel`) é UM só: abre na
  Pipeline, em Contratos, em Documentos e DENTRO da ficha do cliente (com
  "← Voltar para o cliente"). Abas: Contrato · Cliente · Histórico ·
  Pendências · Chat. ⚠️ **Nada dentro do painel manda para outra tela**
  (pedido do dono do processo, 15/10/2026: "abre outra barra lateral e não
  tem como voltar"): o "falta RG / falta banco" troca de ABA; os dados do
  cliente se editam na aba Cliente (`EdicaoCliente`, a mesma da ficha).
- ⚠️ **Navegar DENTRO do painel não grava no histórico** (aba, cliente →
  contrato são estado do painel). Uma entrada nova por cima apaga a marca do
  "Voltar fecha o diálogo" (`shell/voltarFecha.ts`), e confirmar qualquer coisa
  no painel passava a FECHAR o painel inteiro (medido no teste).
  `?painel=cliente` só ABRE o painel numa aba.
- Banco no contrato: `SelectBanco`, com "+ Cadastrar banco…" para o gestor. O aviso de geração separa o que falta no
  CLIENTE do que falta no CONTRATO. A conversa (`components/atendimento/Conversa.tsx`) é a mesma no
  card e na caixa de Atendimentos; o acesso ao portal (`AcessoPortal.tsx`), o
  mesmo no card e em Clientes.
- ⚠️ A caixa lê a view `atendimentos_caixa` (`security_invoker`): a RLS das
  tabelas vale nela. Republicar SEMPRE com `with (security_invoker = true)`,
  senão ela roda como dono e o colaborador vê a caixa inteira. O cliente é
  `left join`: o responsável por atendimento de OUTRA carteira vê a conversa
  sem os dados do cliente (medido no teste).
- Usuário da equipe nasce pela tela (`q_equipe_criar_usuario`, e-mail real já
  confirmado, senha gerada e mostrada UMA vez). Ninguém some: desativar é
  `ativo = false`. ⚠️ `trg_perfil_sobra_um_gestor` recusa rebaixar ou
  desativar o ÚLTIMO gestor ativo — sem ele, só o SQL Editor devolveria a gestão.
- A mesma conta não é equipe e cliente: a função recusa e-mail de cliente.

## Escala — a tela pede UMA página, o banco conta (15/10/2026)
Pedido do dono do processo: "parece um app que vai atender 10 clientes só".
Migração `20261017000000_escala.sql`.

```
q_clientes_pagina · q_contratos_pagina · q_documentos_pagina · q_caixa_pagina
      → { linhas: a página pedida (20/50/100), contagem: o número de cada filtro }
q_pipeline   → as primeiras 30 de cada coluna + o TOTAL; `p_limites` = "carregar mais"
q_painel     → os números do Painel, contados no banco
contratos_lista · clientes_lista · documentos_lista · atendimentos_caixa   (views)
```

- Página, tamanho, busca e filtros moram na URL (`usePaginacaoUrl`,
  `components/Paginacao.tsx`). Trocar filtro volta à página 1.
- ⚠️ **A busca e a contagem são do MESMO lugar** (a função de página): a
  contagem do chip e a lista não têm como discordar. Busca é por PALAVRA e sem
  acento (`q_casa_busca` sobre colunas normalizadas por `q_busca`): "graca oliv"
  acha "Maria das Graças Oliveira"; CPF com máscara vira só dígitos.
  `clientes.busca` é coluna GERADA (normalizada uma vez, não a cada tecla).
- ⚠️ As funções de página são **SECURITY INVOKER**: a RLS das tabelas vale
  nelas. Não as torne DEFINER — o colaborador passaria a ver a carteira toda.
- ⚠️ **Escolher contrato é BUSCA, nunca dropdown com todos**
  (`components/busca/BuscaContrato.tsx`, 10 resultados do banco). Dropdown só
  para cadastro curto (etapa, setor, equipe, modelo).
- ⚠️ Painel/lista abertos **por id** (`useContrato`, `useCliente`,
  `useItemCaixa`): a lista é uma página, e o link direto tem de abrir mesmo
  fora dela.
- ⚠️ **Regras de acesso sem consulta por linha**: `(select q_e_gestor())`
  (o Postgres calcula uma vez) e `cliente_id in (select q_meus_clientes())`
  em vez de `q_ve_cliente(cliente_id)` linha a linha. MESMA regra (os testes
  antigos passam todos); regra nova segue o molde.
- Conversa: as últimas 300 mensagens (desc + limit, virado na tela — asc +
  limit traria as MAIS ANTIGAS); histórico do card: as últimas 200.
- Cada tela é baixada quando é aberta (`lazy` no `App.tsx`, `Suspense` no
  `Layout`), e as bibliotecas saem num arquivo próprio (`manualChunks`), que o
  navegador guarda entre deploys.

## Ao vivo — o admin se atualiza sozinho (15/10/2026)
Pedido do dono do processo: "só apareceu assinado quando dei F5… assinou já
altera tudo". Migração `20261018000000_ao_vivo.sql` (as tabelas entram na
publicação `supabase_realtime`) + `hooks/useAoVivo.tsx`, montado no `Layout`.

- O aviso do banco NÃO carrega o dado: só diz qual consulta ficou velha
  (`AFETA`), e a tela relê pelo caminho de sempre (RLS, página, contagem).
  Vários avisos juntos viram UMA releitura (250 ms).
- O Realtime confere a RLS de quem escuta: o colaborador só é avisado da
  própria carteira. Um canal POR TABELA: tabela fora da publicação derruba só
  o canal dela (`CHANNEL_ERROR` no console).
- ⚠️ Tabela nova que a equipe precisa ver mudar entra na migração **e** no
  `AFETA` (o teste confere que as listas batem).
- Aviso na tela: documento assinado pelo cliente e mensagem do cliente (com
  link), menos para quem já está com aquela conversa aberta.
- Realtime não reentrega o que passou: reconectou, relê; voltar à aba relê
  (`refetchOnWindowFocus`). O `<Toaster>` mora DENTRO do `BrowserRouter`
  (o aviso leva `<Link>`).
- ⚠️ Formulário que copia o dado para o estado local reinicia pelos VALORES,
  nunca pelo objeto: a releitura sozinha traz objeto novo e apagaria o que a
  pessoa está digitando (`ContratoDetalhe`).

## Senha provisória — no 1º login a pessoa cria a dela (15/10/2026)
Migração `20261018010000_senha_provisoria.sql`. Senha gerada por OUTRA
pessoa (gestor para a equipe, equipe para o cliente do portal) é provisória:
admin (`ProtectedRoute`) e portal (`Layout`) só abrem depois de
`q_trocar_minha_senha`. Trocar depois: Meu perfil (admin) e Alterar senha
(portal, `/senha`).

- Quem marca é um gatilho em `auth.users`: `auth.uid()` ≠ dono da conta →
  provisória; a própria pessoa (ou o Auth, ou o SQL Editor, sem usuário) →
  não. Qualquer caminho novo de gerar senha já nasce coberto.
- ⚠️ O gatilho NUNCA derruba o Auth (erro vira `warning`): falhar ali seria
  ninguém conseguir entrar. E só dispara quando a senha MUDA de fato.
- ⚠️ **Documento não se assina com senha provisória** (gatilho em
  `documento_assinaturas`): senha que a equipe conhece não prova que foi o
  cliente.
- Senha fraca quem recusa é o banco (`q_senha_fraca`); a tela só mostra a
  lista enquanto digita. Com senha provisória não pede a atual; fora disso, pede.
- Usuários e o acesso ao portal mostram quem ainda está com a provisória
  (`senha_provisoria`, leitura para a equipe pela mesma regra de carteira).
- Conta criada pelo SQL Editor NÃO fica provisória (sem usuário na sessão) —
  é assim que nasce o login de teste.

## Barra do topo: sininho, tema e a pessoa logada (16/10/2026)
Migração `20261019000000_notificacoes_e_foto.sql`. `TopBar` (admin) e a barra
do portal: `Notificacoes` (arquivo COPIADO nos dois apps), botão de tema
(`useTema`, copiado; `index.html` aplica antes do React para não piscar) e,
no admin, foto + nome + "PAPEL · DEPARTAMENTO". Meu perfil em abas
(Dados · Foto · Senha, `?aba=`).

- ⚠️ **Quem cria notificação é o BANCO** (gatilhos em documento_assinaturas,
  contrato_documentos, contratos.data_aceite, contrato_historico,
  atendimento_mensagens). Ninguém tem policy na tabela: equipe e cliente
  leem e marcam por `q_minhas_notificacoes` / `q_marcar_notificacoes_lidas`.
- Mensagem de chat AGRUPA: aviso não lido da mesma conversa é atualizado, não
  repetido. Histórico urgente avisa sem o texto. Gatilho que falha vira
  `warning` e nunca derruba a gravação.
- O sininho do admin é ao vivo sem a tabela no Realtime: todo aviso nasce de
  uma tabela que o `useAoVivo` já escuta, e ele relê `["notificacoes"]` junto.
  Portal: relê a cada 20 s.
- Tipo novo de aviso: gatilho + ícone em `ICONE` (Notificacoes.tsx, nos dois).
- Foto: `lib/comprimirImagem.ts` recorta e reduz para 256×256 WEBP (~15 KB)
  antes de enviar ao bucket público `avatares`, pasta `<id>/`, só a equipe.
- `perfis.departamento_id`: do GESTOR (entrou em `q_perfil_protege_acesso`).
- Tema escuro: `.dark` em `index.css`, só na tela (impressão sai clara);
  Azul Petróleo clareia no escuro.

## Documentos: MODELO → gerar → o cliente assina no portal (15/10/2026)
Pedido do dono do processo: contrato, termo, declaração e procuração como
modelos preenchidos com os dados do cliente, e assinatura no próprio sistema,
"juridicamente correta, com tudo salvo (IP, horário…)". Migração
`20261017010000_modelos_e_assinatura.sql`.

```
documento_modelos      cadastro, versionado (editar o texto sobe a versão)
q_documento_catalogo   os campos {{cliente.nome}}… (a tela lista daqui)
q_documento_previa     o texto preenchido, sem gravar (a MESMA montagem da geração)
q_documento_gerar      preenche, CONGELA o texto + SHA-256, manda ao portal
portal_documento       o cliente lê (cada abertura vira evento com IP)
portal_assinar_documento  aceite + nome digitado + SENHA do portal → a prova
documento_assinaturas  a prova (IP, navegador, hora do servidor, hash, código)
documento_eventos      a trilha: gerado, visualizado, senha_incorreta, assinado…
```

- ⚠️ **Quem preenche é o BANCO**, com os dados gravados: a tela não manda o
  texto. Documento com texto só nasce por `q_documento_gerar` (o gatilho
  recusa insert direto).
- ⚠️ **Campo vazio RECUSA a geração** e diz qual falta (a prévia mostra
  `[rótulo]`). `cliente.qualificacao` só sai inteira. Os dados ficam em
  "Dados para documentos" na ficha do cliente (RG, estado civil, endereço…;
  PJ: representante legal).
- ⚠️ Campo novo no catálogo entra em `q_documento_catalogo` **e** em
  `q_documento_variaveis` (o teste confere que as chaves batem).
- ⚠️ **Assinatura não se desfaz e documento assinado não se cancela**
  (`trg_documento_protege`). O texto gerado não muda; errou, cancela e gera
  outro. Evento e assinatura: sem regra de escrita para ninguém.
- ⚠️ IP e navegador vêm dos CABEÇALHOS que o Supabase repassa
  (`q_requisicao`: `cf-connecting-ip`, `x-forwarded-for`), nunca da tela.
- ⚠️ Senha errada DEVOLVE `{ok:false}` em vez de erro (um erro desfaria o
  registro da tentativa). 5 erradas em 15 min travam a assinatura.
- O `portal_documento` não relê sozinho no portal: cada leitura vira evento.
- Os modelos de partida nascem **INATIVOS**: texto jurídico vai ao cliente
  depois de o jurídico revisar e um gestor ativar.
- Base legal: MP 2.200-2/2001, art. 10, § 2º (o modelo traz a cláusula de
  aceite da assinatura eletrônica; o texto do aceite fica gravado).
  ⚠️ Procuração para banco/cartório pode exigir ICP-Brasil ou firma
  reconhecida — decisão do jurídico. ⚠️ Segundo fator (código por SMS/e-mail)
  fortaleceria a prova; falta um provedor de envio.
- Documento de LINK (assinado fora) continua: criar, marcar à mão.
- Impressão/PDF: `/documentos/:id/imprimir` no admin (fora do layout) e o
  "Imprimir / salvar PDF" do portal (`.q-nao-imprimir` esconde o resto).
