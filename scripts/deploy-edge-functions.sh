#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/supabase/functions"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Erro: Supabase CLI nao encontrado. Instale e autentique antes do deploy."
  exit 1
fi

if [[ ! -d "$FUNCTIONS_DIR" ]]; then
  echo "Erro: Diretorio nao encontrado: $FUNCTIONS_DIR"
  exit 1
fi

declare -a functions

if [[ $# -gt 0 ]]; then
  functions=("$@")
else
  while IFS= read -r fn; do
    functions+=("$fn")
  done < <(find "$FUNCTIONS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "_*" -exec basename {} \; | sort)
fi

if [[ ${#functions[@]} -eq 0 ]]; then
  echo "Nenhuma Edge Function encontrada para deploy."
  exit 1
fi

echo "Publicando ${#functions[@]} Edge Function(s) com JWT desativado..."

for fn in "${functions[@]}"; do
  echo "-> Deploy: $fn (--no-verify-jwt)"
  supabase functions deploy "$fn" --no-verify-jwt
done

echo "Deploy concluido com JWT desativado para todas as functions processadas."
