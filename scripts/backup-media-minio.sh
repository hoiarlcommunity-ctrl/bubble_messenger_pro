#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/minio_media_${STAMP}.tar.gz"
CID="bubble_messenger_minio"
docker exec "$CID" sh -c 'cd /data && tar -czf - .' > "$OUT"
echo "MinIO media backup saved: $OUT"
