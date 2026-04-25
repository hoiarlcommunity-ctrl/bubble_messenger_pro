# Production checklist

## Required before public launch

- Настроить домен и HTTPS.
- Включить secure cookies в `.env` на production.
- Сменить `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET`.
- Ограничить `CORS_ORIGIN` реальным доменом.
- Подключить TURN-сервер для WebRTC, например coturn.
- Настроить backup PostgreSQL.
- Настроить backup каталога `uploads`.
- Настроить мониторинг диска, CPU, RAM.
- Добавить логирование ошибок в Sentry или аналог.
- Добавить Nginx upload limits под нужный размер файлов.
- Включить ротацию логов.
- Проверить rate limits для регистрации, входа, сообщений и upload.
- Проверить права доступа к медиа, каналам, инвайтам и pinned/saved endpoints.
- Добавить automated migrations перед деплоем.

## Nice to have

- Web Push уведомления через VAPID.
- TURN в docker-compose.prod.yml.
- Антивирусная проверка файлов.
- Очередь задач для сжатия видео и генерации превью.
- Лимиты хранилища на пользователя.
- Export/delete account flow.
- Модерация публичных каналов.


## V5 обязательные настройки

- [ ] `REQUIRE_EMAIL_VERIFICATION=true`.
- [ ] Настроен SMTP.
- [ ] Работает восстановление пароля.
- [ ] `PUBLIC_URL` указывает на HTTPS-домен.
- [ ] `STORAGE_DRIVER=s3` и медиа лежат в MinIO/S3.
- [ ] Секреты `S3_SECRET_KEY`, `JWT_*`, `TURN_PASSWORD` заменены.
- [ ] Открыты UDP/TCP-порты TURN.
- [ ] Настроены регулярные бэкапы PostgreSQL и MinIO.
- [ ] Проверено восстановление из backup.
- [ ] Включены лимиты регистрации и антиспам.
- [ ] Подключена captcha, если регистрация публичная.
