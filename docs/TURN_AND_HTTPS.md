# HTTPS и TURN для звонков

Камера, микрофон и WebRTC на реальном сервере должны работать через HTTPS.

Docker Compose добавляет `coturn`:

```env
WEBRTC_TURN_URLS=turn:your-domain.com:3478?transport=udp,turn:your-domain.com:3478?transport=tcp
TURN_REALM=your-domain.com
TURN_USERNAME=bubbleturn
TURN_PASSWORD=сложный_turn_пароль
TURN_CREDENTIAL=тот_же_сложный_turn_пароль
```

Откройте порты:

```text
3478/tcp
3478/udp
49160-49200/udp
```

Для Nginx есть пример `nginx/https.example.conf`.
