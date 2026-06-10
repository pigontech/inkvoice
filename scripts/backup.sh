#!/bin/bash
# SQLite backup script for Inkvoice
# Usage: ./scripts/backup.sh [backup_dir]

set -euo pipefail

DB_PATH="${DATABASE_PATH:-./data/invoice.db}"
BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/invoice_${DATE}.db"

sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
echo "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Remove backups older than retention period
DELETED=$(find "$BACKUP_DIR" -name "invoice_*.db" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "Cleaned up $DELETED backup(s) older than $RETENTION_DAYS days"
fi
