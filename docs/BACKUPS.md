# Бэкапы

## PostgreSQL

Linux/macOS/WSL:

```bash
bash scripts/backup-postgres.sh
```

Windows PowerShell:

```powershell
.\scripts\backup-postgres.ps1
```

## MinIO media

```bash
bash scripts/backup-media-minio.sh
```

## Restore PostgreSQL

```bash
bash scripts/restore-postgres.sh backups/postgres_YYYYMMDD_HHMMSS.sql.gz
```

В production храните бэкапы не на том же сервере, где работает приложение.
