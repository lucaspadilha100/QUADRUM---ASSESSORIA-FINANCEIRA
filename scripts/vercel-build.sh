#!/usr/bin/env sh
# Um deploy, dois apps: admin na raiz e Portal do Cliente em /portal.
# Chamado pelo vercel.json da raiz. Sai em ./dist, que é o que o Vercel publica.
set -eu
raiz=$(cd "$(dirname "$0")/.." && pwd)

(cd "$raiz/apps/admin" && npm run build)
(cd "$raiz/apps/portal" && npm run build)

rm -rf "$raiz/dist"
cp -r "$raiz/apps/admin/dist" "$raiz/dist"
cp -r "$raiz/apps/portal/dist" "$raiz/dist/portal"
echo "dist/ pronto: admin em /, portal em /portal"
