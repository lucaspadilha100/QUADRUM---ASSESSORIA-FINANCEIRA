# Quadrum · Assessoria Financeira

Sistema da Quadrum: o **admin** (back-office da equipe) e, depois, o **Portal do
Cliente**, que só lê o que o admin produz.

```
apps/admin/          back-office da equipe (React + Vite + Tailwind + shadcn)
apps/portal/         Portal do Cliente (login por CPF/CNPJ, contratos, chat)
supabase/migrations/ o banco (Supabase/Postgres), em ordem
supabase/testes/     testes das regras de acesso, num Postgres em memória
docs/                mapeamento do portal antigo e manual da marca
```

## Rodar o admin

```bash
cd apps/admin
npm install
npm run dev               # http://localhost:8090
```

Conferir antes de subir:

```bash
npm run typecheck         # tsc -b --force (checa de verdade)
npm run build
cd ../../supabase/testes && npm install && npm test
```

## Deploy (Vercel)

Importe o repositório e deixe o Root Directory na raiz: o `vercel.json` da raiz
instala e builda `apps/admin`. Não precisa de variável de ambiente — URL e anon
key (públicas) estão em `apps/admin/.env`.

### Portal do Cliente

Outro projeto no Vercel, com **Root Directory = `apps/portal`**. Rodar local:
`cd apps/portal && npm install && npm run dev` (http://localhost:8091).
O cliente entra com CPF/CNPJ e a senha que a equipe gera no card do contrato
(admin → Pipeline → card → Dados → "Gerar acesso").
