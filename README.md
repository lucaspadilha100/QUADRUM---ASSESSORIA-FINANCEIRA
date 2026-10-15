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

Um projeto só, apontando para a raiz do repositório. Cada push na `main` sobe:

- `/` — admin (`apps/admin`)
- `/portal` — Portal do Cliente (`apps/portal`)

O `vercel.json` da raiz instala os dois e roda `scripts/vercel-build.sh`. Não
precisa de variável de ambiente: URL e anon key (públicas) estão nos `.env` dos apps.

Rodar o portal local: `cd apps/portal && npm install && npm run dev` →
http://localhost:8091/portal/
