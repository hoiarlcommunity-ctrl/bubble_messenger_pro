# Bubble Messenger Pro v4

Полноценный web-мессенджер на основе дизайна **Social Bubbles**.

## Что есть в v4

- PostgreSQL + Redis + Socket.IO.
- Регистрация, вход, JWT access/refresh.
- Личные чаты, группы и каналы.
- Публичные каналы и каталог каналов.
- Пригласительные ссылки для групп и каналов.
- Realtime-сообщения, online, typing.
- Голосовые сообщения.
- Видеокружочки.
- Изображения и файлы.
- Ответы, реакции, редактирование и удаление сообщений.
- Закреплённые сообщения.
- Избранные сообщения.
- Локальные черновики по каждому чату.
- Упоминания `@username` с подсветкой.
- Профиль, аватар, приватность, чёрный список.
- Статусы прочтения.
- WebRTC аудио/видеозвонки для личных чатов.
- Демонстрация экрана во время видеозвонка.
- Светлая/тёмная тема.
- PWA manifest и service worker.
- Базовая админка: пользователи, жалобы, статистика.
- Docker Compose: app + PostgreSQL + Redis + Nginx.

## Быстрый запуск

```bash
cp .env.example .env
docker compose up -d --build
```

Открыть напрямую:

```text
http://localhost:3000
```

Через Nginx:

```text
http://localhost:8080
```

## Демо-аккаунты

```text
demo / demo123
lena / demo123
max / demo123
katya / demo123
```

`demo` имеет роль admin.

## Запуск в VS Code

1. Открой папку проекта в Visual Studio Code.
2. Запусти Docker Desktop.
3. Открой терминал VS Code.
4. Выполни:

```powershell
copy .env.example .env
docker compose up -d --build
```

На Linux/macOS:

```bash
cp .env.example .env
docker compose up -d --build
```

## Проверка логов

```bash
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f nginx
```

## Остановка

```bash
docker compose down
```

Полное удаление контейнеров и volume PostgreSQL:

```bash
docker compose down -v
```

## Важное про звонки, камеру и микрофон

На `localhost` браузеры обычно разрешают микрофон и камеру без HTTPS.

Для реального сервера по IP/домену нужен HTTPS, иначе:

- голосовые могут не записываться;
- видеокружки могут не записываться;
- WebRTC-звонки могут не стартовать.

Для production WebRTC желательно добавить TURN-сервер, например `coturn`. STUN в проекте включён как базовый вариант:

```text
stun:stun.l.google.com:19302
```

## Invite links

Формат ссылки:

```text
http://localhost:3000/invite/<token>
```

Если пользователь уже вошёл, он автоматически вступит в чат. Если нет — после входа можно открыть ссылку снова.

## Что ещё можно улучшить дальше

- TURN-сервер `coturn` в Docker Compose.
- Push-уведомления через VAPID/Web Push.
- Транскрибация голосовых сообщений в текст.
- Расширенная система ролей в группах.
- Модерация публичных каналов.
- Стикеры/GIF.
- Экспорт переписки.
- Резервное копирование PostgreSQL и медиа.
- CI/CD.


## Первый запуск без демо-данных

По умолчанию тестовые пользователи `demo`, `lena`, `max`, `katya` не создаются.

Чтобы создать своего первого администратора, до запуска заполните в `.env`:

```env
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=придумайте_сложный_пароль_от_12_символов
INITIAL_ADMIN_DISPLAY_NAME=Administrator
```

Для локального тестирования можно временно включить демо-данные:

```env
DEMO_USER=true
```


## Что нового в v5

- Email при регистрации.
- Подтверждение email по ссылке.
- Восстановление пароля по email.
- Dev-mail режим: если SMTP не настроен, письма сохраняются в `data/dev-mails`.
- MinIO/S3-хранилище для голосовых, видео, картинок и файлов.
- Docker Compose поднимает `app + postgres + redis + minio + coturn + nginx`.
- Endpoint `/api/webrtc/ice-servers` отдаёт STUN/TURN настройки для звонков.
- Добавлен SQL migration runner и папка `db/migrations`.
- Скрипты бэкапа PostgreSQL и MinIO.
- Пример HTTPS-конфига Nginx.

## Первый запуск v5

```bash
cp .env.example .env
```

Обязательно поменяйте:

```env
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
S3_SECRET_KEY=...
TURN_PASSWORD=...
TURN_CREDENTIAL=...
```

Для локального теста SMTP можно не настраивать. Письма подтверждения и восстановления будут появляться в:

```text
data/dev-mails
```

Запуск:

```bash
docker compose up -d --build
```

Открыть:

```text
http://localhost:3000
```

MinIO Console:

```text
http://localhost:9001
```

## Важное для production

Для реального сервера настройте:

1. `PUBLIC_URL=https://your-domain.com`
2. SMTP.
3. HTTPS.
4. TURN на домене.
5. Сильные секреты JWT/S3/TURN.
6. Регулярные бэкапы.


## Новый интерфейс v6

В этой версии frontend переведён на новый тёмный production-дизайн в стиле современного desktop/web-мессенджера:

- узкая левая навигационная панель;
- отдельная колонка списка чатов;
- фильтры: все, личные, группы, каналы;
- центральная область переписки с закрепами, реакциями, ответами, голосовыми и видеокружками;
- правый информационный сайдбар с профилем чата, участниками, медиа и закрепами;
- обновлённый composer с кнопками эмодзи, файлов, голосового, видеокружка и отправки;
- улучшенная мобильная логика: список чатов и экран переписки как отдельные экраны.

Все backend-функции предыдущей версии сохранены: PostgreSQL, Redis, MinIO/S3, TURN/coturn, email-подтверждение, восстановление пароля, WebRTC-звонки, каналы, приглашения, избранное, реакции, редактирование/удаление и админка.
