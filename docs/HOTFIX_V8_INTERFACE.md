# Hotfix v8: интерфейс не реагировал на кнопки

Причина: в `public/js/app.js` обработчик `els.searchMessagesBtn.addEventListener(...)`
вызывался, но `searchMessagesBtn` отсутствовал в объекте `els`.

Из-за этого frontend падал на инициализации, и обработчики кнопок после этой строки не привязывались.

Исправлено:
- добавлен `searchMessagesBtn` в `els`;
- добавлен `emojiBtn` в `els`;
- часть optional-кнопок переведена на безопасное `?.addEventListener`;
- добавлен рабочий мини-пикер эмодзи;
- добавлены глобальные обработчики frontend-ошибок;
- service worker переведён на network-first для HTML/JS/CSS;
- cache name обновлён до `bubble-messenger-pro-v8-hotfix`.

После деплоя пользователям, у которых уже открывался сайт, может понадобиться:
1. обновить страницу 2 раза;
2. или очистить данные сайта в браузере;
3. или открыть `https://your-domain/?v=8`.
