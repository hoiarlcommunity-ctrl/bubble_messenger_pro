#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
if [ -z "$FILE" ]; then echo "Usage: bash scripts/restore-postgres.sh backups/postgres_YYYYMMDD_HHMMSS.sql.gz"; exit 1; fi
gunzip -c "$FILE" | docker exec -i bubble_messenger_postgres psql -U bubble -d bubble_messenger
echo "PostgreSQL restored from: $FILE"
