# v14: hotfix сворачиваемых разделов

Исправлена ошибка:

`TypeError: Cannot read properties of undefined (reading 'direct')`

Причина:
`renderChats()` обращался к `state.collapsedChatSections[section.key]`, но в некоторых сценариях
`state.collapsedChatSections` мог быть `undefined`.

Исправлено:
- добавлен безопасный `getCollapsedChatSections()`;
- `toggleChatSection()` больше не падает при пустом состоянии;
- `renderChats()` использует безопасный fallback;
- добавлена нормализация типа чата через `getChatType()`;
- неизвестный тип чата теперь считается `direct`;
- обновлён service worker cache.
