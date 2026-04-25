#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/postgres_${STAMP}.sql.gz"
docker exec bubble_messenger_postgres pg_dump -U bubble -d bubble_messenger | gzip > "$OUT"
echo "PostgreSQL backup saved: $OUT"
