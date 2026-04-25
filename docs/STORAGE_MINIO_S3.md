# MinIO / S3-хранилище медиа

В v5 медиа можно хранить в MinIO/S3.

По умолчанию Docker Compose поднимает MinIO и создаёт bucket:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_BUCKET=bubble-media
```

Для простого локального хранения можно переключить:

```env
STORAGE_DRIVER=local
```

В production лучше использовать внешний S3-совместимый storage или отдельный MinIO-сервер.
