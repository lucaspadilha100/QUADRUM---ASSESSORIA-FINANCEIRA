# Quadrum · Assessoria Financeira

Sistema da Quadrum: o **admin** (back-office da equipe) e, depois, o **Portal do
Cliente**, que só lê o que o admin produz.

```
apps/admin/          back-office da equipe (React + Vite + Tailwind + shadcn)
apps/portal/         Portal do Cliente — ainda não existe
supabase/migrations/ o banco (Supabase/Postgres), em ordem
supabase/testes/     testes das regras de acesso, num Postgres em memória
docs/                mapeamento do portal antigo e manual da marca
```

## Rodar o admin

```bash
cd apps/admin
cp .env.example .env      # preencha URL e anon key do Supabase
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

Projeto com **Root Directory = `apps/admin`**, variáveis `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`.
