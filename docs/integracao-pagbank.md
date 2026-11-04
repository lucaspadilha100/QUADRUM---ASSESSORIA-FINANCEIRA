# Integração com o PagBank — o que a documentação diz (lida em 04/11/2026)

Fonte: developer.pagbank.com.br (índice em `/llms.txt`; cada página tem versão
`.md`). API de **Pedidos** (`/orders`), versão 4.1. A API antiga `/charges`
ainda aparece em páginas velhas — não usar.

## Ambientes e credencial

| | URL base | Token |
|---|---|---|
| Sandbox | `https://sandbox.api.pagseguro.com` | Portal do Desenvolvedor (portaldev.pagbank.com.br) → aba **Tokens** |
| Produção | `https://api.pagseguro.com` | Site do PagBank (no computador) → **Vendas → Integrações → Gerar Token** |

- Cabeçalho: `Authorization: Bearer <token>`.
- ⚠️ Gerar token novo de produção invalida o anterior.
- O token NUNCA vai para o repo nem para a tela: segredo da Edge Function no
  Supabase. O mesmo token valida os webhooks (abaixo).

## Como cada parcela vira cobrança

Uma parcela (`contrato_parcelas`) = um **pedido** (`POST /orders`) com UMA
cobrança (`charges[0]`). `reference_id` do pedido/cobrança = id da parcela —
é por ele que a notificação volta para a parcela certa.

Valores sempre em **centavos** (`R$ 1.500,99` = `150099`).

### Boleto (`payment_method.type = "BOLETO"`)
- Obrigatórios: `boleto.due_date` (AAAA-MM-DD), `instruction_lines.line_1/2`
  (até 75 caracteres cada), `holder` (nome, CPF/CNPJ, **e-mail**, endereço
  completo), `days_until_expiration`, `template`.
- ⚠️ `holder.name` tem **no máximo 30 caracteres** — nome longo é cortado.
- ⚠️ **E-mail do pagador é obrigatório**; endereço também (rua, número,
  bairro, cidade, UF, CEP). Cliente sem e-mail/endereço não gera boleto.
- Multa/juros/desconto: `charges[].payment_instructions` com `fine`,
  `interest`, `discounts`, valor em **centavos de percentual** (2% = `200`) e
  `date` a partir de quando vale. O contrato (cláusula 9.3) pede multa 10%
  (`1000`) e juros 1% ao mês (`100`); `template` tem de ser `COBRANCA`.
  ⚠️ A doc não diz se `interest` é ao mês — confirmar no sandbox.
- Mínimo R$ 0,20. Todo boleto passa por análise de risco.
- Resposta: `charges[0].status = WAITING` (ou `DECLINED`),
  `payment_method.boleto.barcode` / `formatted_barcode` (linha digitável) e
  `charges[0].links[]` com o PDF e a imagem do boleto.

### PIX (`payment_method.type = "PIX"`)
- `pix.expiration_date` (data-hora) define a validade; sem ela, vale até
  23h59 do dia seguinte. QR Code de uso ÚNICO.
- ⚠️ A conta precisa ter **chave PIX ativa** (com várias, usa a aleatória).
- Resposta: `charges[0].qr_code.text` = **PIX copia-e-cola**; links do QR em
  PNG/base64. Sem multa/juros no PIX desta API.
- Como vence rápido, o PIX de uma parcela futura se gera PERTO do vencimento
  ou quando o cliente pedir no portal ("Gerar PIX"), não no dia do plano.

### Cartão — Checkout / Link de Pagamento (`POST /checkouts`)
- Página de pagamento do PagBank; devolve o link em `links[rel=PAY].href`.
- Escolhe-se os métodos aceitos (cartão de crédito/débito, PIX, boleto…) e o
  limite de parcelas; tem data de expiração. "Pagar com PagBank" sempre aparece.
- Notificações próprias (`notification_urls` do checkout e
  `payment_notification_urls` do pagamento); cabeçalho `x-product-origin: CHECKOUT`.

## Saber que foi pago — webhook

- Cada pedido leva `notification_urls`: o PagBank faz POST nela a cada mudança
  de status, com o MESMO JSON da resposta de criação.
- Status da cobrança: `WAITING`, `PAID` (com `paid_at`), `CANCELED`,
  `DECLINED`, `IN_ANALYSIS`/`AUTHORIZED` (cartão). Boleto não pago vira `CANCELED`.
- ⚠️ **Autenticidade**: cabeçalho `x-authenticity-token` =
  `sha256("{token}-{corpo cru}")` em hex. Comparar com o corpo EXATO recebido
  (sem reformatar); não bateu → descartar.
- Eventos pós-transação (saldo disponível, devolução, chargeback) chegam na
  mesma URL em OUTRO formato (`notificationCode=…&notificationType=transaction`).

## Consultar, cancelar

- `GET /orders/{order_id}` e `GET /orders?charge_id=…`;
  `GET /charges/{charge_id}` (consultar pagamento). **Não existe "listar
  tudo em aberto"**: o sistema guarda o id e reconsulta (rede de segurança
  para webhook perdido). Recursos ficam consultáveis até 36 meses.
- `POST /charges/{charge_id}/cancel`: devolve/cancela. Para boleto em aberto,
  confirmar no sandbox. **Não há endpoint para mudar vencimento**: trocar a
  data = cancelar e emitir outro.
- `GET` taxas de uma transação: "Consultar taxas de uma transação".

## O que já existe no nosso banco para receber isso

`contrato_parcelas`: `cobranca_id`, `boleto_url`, `boleto_linha_digitavel`,
`pix_copia_cola` (vazios até a integração) e `plano_dia_vencimento` no
contrato. O portal já mostra "Ver boleto", "Copiar código do boleto" e
"Copiar PIX" quando esses campos estão preenchidos.

## O que foi feito (04/11/2026)

Ver a seção "PagBank" do `CLAUDE.md`. Medido no sandbox com o código real
das funções: boleto, PIX e link emitidos; consulta; aviso assinado (válido,
inválido = 401, formulário, link expirado). Duas descobertas do sandbox:
boleto não aceita vencimento no próprio dia, e `GET /checkouts/{id}` não traz
o pagamento (só o aviso traz).
