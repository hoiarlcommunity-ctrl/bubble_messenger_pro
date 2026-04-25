New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$out = "backups/postgres_$stamp.sql"
docker exec bubble_messenger_postgres pg_dump -U bubble -d bubble_messenger | Out-File -Encoding utf8 $out
Write-Host "PostgreSQL backup saved: $out"
