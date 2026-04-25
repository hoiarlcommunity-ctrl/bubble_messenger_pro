# Запуск без демо-данных

В этой версии демо-пользователи отключены по умолчанию:

```env
DEMO_USER=false
```

## Если проект ещё не запускался

1. Создайте `.env` из `.env.example`.
2. Заполните JWT-секреты.
3. При необходимости заполните администратора:

```env
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=сложный_пароль_от_12_символов
INITIAL_ADMIN_DISPLAY_NAME=Administrator
```

4. Запустите:

```bash
docker compose up -d --build
```

## Если старая версия уже запускалась и демо-пользователи уже попали в базу

Самый простой способ для тестовой базы:

```bash
docker compose down -v
docker compose up -d --build
```

Внимание: `down -v` удалит данные PostgreSQL volume.

Для production-базы удаляйте демо-пользователей вручную через SQL после резервной копии.
