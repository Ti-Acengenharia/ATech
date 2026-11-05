#!/usr/bin/env bash
# ==============================================================================
# ATech AC Engenharia - Rotina de Backup Automatizado do Banco PostgreSQL
# ==============================================================================
# Salva um dump completo (.sql.gz) do banco de dados a partir do container Docker,
# mantendo o histórico dos últimos 30 dias com rotação automática.
# ==============================================================================

set -euo pipefail

# Diretório raiz do projeto (ajuste se necessário ou execute a partir da raiz)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/atech_backup_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

log() {
  local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
  echo "${msg}"
  echo "${msg}" >> "${LOG_FILE}"
}

log "Iniciando rotina de backup do banco de dados ATech..."

# Carregar variáveis de ambiente do .env se existir
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(POSTGRES_DB|POSTGRES_USER)=' "${PROJECT_DIR}/.env" | xargs)
fi

DB_USER="${POSTGRES_USER:-atech}"
DB_NAME="${POSTGRES_DB:-atech}"
CONTAINER_NAME="atech-postgres"

# Verificar se o container está em execução
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "ERRO: O container ${CONTAINER_NAME} não está em execução."
  exit 1
fi

# Executar pg_dump compactado com gzip
log "Executando pg_dump no container ${CONTAINER_NAME} (banco: ${DB_NAME}, usuário: ${DB_USER})..."
if docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"; then
  FILE_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
  log "Backup gerado com sucesso: ${BACKUP_FILE} (${FILE_SIZE})"
else
  log "ERRO ao executar o pg_dump."
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# Rotação de backups antigos (excluir arquivos com mais de RETENTION_DAYS dias)
log "Verificando backups com mais de ${RETENTION_DAYS} dias para rotação..."
find "${BACKUP_DIR}" -type f -name "atech_backup_*.sql.gz" -mtime +"${RETENTION_DAYS}" -print -delete | while read -r deleted; do
  log "Removido backup antigo: ${deleted}"
done

log "Rotina de backup finalizada com sucesso."

