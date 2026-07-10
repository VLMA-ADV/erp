#!/usr/bin/env bash
# Suíte automatizada do fluxo de faturamento (roda em prod com ROLLBACK — zero resíduo).
# Requisitos: token do Supabase Management API em ~/.vlma_sb_token
# Uso: ./scripts/test-fluxo-faturamento.sh
set -euo pipefail

PROJECT_REF="xwubxpcixxwfoduwyzmo"
TOKEN_FILE="${HOME}/.vlma_sb_token"
SQL_FILE="$(dirname "$0")/../supabase/tests/fluxo_faturamento_suite.sql"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "erro: token não encontrado em $TOKEN_FILE" >&2
  exit 1
fi

RESPONSE=$(python3 - "$SQL_FILE" <<'PY'
import sys, json, urllib.request

sql = open(sys.argv[1]).read()
token = open(f"{__import__('os').path.expanduser('~')}/.vlma_sb_token").read().strip()
req = urllib.request.Request(
    "https://api.supabase.com/v1/projects/xwubxpcixxwfoduwyzmo/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",  # Cloudflare bloqueia o UA padrão
    },
    method="POST",
)
try:
    body = urllib.request.urlopen(req).read().decode()
except Exception as e:  # a suíte SEMPRE termina em exceção proposital (rollback)
    body = e.read().decode() if hasattr(e, "read") else str(e)
print(body)
PY
)

# O relatório vem na mensagem da exceção proposital "SUITE >>> ..."
SUMMARY=$(echo "$RESPONSE" | python3 -c "
import sys, json, re
raw = sys.stdin.read()
try:
    msg = json.loads(raw).get('message', raw)
except Exception:
    msg = raw
m = re.search(r'SUITE >>> (.*)', msg, re.S)
print(m.group(1).replace(' | ', '\n').strip() if m else 'ERRO INESPERADO:\n' + msg)
")

echo "$SUMMARY"
if echo "$SUMMARY" | grep -q '\[FAIL\]'; then
  echo "-- SUITE: FALHOU --" >&2
  exit 1
fi
echo "-- SUITE: OK --"
