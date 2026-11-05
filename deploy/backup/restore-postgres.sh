#!/usr/bin/env bash
# ==============================================================================
# ATech AC Engenharia - Script de Restauração do Banco PostgreSQL
# ==============================================================================
# Uso: ./restore-postgres.sh /caminho/para/atech_backup_YYYYMMDD_HHMMSS.sql.gz
# ==============================================================================

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <arquivo_de_backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERRO: O arquivo ${BACKUP_FILE} não existe."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(POSTGRES_DB|POSTGRES_USER)=' "${PROJECT_DIR}/.env" | xargs)
fi

DB_USER="${POSTGRES_USER:-atech}"
DB_NAME="${POSTGRES_DB:-atech}"
CONTAINER_NAME="atech-postgres"

echo "ATENÇÃO: Este comando irá restaurar o arquivo ${BACKUP_FILE} no banco '${DB_NAME}'."
read -p "Deseja continuar? (s/N): " -r CONFIRM
if [[ "${CONFIRM}" != "s" && "${CONFIRM}" != "S" ]]; then
  echo "Restauração cancelada."
  exit 0
fi

echo "Descompactando e restaurando..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "Restauração concluída com sucesso!"

