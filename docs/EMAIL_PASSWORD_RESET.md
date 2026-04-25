# Email-подтверждение и восстановление пароля

В v5 регистрация требует email. По умолчанию включено:

```env
REQUIRE_EMAIL_VERIFICATION=true
```

Если SMTP не настроен, письма не теряются: они сохраняются в `data/dev-mails`.
Это удобно для локального запуска через Docker.

## Production SMTP

Заполните `.env`:

```env
PUBLIC_URL=https://your-domain.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_user
SMTP_PASSWORD=your_password
MAIL_FROM=Bubble Messenger <no-reply@your-domain.com>
```

## Восстановление пароля

На экране входа есть кнопка «Восстановить пароль». Ссылка отправляется на email пользователя.
