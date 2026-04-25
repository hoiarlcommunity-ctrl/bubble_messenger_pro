const $ = (selector) => document.querySelector(selector);

window.addEventListener('error', (event) => {
  console.error('[frontend:error]', event.error || event.message);
  try { toast(`Ошибка интерфейса: ${event.message}`); } catch (_) {}
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[frontend:promise]', event.reason);
  try { toast(`Ошибка запроса: ${event.reason?.message || event.reason}`); } catch (_) {}
});

const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  token: localStorage.getItem('bubble_access_token') || '',
  user: null,
  socket: null,
  chats: [],
  activeChatId: null,
  messages: new Map(),
  chatDetails: new Map(),
  onlineUserIds: new Set(),
  typingUsers: new Map(),
  replyTo: null,
  recorder: null,
  recordStream: null,
  recordChunks: [],
  recordStartedAt: 0,
  recordTimerId: null,
  recordKind: 'audio',
  recordCancelled: false,
  theme: localStorage.getItem('bubble_theme') || 'light',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  call: {
    active: false,
    incoming: null,
    peer: null,
    localStream: null,
    remoteUserId: null,
    callId: null,
    kind: 'audio',
    muted: false,
    cameraOff: false
  }
};

const els = {
  authScreen: $('#authScreen'),
  appShell: $('#appShell'),
  appLoader: $('#appLoader'),
  loaderText: $('#loaderText'),
  topProgress: $('#topProgress'),
  loginTab: $('#loginTab'),
  registerTab: $('#registerTab'),
  loginForm: $('#loginForm'),
  registerForm: $('#registerForm'),
  authError: $('#authError'),
  forgotPasswordBtn: $('#forgotPasswordBtn'),
  chatList: $('#chatList'),
  onlineStories: $('#onlineStories'),
  activeAvatar: $('#activeAvatar'),
  activeTitle: $('#activeTitle'),
  activeStatus: $('#activeStatus'),
  messageList: $('#messageList'),
  messageForm: $('#messageForm'),
  messageInput: $('#messageInput'),
  typingLine: $('#typingLine'),
  replyBar: $('#replyBar'),
  replyText: $('#replyText'),
  cancelReply: $('#cancelReply'),
  backToChats: $('#backToChats'),
  logoutBtn: $('#logoutBtn'),
  newChatBtn: $('#newChatBtn'),
  createGroupBtn: $('#createGroupBtn'),
  editProfileBtn: $('#editProfileBtn'),
  adminBtn: $('#adminBtn'),
  profileBtn: $('#profileBtn'),
  audioCallBtn: $('#audioCallBtn'),
  videoCallBtn: $('#videoCallBtn'),
  createChannelBtn: $('#createChannelBtn'),
  publicChannelsBtn: $('#publicChannelsBtn'),
  savedBtn: $('#savedBtn'),
  themeBtn: $('#themeBtn'),
  pinBar: $('#pinBar'),
  chatSearch: $('#chatSearch'),
  searchMessagesBtn: $('#searchMessagesBtn'),
  emojiBtn: $('#emojiBtn'),
  attachBtn: $('#attachBtn'),
  fileInput: $('#fileInput'),
  voiceBtn: $('#voiceBtn'),
  videoBtn: $('#videoBtn'),
  myAvatar: $('#myAvatar'),
  myName: $('#myName'),
  myStatus: $('#myStatus'),
  modal: $('#modal'),
  modalTitle: $('#modalTitle'),
  modalBody: $('#modalBody'),
  modalClose: $('#modalClose'),
  recordOverlay: $('#recordOverlay'),
  recordTitle: $('#recordTitle'),
  recordTimer: $('#recordTimer'),
  recordPreview: $('#recordPreview'),
  recordAudioIcon: $('#recordAudioIcon'),
  stopRecord: $('#stopRecord'),
  cancelRecord: $('#cancelRecord'),
  closeRecord: $('#closeRecord'),
  callOverlay: $('#callOverlay'),
  callTitle: $('#callTitle'),
  callStatus: $('#callStatus'),
  remoteVideo: $('#remoteVideo'),
  localVideo: $('#localVideo'),
  remoteAudio: $('#remoteAudio'),
  acceptCallBtn: $('#acceptCallBtn'),
  rejectCallBtn: $('#rejectCallBtn'),
  muteCallBtn: $('#muteCallBtn'),
  cameraCallBtn: $('#cameraCallBtn'),
  screenCallBtn: $('#screenCallBtn'),
  endCallBtn: $('#endCallBtn')
};

function initials(name = '?') {
  return String(name).trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase() || '?';
}

function setAvatar(el, name, avatarUrl = '', extraClass = '') {
  el.className = `avatar ${extraClass || ''}`.trim();
  el.innerHTML = '';
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = name || 'avatar';
    img.loading = 'lazy';
    el.appendChild(img);
  } else {
    el.textContent = initials(name);
  }
}

function avatarHtml(name, avatarUrl = '', className = 'avatar', extraClass = '') {
  const cls = `${className} ${extraClass || ''}`.trim();
  if (avatarUrl) return `<div class="${cls}"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name || 'avatar')}" loading="lazy"></div>`;
  return `<div class="${cls}">${escapeHtml(initials(name))}</div>`;
}

function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatDuration(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function toast(text) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function showAuthError(text) {
  els.authError.textContent = text;
  els.authError.classList.remove('hidden');
}

function clearAuthError() {
  els.authError.classList.add('hidden');
  els.authError.textContent = '';
}

function showGlobalLoader(text = 'Загружаем...') {
  if (!els.appLoader) return;
  if (els.loaderText) els.loaderText.textContent = text;
  els.appLoader.classList.remove('hidden');
  requestAnimationFrame(() => els.appLoader.classList.add('is-visible'));
}

function updateGlobalLoader(text) {
  if (els.loaderText && text) els.loaderText.textContent = text;
}

function hideGlobalLoader() {
  if (!els.appLoader) return;
  els.appLoader.classList.remove('is-visible');
  setTimeout(() => els.appLoader.classList.add('hidden'), 180);
}

function showTopProgress(text = 'Выполняется...') {
  if (!els.topProgress) return;
  const label = els.topProgress.querySelector('span');
  if (label) label.textContent = text;
  els.topProgress.classList.remove('hidden');
  requestAnimationFrame(() => els.topProgress.classList.add('is-visible'));
}

function hideTopProgress() {
  if (!els.topProgress) return;
  els.topProgress.classList.remove('is-visible');
  setTimeout(() => els.topProgress.classList.add('hidden'), 180);
}

function setButtonLoading(button, loading, label = '') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="btn-spinner"></span>${label ? `<span>${escapeHtml(label)}</span>` : ''}`;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function setFormBusy(form, busy) {
  if (!form) return;
  form.classList.toggle('is-busy', busy);
  form.querySelectorAll('input, textarea, select, button').forEach((control) => {
    if (control.classList.contains('auth-link')) return;
    control.disabled = busy;
  });
}

async function withButtonLoading(button, label, task) {
  setButtonLoading(button, true, label);
  try {
    return await task();
  } finally {
    setButtonLoading(button, false);
  }
}

function setComposeStatus(text = '') {
  if (!els.typingLine) return;
  if (text) {
    els.typingLine.classList.add('status-line');
    els.typingLine.innerHTML = `<span class="tiny-spinner"></span>${escapeHtml(text)}`;
  } else {
    els.typingLine.classList.remove('status-line');
    els.typingLine.textContent = '';
  }
}

function renderChatSkeleton(count = 6) {
  if (!els.chatList) return;
  els.chatList.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const row = document.createElement('article');
    row.className = 'dialog skeleton-dialog';
    row.innerHTML = `
      <div class="skeleton skeleton-avatar"></div>
      <div>
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
      <div class="skeleton skeleton-badge"></div>
    `;
    els.chatList.appendChild(row);
  }
}

function renderMessageSkeleton(count = 5) {
  if (!els.messageList) return;
  els.messageList.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const row = document.createElement('article');
    row.className = `msg skeleton-message ${i % 2 ? 'me' : ''}`;
    row.innerHTML = `
      <div class="skeleton skeleton-small-avatar"></div>
      <div class="bubble skeleton-bubble">
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    `;
    els.messageList.appendChild(row);
  }
}

function markPageTransition(target = document.body) {
  target.classList.remove('ui-transition');
  void target.offsetWidth;
  target.classList.add('ui-transition');
}


async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  const res = await fetch(path, { ...options, headers, credentials: 'include' });
  if (res.status === 401 && path !== '/api/auth/refresh') {
    const refreshed = await refreshToken();
    if (refreshed) return api(path, options);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function refreshToken() {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    state.token = data.accessToken;
    state.user = data.user;
    localStorage.setItem('bubble_access_token', state.token);
    return true;
  } catch (_) {
    return false;
  }
}

function setAuthMode(mode) {
  const login = mode === 'login';
  els.loginTab.classList.toggle('active', login);
  els.registerTab.classList.toggle('active', !login);
  els.loginForm.classList.toggle('hidden', !login);
  els.registerForm.classList.toggle('hidden', login);
  clearAuthError();
}

function showApp() {
  els.authScreen.classList.add('auth-exit');
  els.authScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');
  markPageTransition(els.appShell);
  els.myName.textContent = state.user.displayName;
  els.myStatus.textContent = state.user.statusText || `@${state.user.username}`;
  setAvatar(els.myAvatar, state.user.displayName, state.user.avatarUrl, 'online-dot');
  els.adminBtn.classList.toggle('hidden', !['admin', 'moderator'].includes(state.user.role));
}

function showAuth() {
  els.appShell.classList.add('hidden');
  els.authScreen.classList.remove('hidden');
  els.authScreen.classList.remove('auth-exit');
  markPageTransition(els.authScreen);
}

function applyTheme() {
  document.body.classList.toggle('dark-theme', state.theme === 'dark');
  if (els.themeBtn) els.themeBtn.textContent = state.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('bubble_theme', state.theme);
  applyTheme();
}

function draftKey(chatId = state.activeChatId) {
  return `bubble_draft_${state.user?.id || 'anon'}_${chatId}`;
}

function saveDraft() {
  if (!state.activeChatId) return;
  localStorage.setItem(draftKey(), els.messageInput.value || '');
}

function restoreDraft(chatId) {
  els.messageInput.value = localStorage.getItem(draftKey(chatId)) || '';
}

function clearDraft(chatId = state.activeChatId) {
  if (!chatId) return;
  localStorage.removeItem(draftKey(chatId));
}

async function login(username, password) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  state.token = data.accessToken;
  state.user = data.user;
  localStorage.setItem('bubble_access_token', state.token);
  await afterAuth();
}

async function register(displayName, username, email, password) {
  const data = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, username, email, password })
  });
  if (data.requiresEmailVerification) {
    setAuthMode('login');
    showAuthError('Аккаунт создан. Подтвердите email по ссылке из письма. Если SMTP не настроен, письмо сохранено на сервере в data/dev-mails.');
    return;
  }
  state.token = data.accessToken;
  state.user = data.user;
  localStorage.setItem('bubble_access_token', state.token);
  await afterAuth();
}

async function requestPasswordReset(login) {
  await api('/api/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ login })
  });
  showAuthError('Если аккаунт найден, ссылка восстановления отправлена на email. В dev-режиме письмо лежит в data/dev-mails.');
}

async function verifyEmailToken(token) {
  await api('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  history.replaceState({}, '', '/');
  setAuthMode('login');
  showAuthError('Email подтверждён. Теперь можно войти.');
}

async function resetPasswordByToken(token, password) {
  await api('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password })
  });
  history.replaceState({}, '', '/');
  setAuthMode('login');
  showAuthError('Пароль изменён. Теперь можно войти.');
}

async function handleAuthLinksFromUrl() {
  const params = new URLSearchParams(location.search);
  const verify = params.get('verify');
  const reset = params.get('reset');
  try {
    if (verify) await verifyEmailToken(verify);
    if (reset) {
      const password = prompt('Введите новый пароль минимум 8 символов');
      if (password) await resetPasswordByToken(reset, password);
    }
  } catch (error) { showAuthError(error.message); }
}

async function loadIceServers() {
  try {
    const data = await api('/api/webrtc/ice-servers');
    if (Array.isArray(data.iceServers) && data.iceServers.length) state.iceServers = data.iceServers;
  } catch (_) {}
}

async function afterAuth() {
  showGlobalLoader('Входим в аккаунт...');
  showApp();
  requestNotificationPermission();
  try {
    updateGlobalLoader('Настраиваем звонки...');
    await loadIceServers();
    updateGlobalLoader('Подключаем realtime...');
    connectSocket();
    updateGlobalLoader('Загружаем список чатов...');
    renderChatSkeleton();
    await loadChats();
  } finally {
    hideGlobalLoader();
  }
}


function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 1200);
  }
}

function notifyBrowser(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const chat = state.chats.find(c => Number(c.id) === Number(message.chatId));
  const title = chat?.title || 'Новое сообщение';
  const body = message.type === 'text' ? message.body : previewText(message);
  const notification = new Notification(title, { body, icon: '/icons/icon-192.svg', tag: `chat-${message.chatId}` });
  notification.onclick = () => {
    window.focus();
    openChat(message.chatId);
    notification.close();
  };
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => console.log('socket connected'));
  state.socket.on('connect_error', (err) => toast(`Socket: ${err.message}`));

  state.socket.on('presence:snapshot', ({ onlineUserIds }) => {
    state.onlineUserIds = new Set((onlineUserIds || []).map(Number));
    renderChats();
    renderStories();
  });

  state.socket.on('presence:update', ({ userId, online }) => {
    if (online) state.onlineUserIds.add(Number(userId));
    else state.onlineUserIds.delete(Number(userId));
    renderChats();
    renderStories();
    updateActiveHeader();
  });

  state.socket.on('typing:update', ({ chatId, userId, displayName, typing }) => {
    if (Number(userId) === state.user.id) return;
    const key = Number(chatId);
    if (!state.typingUsers.has(key)) state.typingUsers.set(key, new Map());
    const map = state.typingUsers.get(key);
    if (typing) map.set(Number(userId), displayName);
    else map.delete(Number(userId));
    renderTyping();
  });

  state.socket.on('message:new', (message) => {
    addOrUpdateMessage(message);
    patchChatPreview(message);
    if (Number(message.chatId) === Number(state.activeChatId)) {
      renderMessages();
      markRead(message.id);
      if (document.hidden && message.senderId !== state.user.id) notifyBrowser(message);
    } else {
      if (message.senderId !== state.user.id) notifyBrowser(message);
      const chat = state.chats.find(c => Number(c.id) === Number(message.chatId));
      if (chat && message.senderId !== state.user.id) chat.unreadCount = (chat.unreadCount || 0) + 1;
      renderChats();
    }
  });

  state.socket.on('message:updated', (message) => {
    addOrUpdateMessage(message);
    renderMessages();
  });

  state.socket.on('message:deleted', (message) => {
    addOrUpdateMessage(message);
    renderMessages();
  });

  state.socket.on('chat:read', ({ chatId, userId, messageId }) => {
    const detail = state.chatDetails.get(Number(chatId));
    if (detail) {
      const member = detail.members.find(m => Number(m.userId) === Number(userId));
      if (member) member.lastReadMessageId = Math.max(Number(member.lastReadMessageId || 0), Number(messageId || 0));
    }
    if (Number(chatId) === Number(state.activeChatId)) renderMessages();
  });

  state.socket.on('call:offer', async (payload) => handleIncomingCall(payload));
  state.socket.on('call:answer', async (payload) => handleCallAnswer(payload));
  state.socket.on('call:ice', async (payload) => handleCallIce(payload));
  state.socket.on('call:end', () => endCall(false, 'Звонок завершён'));
  state.socket.on('call:reject', () => endCall(false, 'Звонок отклонён'));

  state.socket.on('chat:updated', async ({ chatId }) => {
    await loadChats();
    if (Number(chatId) === Number(state.activeChatId)) await loadChatDetails(chatId, true);
  });

  state.socket.on('chat:added', async ({ chatId }) => {
    await loadChats();
    toast('Вас добавили в новый чат');
  });

  state.socket.on('chat:removed', async ({ chatId }) => {
    await loadChats();
    if (Number(chatId) === Number(state.activeChatId)) {
      state.activeChatId = null;
      els.appShell.dataset.mobileView = 'list';
      renderMessages();
    }
  });

  state.socket.on('user:updated', (user) => {
    state.user = user;
    showApp();
  });
}


function addOrUpdateMessage(message) {
  const chatId = Number(message.chatId);
  if (!state.messages.has(chatId)) state.messages.set(chatId, []);
  const arr = state.messages.get(chatId);
  const index = arr.findIndex(m => Number(m.id) === Number(message.id));
  if (index >= 0) arr[index] = message;
  else arr.push(message);
  arr.sort((a, b) => Number(a.id) - Number(b.id));
}

function patchChatPreview(message) {
  const chat = state.chats.find(c => Number(c.id) === Number(message.chatId));
  if (!chat) return;
  chat.lastMessage = { id: message.id, body: message.body, type: message.type, createdAt: message.createdAt };
  chat.updatedAt = message.createdAt;
  state.chats.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  renderChats();
}

async function loadChats() {
  showTopProgress('Загружаем чаты...');
  if (!state.chats.length) renderChatSkeleton();
  try {
    const data = await api('/api/chats');
    state.chats = data.chats || [];
    renderChats();
    renderStories();
  } finally {
    hideTopProgress();
  }
}

function filteredChats() {
  const q = els.chatSearch.value.trim().toLowerCase();
  if (!q) return state.chats;
  return state.chats.filter(c => (c.title || '').toLowerCase().includes(q));
}

function renderChats() {
  els.chatList.innerHTML = '';
  const chats = filteredChats();
  if (!chats.length) {
    const empty = document.createElement('div');
    empty.className = 'note';
    empty.textContent = 'Чатов пока нет. Нажмите +, чтобы начать переписку.';
    els.chatList.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const item = document.createElement('article');
    item.className = `dialog ${Number(chat.id) === Number(state.activeChatId) ? 'active' : ''}`;
    item.style.setProperty('--row-index', String(els.chatList.children.length));
    const isOnline = chat.otherUser && state.onlineUserIds.has(Number(chat.otherUser.id));
    const avatarClass = chat.type === 'group' ? 'avatar blue' : 'avatar';
    const preview = chat.lastMessage ? previewText(chat.lastMessage) : 'Нет сообщений';
    const avatarUrl = chat.avatarUrl || chat.otherUser?.avatarUrl || '';
    const onlineClass = isOnline && chat.otherUser?.showOnline !== false ? 'online-dot' : '';
    item.innerHTML = `
      ${avatarHtml(chat.title || 'Чат', avatarUrl, avatarClass, onlineClass)}
      <div><strong>${escapeHtml(chat.title || 'Чат')}</strong><p>${escapeHtml(preview)}</p></div>
      <div class="dialog-meta"><span>${fmtTime(chat.lastMessage?.createdAt || chat.updatedAt)}</span>${chat.unreadCount ? `<span class="count">${chat.unreadCount}</span>` : ''}</div>
    `;
    item.addEventListener('click', () => openChat(chat.id));
    els.chatList.appendChild(item);
  }
}

function renderStories() {
  els.onlineStories.innerHTML = '';
  const users = state.chats
    .map(c => c.otherUser)
    .filter(Boolean)
    .filter(u => state.onlineUserIds.has(Number(u.id)))
    .slice(0, 12);
  if (!users.length) {
    const story = document.createElement('div');
    story.className = 'story';
    story.innerHTML = `<div class="story-avatar">☁</div>online`;
    els.onlineStories.appendChild(story);
    return;
  }
  for (const user of users) {
    const story = document.createElement('div');
    story.className = 'story';
    story.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'story-avatar')}${escapeHtml(user.displayName.split(' ')[0])}`;
    story.addEventListener('click', async () => {
      const chat = state.chats.find(c => c.otherUser && Number(c.otherUser.id) === Number(user.id));
      if (chat) await openChat(chat.id);
    });
    els.onlineStories.appendChild(story);
  }
}

function previewText(lastMessage) {
  if (!lastMessage) return '';
  if (lastMessage.type === 'audio') return '🎙️ Голосовое сообщение';
  if (lastMessage.type === 'video') return '📹 Видеокружок';
  if (lastMessage.type === 'image') return '🖼️ Изображение';
  if (lastMessage.type === 'file') return '📎 Файл';
  return lastMessage.body || 'Сообщение';
}

async function loadChatDetails(chatId, force = false) {
  const id = Number(chatId);
  if (!force && state.chatDetails.has(id)) return state.chatDetails.get(id);
  const data = await api(`/api/chats/${id}/details`);
  state.chatDetails.set(id, data);
  return data;
}

async function openChat(chatId) {
  state.activeChatId = Number(chatId);
  showTopProgress('Открываем чат...');
  renderMessageSkeleton();
  const chat = state.chats.find(c => Number(c.id) === Number(chatId));
  if (chat) chat.unreadCount = 0;
  els.appShell.dataset.mobileView = 'chat';
  updateActiveHeader();
  renderChats();
  await loadChatDetails(chatId);
  if (!state.messages.has(Number(chatId))) {
    const data = await api(`/api/chats/${chatId}/messages`);
    state.messages.set(Number(chatId), data.messages || []);
  }
  restoreDraft(chatId);
  renderPinnedBar();
  renderMessages();
  const msgs = state.messages.get(Number(chatId)) || [];
  const last = msgs[msgs.length - 1];
  if (last) markRead(last.id);
  state.socket?.emit('chat:join', { chatId: Number(chatId) });
  hideTopProgress();
}

function updateActiveHeader() {
  const chat = state.chats.find(c => Number(c.id) === Number(state.activeChatId));
  if (!chat) return;
  els.activeTitle.textContent = chat.title || 'Чат';
  const avatarUrl = chat.avatarUrl || chat.otherUser?.avatarUrl || '';
  const isOnline = chat.otherUser && chat.otherUser.showOnline !== false && state.onlineUserIds.has(Number(chat.otherUser.id));
  setAvatar(els.activeAvatar, chat.title || 'Чат', avatarUrl, `${chat.type === 'group' ? 'blue' : ''} ${isOnline ? 'online-dot' : ''}`);
  if (chat.type === 'direct' && chat.otherUser) {
    els.activeStatus.textContent = isOnline ? 'online' : (chat.otherUser.showOnline === false ? 'online скрыт' : `был(а): ${fmtTime(chat.otherUser.lastSeen)}`);
  } else if (chat.type === 'channel') {
    els.activeStatus.textContent = chat.description || 'канал';
  } else {
    els.activeStatus.textContent = 'групповой чат';
  }
  if (els.audioCallBtn) {
    const canCall = chat.type === 'direct' && chat.otherUser;
    els.audioCallBtn.classList.toggle('hidden', !canCall);
    els.videoCallBtn.classList.toggle('hidden', !canCall);
  }
}

function renderPinnedBar() {
  if (!els.pinBar) return;
  const detail = state.chatDetails.get(Number(state.activeChatId));
  const pins = detail?.pinnedMessages || [];
  if (!state.activeChatId || !pins.length) {
    els.pinBar.classList.add('hidden');
    els.pinBar.innerHTML = '';
    return;
  }
  const first = pins[0];
  els.pinBar.classList.remove('hidden');
  els.pinBar.innerHTML = `<button type="button">📌 ${escapeHtml(previewMessageBody(first)).slice(0, 110)}</button><span>${pins.length}</span>`;
  els.pinBar.querySelector('button').addEventListener('click', () => openPinnedMessagesModal());
}

function renderMessages() {
  const chatId = Number(state.activeChatId);
  const messages = state.messages.get(chatId) || [];
  els.messageList.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div>✨</div><h2>Начните переписку</h2><p>Первое сообщение может быть текстом, голосовым или видеокружком.</p>';
    els.messageList.appendChild(empty);
    return;
  }
  const date = document.createElement('div');
  date.className = 'date';
  date.textContent = 'Сообщения';
  els.messageList.appendChild(date);

  messages.forEach((msg, index) => {
    const node = renderMessageNode(msg, messages);
    node.style.setProperty('--msg-index', String(Math.min(index, 8)));
    els.messageList.appendChild(node);
  });
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderMessageNode(msg, allMessages) {
  const mine = Number(msg.senderId) === Number(state.user.id);
  const row = document.createElement('article');
  row.className = `msg ${mine ? 'me' : ''} ${msg.isDeleted ? 'deleted' : ''}`;
  row.dataset.messageId = msg.id;
  const av = document.createElement('div');
  setAvatar(av, mine ? state.user.displayName : msg.sender?.displayName || '?', mine ? state.user.avatarUrl : msg.sender?.avatarUrl, mine ? 'blue' : '');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (msg.replyToId) {
    const original = allMessages.find(m => Number(m.id) === Number(msg.replyToId));
    const reply = document.createElement('div');
    reply.className = 'reply-preview';
    reply.textContent = original ? `${original.sender?.displayName || 'Сообщение'}: ${previewMessageBody(original)}` : 'Ответ на сообщение';
    bubble.appendChild(reply);
  }

  if (msg.isDeleted) {
    bubble.appendChild(textNode('Сообщение удалено'));
  } else if (msg.type === 'audio' && msg.media) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = msg.media.url;
    bubble.appendChild(audio);
  } else if (msg.type === 'video' && msg.media) {
    const video = document.createElement('video');
    video.className = 'video-circle';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = msg.media.url;
    bubble.appendChild(video);
  } else if (msg.type === 'image' && msg.media) {
    const img = document.createElement('img');
    img.className = 'image-message';
    img.src = msg.media.url;
    img.alt = msg.media.originalName || 'image';
    bubble.appendChild(img);
  } else if (msg.type === 'file' && msg.media) {
    const a = document.createElement('a');
    a.className = 'file-pill';
    a.href = msg.media.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `📎 ${msg.media.originalName || 'Файл'}`;
    bubble.appendChild(a);
  } else {
    bubble.appendChild(renderTextWithMentions(msg.body || ''));
  }

  if (msg.body && msg.type !== 'text' && !msg.isDeleted) {
    const cap = document.createElement('div');
    cap.style.marginTop = '8px';
    cap.textContent = msg.body;
    bubble.appendChild(cap);
  }

  const reactions = document.createElement('div');
  reactions.className = 'reactions';
  for (const r of msg.reactions || []) {
    const chip = document.createElement('button');
    chip.className = `reaction-chip ${r.mine ? 'mine' : ''}`;
    chip.type = 'button';
    chip.textContent = `${r.emoji} ${r.count}`;
    chip.addEventListener('click', () => toggleReaction(msg, r.emoji, r.mine));
    reactions.appendChild(chip);
  }
  if (reactions.childElementCount) bubble.appendChild(reactions);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = `${mine ? 'Вы' : msg.sender?.displayName || 'Пользователь'} · ${fmtTime(msg.createdAt)}${msg.isEdited ? ' · изменено' : ''}${mine ? ' · ' + readStatus(msg) : ''}`;
  bubble.appendChild(meta);

  if (!msg.isDeleted) {
    const tools = document.createElement('div');
    tools.className = 'msg-tools';
    tools.append(toolButton('↩', 'Ответить', () => setReply(msg)));
    tools.append(toolButton('⭐', 'В избранное', () => saveMessage(msg)));
    tools.append(toolButton('🔥', 'Реакция', () => quickReact(msg)));
    if (currentChatRoleCanModerate()) tools.append(toolButton('📌', 'Закрепить', () => pinMessage(msg)));
    if (mine && msg.type === 'text') tools.append(toolButton('✎', 'Редактировать', () => editMessage(msg)));
    if (mine || currentChatRoleCanModerate()) tools.append(toolButton('🗑', 'Удалить', () => deleteMessage(msg)));
    if (!mine) tools.append(toolButton('⚑', 'Пожаловаться', () => reportMessage(msg)));
    bubble.appendChild(tools);
  }

  row.appendChild(av);
  row.appendChild(bubble);
  return row;
}

function textNode(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function renderTextWithMentions(text) {
  const wrap = document.createElement('span');
  const parts = String(text || '').split(/(@[a-zA-Z0-9_]{2,32})/g);
  for (const part of parts) {
    if (!part) continue;
    if (/^@[a-zA-Z0-9_]{2,32}$/.test(part)) {
      const mention = document.createElement('span');
      mention.className = 'mention';
      mention.textContent = part;
      wrap.appendChild(mention);
    } else {
      wrap.appendChild(document.createTextNode(part));
    }
  }
  return wrap;
}

function toolButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function previewMessageBody(msg) {
  if (msg.type === 'text') return msg.body || '';
  return previewText(msg);
}

function currentChatRoleCanModerate() {
  const chat = state.chats.find(c => Number(c.id) === Number(state.activeChatId));
  return chat && ['owner', 'admin'].includes(chat.myRole);
}

function readStatus(msg) {
  const detail = state.chatDetails.get(Number(msg.chatId));
  if (!detail || !detail.members) return '✓ отправлено';
  const others = detail.members.filter(m => Number(m.userId) !== Number(state.user.id));
  if (!others.length) return '✓ отправлено';
  const readCount = others.filter(m => Number(m.lastReadMessageId || 0) >= Number(msg.id)).length;
  if (detail.chat?.type === 'group') return readCount ? `✓✓ прочитали ${readCount}/${others.length}` : '✓ отправлено';
  return readCount > 0 ? '✓✓ прочитано' : '✓ отправлено';
}

function setReply(msg) {
  state.replyTo = msg;
  els.replyText.textContent = previewMessageBody(msg);
  els.replyBar.classList.remove('hidden');
  els.messageInput.focus();
}

function clearReply() {
  state.replyTo = null;
  els.replyBar.classList.add('hidden');
  els.replyText.textContent = '';
}

async function quickReact(msg) {
  const emoji = prompt('Введите реакцию', '🔥');
  if (!emoji) return;
  await toggleReaction(msg, emoji, false);
}

async function toggleReaction(msg, emoji, mine) {
  try {
    const path = `/api/messages/${msg.id}/reactions${mine ? '/' + encodeURIComponent(emoji) : ''}`;
    const method = mine ? 'DELETE' : 'POST';
    const body = mine ? undefined : JSON.stringify({ emoji });
    const data = await api(path, { method, body });
    addOrUpdateMessage(data.message);
    renderMessages();
  } catch (error) { toast(error.message); }
}

async function editMessage(msg) {
  const body = prompt('Изменить сообщение', msg.body || '');
  if (!body || body === msg.body) return;
  try {
    const data = await api(`/api/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    addOrUpdateMessage(data.message);
    renderMessages();
  } catch (error) { toast(error.message); }
}

async function deleteMessage(msg) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    const data = await api(`/api/messages/${msg.id}`, { method: 'DELETE' });
    addOrUpdateMessage(data.message);
    renderMessages();
  } catch (error) { toast(error.message); }
}

async function reportMessage(msg) {
  const reason = prompt('Причина жалобы', 'Спам');
  if (!reason) return;
  try {
    await api(`/api/messages/${msg.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
    toast('Жалоба отправлена');
  } catch (error) { toast(error.message); }
}

async function saveMessage(msg) {
  try {
    await api(`/api/messages/${msg.id}/save`, { method: 'POST' });
    toast('Добавлено в избранное');
  } catch (error) { toast(error.message); }
}

async function pinMessage(msg) {
  if (!state.activeChatId) return;
  try {
    await api(`/api/chats/${state.activeChatId}/pins`, { method: 'POST', body: JSON.stringify({ messageId: msg.id }) });
    await loadChatDetails(state.activeChatId, true);
    renderPinnedBar();
    toast('Сообщение закреплено');
  } catch (error) { toast(error.message); }
}

async function sendTextMessage(text) {
  if (!state.activeChatId || !text.trim()) return;
  const payload = { chatId: state.activeChatId, body: text.trim(), replyToId: state.replyTo?.id || null };
  setComposeStatus('Отправляем сообщение...');
  try {
    if (state.socket?.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Сервер долго не отвечает. Проверьте соединение.')), 12000);
        state.socket.emit('chat:send', payload, (res) => {
          clearTimeout(timer);
          if (!res?.ok) reject(new Error(res?.error || 'Не удалось отправить'));
          else resolve(res);
        });
      });
    } else {
      const data = await api(`/api/chats/${state.activeChatId}/messages`, { method: 'POST', body: JSON.stringify(payload) });
      addOrUpdateMessage(data.message);
      renderMessages();
    }
    clearReply();
    clearDraft();
  } finally {
    setComposeStatus('');
  }
}

async function markRead(messageId) {
  if (!state.activeChatId || !messageId) return;
  try {
    state.socket?.emit('chat:read', { chatId: state.activeChatId, messageId });
    await api(`/api/chats/${state.activeChatId}/read`, { method: 'POST', body: JSON.stringify({ messageId }) });
  } catch (_) {}
}

function renderTyping() {
  const map = state.typingUsers.get(Number(state.activeChatId));
  if (!map || map.size === 0) {
    els.typingLine.textContent = '';
    return;
  }
  els.typingLine.textContent = `${[...map.values()].join(', ')} печатает...`;
}

let typingTimeout = null;
function notifyTyping() {
  if (!state.activeChatId || !state.socket) return;
  state.socket.emit('typing:start', { chatId: state.activeChatId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => state.socket.emit('typing:stop', { chatId: state.activeChatId }), 900);
}

async function uploadAndSendMedia(file, kind, durationSec = null, caption = '') {
  if (!state.activeChatId) return toast('Сначала выберите чат');
  const label = kind === 'audio' ? 'Загружаем голосовое...' : kind === 'video' ? 'Загружаем видеокружок...' : kind === 'image' ? 'Загружаем изображение...' : 'Загружаем файл...';
  showTopProgress(label);
  setComposeStatus(label);
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('chatId', String(state.activeChatId));
    form.append('kind', kind);
    if (durationSec) form.append('durationSec', String(Math.round(durationSec)));
    const upload = await api('/api/media/upload', { method: 'POST', body: form });
    setComposeStatus('Создаём сообщение...');
    const data = await api(`/api/chats/${state.activeChatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        type: kind,
        mediaId: upload.media.id,
        body: caption,
        replyToId: state.replyTo?.id || null
      })
    });
    addOrUpdateMessage(data.message);
    patchChatPreview(data.message);
    renderMessages();
    clearReply();
  } finally {
    setComposeStatus('');
    hideTopProgress();
  }
}

async function startRecording(kind) {
  if (!state.activeChatId) return toast('Сначала выберите чат');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast('Браузер не поддерживает запись MediaRecorder');
  }
  showTopProgress(kind === 'video' ? 'Открываем камеру...' : 'Открываем микрофон...');
  state.recordKind = kind;
  state.recordCancelled = false;
  state.recordChunks = [];
  const constraints = kind === 'video'
    ? { audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } }
    : { audio: true };

  try {
    state.recordStream = await navigator.mediaDevices.getUserMedia(constraints);
    const mimeType = pickMimeType(kind);
    state.recorder = new MediaRecorder(state.recordStream, mimeType ? { mimeType } : undefined);
    state.recorder.ondataavailable = (e) => { if (e.data.size > 0) state.recordChunks.push(e.data); };
    state.recorder.onstop = onRecordStop;
    state.recordStartedAt = Date.now();
    state.recorder.start(250);
    openRecordOverlay(kind);
    const limit = kind === 'video' ? 90 : 300;
    state.recordTimerId = setInterval(() => {
      const seconds = (Date.now() - state.recordStartedAt) / 1000;
      els.recordTimer.textContent = formatDuration(seconds);
      if (seconds >= limit && state.recorder?.state === 'recording') stopRecording(false);
    }, 300);
  } catch (error) {
    toast(error.name === 'NotAllowedError' ? 'Нет доступа к камере или микрофону' : error.message);
    cleanupRecording();
  }
}

function pickMimeType(kind) {
  const candidates = kind === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function openRecordOverlay(kind) {
  els.recordOverlay.classList.remove('hidden');
  requestAnimationFrame(() => els.recordOverlay.classList.add('is-visible'));
  els.recordTitle.textContent = kind === 'video' ? 'Запись видеокружка' : 'Запись голосового';
  els.recordPreview.classList.toggle('hidden', kind !== 'video');
  els.recordAudioIcon.classList.toggle('hidden', kind === 'video');
  els.recordTimer.textContent = '00:00';
  if (kind === 'video') els.recordPreview.srcObject = state.recordStream;
}

function stopRecording(cancelled) {
  state.recordCancelled = cancelled;
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
  else cleanupRecording();
}

async function onRecordStop() {
  const kind = state.recordKind;
  const duration = (Date.now() - state.recordStartedAt) / 1000;
  const mimeType = state.recordChunks[0]?.type || (kind === 'video' ? 'video/webm' : 'audio/webm');
  const blob = new Blob(state.recordChunks, { type: mimeType });
  cleanupRecording();
  if (state.recordCancelled || !blob.size) return;
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `${kind}-${Date.now()}.${ext}`, { type: mimeType });
  try {
    await uploadAndSendMedia(file, kind, duration);
    toast(kind === 'video' ? 'Видеокружок отправлен' : 'Голосовое отправлено');
  } catch (error) {
    toast(error.message);
  } finally {
    hideTopProgress();
  }
}

function cleanupRecording() {
  clearInterval(state.recordTimerId);
  state.recordTimerId = null;
  if (state.recordStream) state.recordStream.getTracks().forEach(track => track.stop());
  state.recordStream = null;
  state.recorder = null;
  els.recordPreview.srcObject = null;
  els.recordOverlay.classList.remove('is-visible');
  els.recordOverlay.classList.add('hidden');
}

function openModal(title, contentBuilder) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = '';
  if (typeof contentBuilder === 'function') contentBuilder(els.modalBody);
  else if (contentBuilder instanceof Node) els.modalBody.appendChild(contentBuilder);
  els.modal.classList.remove('hidden');
  requestAnimationFrame(() => els.modal.classList.add('is-visible'));
}

function closeModal() {
  els.modal.classList.remove('is-visible');
  setTimeout(() => {
    els.modal.classList.add('hidden');
    els.modalBody.innerHTML = '';
  }, 140);
}

function openNewChatModal() {
  openModal('Новый чат', (body) => {
    const input = document.createElement('input');
    input.placeholder = 'Введите имя или логин пользователя';
    const results = document.createElement('div');
    body.append(input, results);
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        results.innerHTML = '';
        const q = input.value.trim();
        if (!q) return;
        try {
          const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
          for (const user of data.users) {
            const row = document.createElement('div');
            row.className = 'user-result';
            row.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'avatar')}<div><strong>${escapeHtml(user.displayName)}</strong><br><span>@${escapeHtml(user.username)}</span></div>`;
            row.addEventListener('click', async () => {
              const chat = await api('/api/chats/direct', { method: 'POST', body: JSON.stringify({ userId: user.id }) });
              closeModal();
              await loadChats();
              await openChat(chat.chatId);
            });
            results.appendChild(row);
          }
        } catch (error) { toast(error.message); }
      }, 250);
    });
    input.focus();
  });
}

function openCreateGroupModal() {
  openModal('Создать группу', (body) => {
    const title = document.createElement('input');
    title.placeholder = 'Название группы';
    const search = document.createElement('input');
    search.placeholder = 'Найти участников';
    search.style.marginTop = '10px';
    const selected = new Map();
    const selectedBox = document.createElement('div');
    const results = document.createElement('div');
    const create = document.createElement('button');
    create.className = 'primary';
    create.style.marginTop = '14px';
    create.textContent = 'Создать';
    body.append(title, search, selectedBox, results, create);

    function renderSelected() {
      selectedBox.innerHTML = '';
      if (!selected.size) return;
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = `Выбрано: ${[...selected.values()].map(u => u.displayName).join(', ')}`;
      selectedBox.appendChild(note);
    }

    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        results.innerHTML = '';
        const q = search.value.trim();
        if (!q) return;
        const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        for (const user of data.users) {
          const row = document.createElement('div');
          row.className = 'user-result';
          row.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'avatar green')}<div><strong>${escapeHtml(user.displayName)}</strong><br><span>@${escapeHtml(user.username)}</span></div>`;
          row.addEventListener('click', () => {
            selected.set(Number(user.id), user);
            renderSelected();
          });
          results.appendChild(row);
        }
      }, 250);
    });

    create.addEventListener('click', async () => {
      if (!title.value.trim()) return toast('Введите название группы');
      const data = await api('/api/chats/group', {
        method: 'POST',
        body: JSON.stringify({ title: title.value.trim(), memberIds: [...selected.keys()] })
      });
      closeModal();
      await loadChats();
      await openChat(data.chatId);
    });
  });
}

function labeledCheckbox(label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'check-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return { wrap, input };
}

function openProfileModal() {
  openModal('Профиль и приватность', (body) => {
    const preview = document.createElement('div');
    preview.className = 'profile-preview';
    preview.innerHTML = avatarHtml(state.user.displayName, state.user.avatarUrl, 'avatar');
    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(state.user.displayName)}</strong><span>@${escapeHtml(state.user.username)}</span>`;
    preview.appendChild(info);

    const avatarInput = document.createElement('input');
    avatarInput.type = 'file';
    avatarInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    avatarInput.className = 'hidden';

    const uploadAvatar = document.createElement('button');
    uploadAvatar.className = 'secondary';
    uploadAvatar.textContent = 'Загрузить аватар';

    const name = document.createElement('input');
    name.value = state.user.displayName;
    name.placeholder = 'Имя';

    const status = document.createElement('input');
    status.value = state.user.statusText || '';
    status.placeholder = 'Статус';
    status.style.marginTop = '10px';

    const allowDirect = labeledCheckbox('Разрешить новые личные сообщения', state.user.allowDirectMessages !== false);
    const showOnline = labeledCheckbox('Показывать мой online и last seen', state.user.showOnline !== false);

    const save = document.createElement('button');
    save.className = 'primary';
    save.style.marginTop = '14px';
    save.textContent = 'Сохранить';

    const blocks = document.createElement('div');
    blocks.className = 'mini-list';

    async function renderBlocks() {
      blocks.innerHTML = '<h3>Чёрный список</h3>';
      const data = await api('/api/blocks');
      if (!data.users.length) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'Заблокированных пользователей нет.';
        blocks.appendChild(note);
      }
      for (const user of data.users) {
        const row = document.createElement('div');
        row.className = 'user-result';
        row.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'avatar gray')}<div><strong>${escapeHtml(user.displayName)}</strong><br><span>@${escapeHtml(user.username)}</span></div>`;
        const un = document.createElement('button');
        un.className = 'secondary';
        un.textContent = 'Разблокировать';
        un.addEventListener('click', async () => {
          await api(`/api/blocks/${user.id}`, { method: 'DELETE' });
          await renderBlocks();
        });
        row.appendChild(un);
        blocks.appendChild(row);
      }
    }

    uploadAvatar.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        const data = await api('/api/me/avatar', { method: 'POST', body: form });
        state.user = data.user;
        showApp();
        closeModal();
        toast('Аватар обновлён');
      } catch (error) { toast(error.message); }
      finally { avatarInput.value = ''; }
    });

    save.addEventListener('click', async () => {
      const data = await api('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: name.value.trim(),
          statusText: status.value.trim(),
          allowDirectMessages: allowDirect.input.checked,
          showOnline: showOnline.input.checked
        })
      });
      state.user = data.user;
      showApp();
      closeModal();
      await loadChats();
      toast('Профиль сохранён');
    });

    body.append(preview, uploadAvatar, avatarInput, name, status, allowDirect.wrap, showOnline.wrap, save, blocks);
    renderBlocks().catch(() => {});
  });
}

async function openSearchMessagesModal() {
  if (!state.activeChatId) return toast('Сначала выберите чат');
  openModal('Поиск по сообщениям', (body) => {
    const input = document.createElement('input');
    input.placeholder = 'Введите текст сообщения';
    const results = document.createElement('div');
    body.append(input, results);
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        results.innerHTML = '';
        const q = input.value.trim();
        if (!q) return;
        try {
          const data = await api(`/api/chats/${state.activeChatId}/search?q=${encodeURIComponent(q)}`);
          if (!data.messages.length) {
            const note = document.createElement('div');
            note.className = 'note';
            note.textContent = 'Ничего не найдено';
            results.appendChild(note);
          }
          for (const msg of data.messages) {
            const row = document.createElement('div');
            row.className = 'search-result';
            row.innerHTML = `<strong>${escapeHtml(msg.sender?.displayName || 'Пользователь')} · ${fmtTime(msg.createdAt)}</strong><span>${escapeHtml(previewMessageBody(msg))}</span>`;
            row.addEventListener('click', () => {
              closeModal();
              const node = document.querySelector(`[data-message-id="${msg.id}"]`);
              node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              node?.classList.add('flash');
              setTimeout(() => node?.classList.remove('flash'), 1400);
            });
            results.appendChild(row);
          }
        } catch (error) { toast(error.message); }
      }, 250);
    });
    input.focus();
  });
}

async function openChatInfoModal() {
  if (!state.activeChatId) return openProfileModal();
  const chat = state.chats.find(c => Number(c.id) === Number(state.activeChatId));
  const detail = await loadChatDetails(state.activeChatId, true);

  openModal(chat?.type === 'group' ? 'Группа' : 'Информация о чате', (body) => {
    const top = document.createElement('div');
    top.className = 'profile-preview';
    top.innerHTML = avatarHtml(chat?.title || 'Чат', chat?.avatarUrl || chat?.otherUser?.avatarUrl, chat?.type === 'group' ? 'avatar blue' : 'avatar');
    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(chat?.title || 'Чат')}</strong><span>${chat?.type === 'group' ? `${detail.members.length} участников` : '@' + escapeHtml(chat?.otherUser?.username || '')}</span>`;
    top.appendChild(info);
    body.appendChild(top);

    if (chat?.type === 'direct' && chat.otherUser) {
      const block = document.createElement('button');
      block.className = 'danger-btn';
      block.textContent = 'Заблокировать пользователя';
      block.addEventListener('click', async () => {
        await api(`/api/blocks/${chat.otherUser.id}`, { method: 'POST' });
        toast('Пользователь заблокирован');
        closeModal();
      });
      body.appendChild(block);
      return;
    }

    const canManage = ['owner', 'admin'].includes(detail.chat.myRole);
    if (canManage) {
      const title = document.createElement('input');
      title.value = detail.chat.title || chat?.title || '';
      title.placeholder = 'Название группы';
      const save = document.createElement('button');
      save.className = 'primary';
      save.textContent = 'Сохранить название';
      save.style.marginTop = '10px';
      save.addEventListener('click', async () => {
        await api(`/api/chats/${state.activeChatId}`, { method: 'PATCH', body: JSON.stringify({ title: title.value.trim() }) });
        await loadChats();
        await loadChatDetails(state.activeChatId, true);
        updateActiveHeader();
        closeModal();
      });

      const search = document.createElement('input');
      search.placeholder = 'Добавить участника по имени или логину';
      search.style.marginTop = '16px';
      const results = document.createElement('div');

      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          results.innerHTML = '';
          const q = search.value.trim();
          if (!q) return;
          const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
          for (const user of data.users) {
            if (detail.members.some(m => Number(m.userId) === Number(user.id))) continue;
            const row = document.createElement('div');
            row.className = 'user-result';
            row.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'avatar green')}<div><strong>${escapeHtml(user.displayName)}</strong><br><span>@${escapeHtml(user.username)}</span></div>`;
            row.addEventListener('click', async () => {
              await api(`/api/chats/${state.activeChatId}/members`, { method: 'POST', body: JSON.stringify({ userId: user.id }) });
              toast('Участник добавлен');
              closeModal();
              await loadChatDetails(state.activeChatId, true);
            });
            results.appendChild(row);
          }
        }, 250);
      });

      const inviteBtn = document.createElement('button');
      inviteBtn.className = 'secondary';
      inviteBtn.style.marginTop = '12px';
      inviteBtn.textContent = 'Создать ссылку-приглашение';
      inviteBtn.addEventListener('click', createInviteLink);
      const inviteList = document.createElement('div');
      inviteList.className = 'mini-list';
      if (detail.invites?.length) {
        inviteList.innerHTML = '<h3>Ссылки-приглашения</h3>';
        for (const inv of detail.invites) {
          const item = document.createElement('div');
          item.className = 'note';
          const absolute = `${location.origin}${inv.url}`;
          item.innerHTML = `<strong>${escapeHtml(absolute)}</strong><span>Использовано: ${inv.usedCount}${inv.maxUses ? '/' + inv.maxUses : ''}${inv.revokedAt ? ' · отозвана' : ''}</span>`;
          item.addEventListener('click', async () => {
            await navigator.clipboard?.writeText(absolute).catch(() => {});
            toast('Ссылка скопирована');
          });
          inviteList.appendChild(item);
        }
      }
      body.append(title, save, search, results, inviteBtn, inviteList);
    }

    const h = document.createElement('h3');
    h.textContent = 'Участники';
    body.appendChild(h);

    for (const member of detail.members) {
      const row = document.createElement('div');
      row.className = 'user-result';
      row.innerHTML = `${avatarHtml(member.user.displayName, member.user.avatarUrl, 'avatar')}<div><strong>${escapeHtml(member.user.displayName)}</strong><br><span>@${escapeHtml(member.user.username)} · ${escapeHtml(member.role)}</span></div>`;
      if (canManage && member.role !== 'owner' && Number(member.userId) !== Number(state.user.id)) {
        const promote = document.createElement('button');
        promote.className = 'secondary';
        promote.textContent = member.role === 'admin' ? 'Сделать участником' : 'Сделать админом';
        promote.addEventListener('click', async () => {
          await api(`/api/chats/${state.activeChatId}/members/${member.userId}`, { method: 'PATCH', body: JSON.stringify({ role: member.role === 'admin' ? 'member' : 'admin' }) });
          closeModal();
          await loadChatDetails(state.activeChatId, true);
        });
        const remove = document.createElement('button');
        remove.className = 'danger-btn small';
        remove.textContent = 'Удалить';
        remove.addEventListener('click', async () => {
          if (!confirm('Удалить участника из группы?')) return;
          await api(`/api/chats/${state.activeChatId}/members/${member.userId}`, { method: 'DELETE' });
          closeModal();
          await loadChatDetails(state.activeChatId, true);
        });
        row.append(promote, remove);
      }
      body.appendChild(row);
    }

    if (detail.chat.myRole !== 'owner') {
      const leave = document.createElement('button');
      leave.className = 'danger-btn';
      leave.textContent = 'Выйти из группы';
      leave.addEventListener('click', async () => {
        if (!confirm('Выйти из группы?')) return;
        await api(`/api/chats/${state.activeChatId}/leave`, { method: 'POST' });
        closeModal();
        state.activeChatId = null;
        await loadChats();
        els.appShell.dataset.mobileView = 'list';
      });
      body.appendChild(leave);
    }
  });
}


function openCreateChannelModal() {
  openModal('Создать канал', (body) => {
    const title = document.createElement('input');
    title.placeholder = 'Название канала';
    const description = document.createElement('textarea');
    description.placeholder = 'Описание канала';
    description.style.marginTop = '10px';
    const isPublic = labeledCheckbox('Публичный канал в каталоге', true);
    const create = document.createElement('button');
    create.className = 'primary';
    create.style.marginTop = '14px';
    create.textContent = 'Создать канал';
    create.addEventListener('click', async () => {
      if (!title.value.trim()) return toast('Введите название канала');
      try {
        const data = await api('/api/channels', {
          method: 'POST',
          body: JSON.stringify({ title: title.value.trim(), description: description.value.trim(), isPublic: isPublic.input.checked })
        });
        closeModal();
        await loadChats();
        await openChat(data.chatId);
      } catch (error) { toast(error.message); }
    });
    body.append(title, description, isPublic.wrap, create);
  });
}

function openPublicChannelsModal() {
  openModal('Публичные каналы', (body) => {
    const input = document.createElement('input');
    input.placeholder = 'Поиск каналов';
    const results = document.createElement('div');
    body.append(input, results);
    async function load(q = '') {
      results.innerHTML = '';
      const data = await api(`/api/channels/public?q=${encodeURIComponent(q)}`);
      if (!data.channels.length) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'Публичных каналов пока нет.';
        results.appendChild(note);
        return;
      }
      for (const ch of data.channels) {
        const row = document.createElement('div');
        row.className = 'user-result';
        row.innerHTML = `${avatarHtml(ch.title, ch.avatarUrl, 'avatar blue')}<div><strong>${escapeHtml(ch.title)}</strong><br><span>${escapeHtml(ch.description || '')} · ${ch.memberCount} участн.</span></div>`;
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = ch.joined ? 'Открыть' : 'Вступить';
        btn.addEventListener('click', async () => {
          try {
            if (!ch.joined) await api(`/api/channels/${ch.id}/join`, { method: 'POST' });
            closeModal();
            await loadChats();
            await openChat(ch.id);
          } catch (error) { toast(error.message); }
        });
        row.appendChild(btn);
        results.appendChild(row);
      }
    }
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(input.value.trim()).catch(e => toast(e.message)), 250);
    });
    load().catch(e => { results.textContent = e.message; });
  });
}

async function openSavedMessagesModal() {
  openModal('Избранные сообщения', async (body) => {
    body.textContent = 'Загрузка...';
    try {
      const data = await api('/api/saved/messages');
      body.innerHTML = '';
      if (!data.messages.length) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'Избранных сообщений пока нет.';
        body.appendChild(note);
        return;
      }
      for (const msg of data.messages) {
        const row = document.createElement('div');
        row.className = 'search-result';
        row.innerHTML = `<strong>${escapeHtml(msg.sender?.displayName || 'Пользователь')} · ${fmtTime(msg.createdAt)}</strong><span>${escapeHtml(previewMessageBody(msg))}</span>`;
        const open = document.createElement('button');
        open.className = 'secondary';
        open.textContent = 'Открыть';
        open.addEventListener('click', async () => {
          closeModal();
          await openChat(msg.chatId);
          setTimeout(() => {
            const node = document.querySelector(`[data-message-id="${msg.id}"]`);
            node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            node?.classList.add('flash');
            setTimeout(() => node?.classList.remove('flash'), 1400);
          }, 150);
        });
        const remove = document.createElement('button');
        remove.className = 'danger-btn small';
        remove.textContent = 'Убрать';
        remove.addEventListener('click', async () => {
          await api(`/api/messages/${msg.id}/save`, { method: 'DELETE' });
          openSavedMessagesModal();
        });
        row.append(open, remove);
        body.appendChild(row);
      }
    } catch (error) { body.textContent = error.message; }
  });
}

async function openPinnedMessagesModal() {
  if (!state.activeChatId) return;
  const detail = await loadChatDetails(state.activeChatId, true);
  openModal('Закреплённые сообщения', (body) => {
    if (!detail.pinnedMessages?.length) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'Закреплённых сообщений нет.';
      body.appendChild(note);
      return;
    }
    for (const msg of detail.pinnedMessages) {
      const row = document.createElement('div');
      row.className = 'search-result';
      row.innerHTML = `<strong>${escapeHtml(msg.sender?.displayName || 'Пользователь')} · ${fmtTime(msg.createdAt)}</strong><span>${escapeHtml(previewMessageBody(msg))}</span>`;
      row.addEventListener('click', () => {
        closeModal();
        const node = document.querySelector(`[data-message-id="${msg.id}"]`);
        node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      if (currentChatRoleCanModerate()) {
        const unpin = document.createElement('button');
        unpin.className = 'danger-btn small';
        unpin.textContent = 'Открепить';
        unpin.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api(`/api/chats/${state.activeChatId}/pins/${msg.id}`, { method: 'DELETE' });
          await loadChatDetails(state.activeChatId, true);
          renderPinnedBar();
          openPinnedMessagesModal();
        });
        row.appendChild(unpin);
      }
      body.appendChild(row);
    }
  });
}

async function createInviteLink() {
  if (!state.activeChatId) return;
  try {
    const data = await api(`/api/chats/${state.activeChatId}/invites`, { method: 'POST', body: JSON.stringify({ maxUses: null, expiresInHours: null }) });
    const absolute = `${location.origin}${data.invite.url}`;
    await navigator.clipboard?.writeText(absolute).catch(() => {});
    toast(`Ссылка создана и скопирована: ${absolute}`);
    await loadChatDetails(state.activeChatId, true);
  } catch (error) { toast(error.message); }
}

async function joinInviteFromUrl() {
  const match = location.pathname.match(/^\/invite\/([a-zA-Z0-9_-]+)/);
  if (!match || !state.user) return false;
  try {
    const data = await api(`/api/invites/${match[1]}/join`, { method: 'POST' });
    history.replaceState({}, '', '/');
    await loadChats();
    await openChat(data.chatId);
    toast(`Вы вступили в чат: ${data.title || ''}`);
    return true;
  } catch (error) {
    toast(error.message);
    history.replaceState({}, '', '/');
    return false;
  }
}


function currentDirectPeer() {
  const chat = state.chats.find(c => Number(c.id) === Number(state.activeChatId));
  if (!chat || chat.type !== 'direct' || !chat.otherUser) return null;
  return chat.otherUser;
}

function setCallUi({ title = 'Звонок', status = 'Соединение...', incoming = false, kind = 'audio' } = {}) {
  els.callOverlay.classList.remove('hidden');
  els.callTitle.textContent = title;
  els.callStatus.textContent = status;
  els.acceptCallBtn.classList.toggle('hidden', !incoming);
  els.endCallBtn.classList.toggle('hidden', incoming);
  els.rejectCallBtn.textContent = incoming ? 'Отклонить' : 'Завершить';
  els.remoteVideo.classList.toggle('hidden', kind !== 'video');
  els.localVideo.classList.toggle('hidden', kind !== 'video');
  els.cameraCallBtn.classList.toggle('hidden', kind !== 'video');
  els.screenCallBtn.classList.toggle('hidden', kind !== 'video');
}

function createPeerConnection(targetUserId) {
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  pc.onicecandidate = (event) => {
    if (event.candidate && state.socket) {
      state.socket.emit('call:ice', { targetUserId, callId: state.call.callId, candidate: event.candidate });
    }
  };
  pc.ontrack = (event) => {
    const [stream] = event.streams;
    els.remoteAudio.srcObject = stream;
    els.remoteVideo.srcObject = stream;
  };
  pc.onconnectionstatechange = () => {
    els.callStatus.textContent = pc.connectionState === 'connected' ? 'Соединено' : pc.connectionState;
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      if (state.call.active) endCall(false, 'Соединение завершено');
    }
  };
  return pc;
}

async function startDirectCall(kind) {
  const peer = currentDirectPeer();
  if (!peer) return toast('Звонки доступны в личных чатах');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Браузер не поддерживает WebRTC');
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { audio: true, video: true } : { audio: true });
    state.call = { active: true, incoming: null, peer: createPeerConnection(peer.id), localStream: stream, remoteUserId: peer.id, callId: null, kind, muted: false, cameraOff: false };
    stream.getTracks().forEach(track => state.call.peer.addTrack(track, stream));
    els.localVideo.srcObject = stream;
    setCallUi({ title: `${kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок'}: ${peer.displayName}`, status: 'Звоним...', incoming: false, kind });
    const offer = await state.call.peer.createOffer();
    await state.call.peer.setLocalDescription(offer);
    state.socket.emit('call:offer', { chatId: state.activeChatId, targetUserId: peer.id, kind, offer }, (res) => {
      if (!res?.ok) {
        toast(res?.error || 'Не удалось начать звонок');
        endCall(false);
        return;
      }
      state.call.callId = res.callId;
    });
  } catch (error) { toast(error.name === 'NotAllowedError' ? 'Нет доступа к камере/микрофону' : error.message); }
}

async function handleIncomingCall(payload) {
  if (state.call.active) {
    state.socket?.emit('call:reject', { targetUserId: payload.fromUser.id, callId: payload.callId });
    return;
  }
  state.call.incoming = payload;
  state.call.kind = payload.kind;
  state.call.remoteUserId = payload.fromUser.id;
  state.call.callId = payload.callId;
  setCallUi({ title: `Входящий ${payload.kind === 'video' ? 'видеозвонок' : 'звонок'}`, status: payload.fromUser.displayName, incoming: true, kind: payload.kind });
}

async function acceptIncomingCall() {
  const payload = state.call.incoming;
  if (!payload) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(payload.kind === 'video' ? { audio: true, video: true } : { audio: true });
    const pc = createPeerConnection(payload.fromUser.id);
    state.call = { active: true, incoming: null, peer: pc, localStream: stream, remoteUserId: payload.fromUser.id, callId: payload.callId, kind: payload.kind, muted: false, cameraOff: false };
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    els.localVideo.srcObject = stream;
    setCallUi({ title: `Звонок: ${payload.fromUser.displayName}`, status: 'Подключаемся...', incoming: false, kind: payload.kind });
    await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.socket.emit('call:answer', { targetUserId: payload.fromUser.id, callId: payload.callId, answer });
  } catch (error) { toast(error.message); endCall(true); }
}

async function handleCallAnswer(payload) {
  if (!state.call.peer) return;
  await state.call.peer.setRemoteDescription(new RTCSessionDescription(payload.answer)).catch(e => toast(e.message));
  els.callStatus.textContent = 'Соединяем...';
}

async function handleCallIce(payload) {
  if (!state.call.peer || !payload.candidate) return;
  await state.call.peer.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
}

function endCall(notify = true, message = '') {
  const remote = state.call.remoteUserId;
  const callId = state.call.callId;
  if (notify && remote && state.socket) state.socket.emit('call:end', { targetUserId: remote, callId });
  if (state.call.localStream) state.call.localStream.getTracks().forEach(track => track.stop());
  if (state.call.peer) state.call.peer.close();
  els.remoteVideo.srcObject = null;
  els.localVideo.srcObject = null;
  els.remoteAudio.srcObject = null;
  els.callOverlay.classList.add('hidden');
  state.call = { active: false, incoming: null, peer: null, localStream: null, remoteUserId: null, callId: null, kind: 'audio', muted: false, cameraOff: false };
  if (message) toast(message);
}

function rejectIncomingCall() {
  const incoming = state.call.incoming;
  if (incoming) state.socket?.emit('call:reject', { targetUserId: incoming.fromUser.id, callId: incoming.callId });
  endCall(false);
}

function toggleCallMute() {
  if (!state.call.localStream) return;
  state.call.muted = !state.call.muted;
  state.call.localStream.getAudioTracks().forEach(track => { track.enabled = !state.call.muted; });
  els.muteCallBtn.textContent = state.call.muted ? 'Включить микрофон' : 'Микрофон';
}

function toggleCallCamera() {
  if (!state.call.localStream) return;
  state.call.cameraOff = !state.call.cameraOff;
  state.call.localStream.getVideoTracks().forEach(track => { track.enabled = !state.call.cameraOff; });
  els.cameraCallBtn.textContent = state.call.cameraOff ? 'Включить камеру' : 'Камера';
}

async function shareScreen() {
  if (!state.call.peer || !navigator.mediaDevices?.getDisplayMedia) return;
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = screen.getVideoTracks()[0];
    const sender = state.call.peer.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    els.localVideo.srcObject = screen;
    track.onended = async () => {
      const cameraTrack = state.call.localStream?.getVideoTracks()[0];
      if (cameraTrack && sender) await sender.replaceTrack(cameraTrack);
      els.localVideo.srcObject = state.call.localStream;
    };
  } catch (error) { toast(error.message); }
}


async function openAdminModal() {
  openModal('Админка', async (body) => {
    body.textContent = 'Загрузка...';
    try {
      const [stats, users, reports] = await Promise.all([api('/api/admin/stats'), api('/api/admin/users'), api('/api/admin/reports')]);
      body.innerHTML = '<h3>Статистика</h3>';
      const stat = document.createElement('div');
      stat.className = 'note';
      stat.innerHTML = `<strong>Пользователи: ${stats.users} · Сообщения: ${stats.messages}</strong><span>Медиа: ${stats.media.count} файлов · ${Math.round((stats.media.bytes || 0) / 1024 / 1024)} MB</span>`;
      body.appendChild(stat);
      body.insertAdjacentHTML('beforeend', '<h3>Пользователи</h3>');
      for (const user of users.users) {
        const row = document.createElement('div');
        row.className = 'user-result';
        row.innerHTML = `${avatarHtml(user.displayName, user.avatarUrl, 'avatar gray')}<div><strong>${escapeHtml(user.displayName)}</strong><br><span>@${escapeHtml(user.username)} · ${escapeHtml(user.role)} · ${user.isBanned ? 'заблокирован' : 'активен'}</span></div>`;
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = user.isBanned ? 'Разблок.' : 'Блок';
        btn.addEventListener('click', async () => {
          await api(`/api/admin/users/${user.id}/ban`, { method: 'PATCH', body: JSON.stringify({ isBanned: !user.isBanned }) });
          openAdminModal();
        });
        row.appendChild(btn);
        body.appendChild(row);
      }
      const h = document.createElement('h3');
      h.textContent = 'Жалобы';
      body.appendChild(h);
      for (const report of reports.reports) {
        const note = document.createElement('div');
        note.className = 'note';
        note.innerHTML = `<strong>${escapeHtml(report.reason)} · ${escapeHtml(report.status)}</strong><span>Сообщение #${report.message_id}: ${escapeHtml(report.message_body || '')}</span>`;
        const reviewed = document.createElement('button');
        reviewed.className = 'secondary';
        reviewed.textContent = 'reviewed';
        reviewed.addEventListener('click', async () => {
          await api(`/api/admin/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'reviewed' }) });
          openAdminModal();
        });
        const closed = document.createElement('button');
        closed.className = 'danger-btn small';
        closed.textContent = 'closed';
        closed.addEventListener('click', async () => {
          await api(`/api/admin/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) });
          openAdminModal();
        });
        note.append(reviewed, closed);
        body.appendChild(note);
      }
    } catch (error) {
      body.textContent = error.message;
    }
  });
}

function openEmojiPicker() {
  const emojis = ['👍', '❤️', '😂', '🔥', '👏', '😮', '😎', '🙏', '🚀', '✨', '✅', '👀', '🎉', '💬', '📌', '⭐'];
  openModal('Эмодзи', '');
  const wrap = document.createElement('div');
  wrap.className = 'emoji-grid';
  emojis.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-choice';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const start = els.messageInput.selectionStart || els.messageInput.value.length;
      const end = els.messageInput.selectionEnd || els.messageInput.value.length;
      els.messageInput.value = `${els.messageInput.value.slice(0, start)}${emoji}${els.messageInput.value.slice(end)}`;
      els.messageInput.focus();
      els.messageInput.selectionStart = els.messageInput.selectionEnd = start + emoji.length;
      saveDraft();
      closeModal();
    });
    wrap.appendChild(btn);
  });
  els.modalBody.appendChild(wrap);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bindEvents() {
  els.loginTab.addEventListener('click', () => setAuthMode('login'));
  els.registerTab.addEventListener('click', () => setAuthMode('register'));
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const fd = new FormData(els.loginForm);
    const btn = e.submitter || els.loginForm.querySelector('button[type="submit"]');
    try {
      await withButtonLoading(btn, 'Входим...', async () => {
        setFormBusy(els.loginForm, true);
        await login(fd.get('username'), fd.get('password'));
      });
    } catch (error) {
      showAuthError(error.message);
    } finally {
      setFormBusy(els.loginForm, false);
    }
  });
  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const fd = new FormData(els.registerForm);
    const btn = e.submitter || els.registerForm.querySelector('button[type="submit"]');
    try {
      await withButtonLoading(btn, 'Создаём аккаунт...', async () => {
        setFormBusy(els.registerForm, true);
        await register(fd.get('displayName'), fd.get('username'), fd.get('email'), fd.get('password'));
      });
    } catch (error) {
      showAuthError(error.message);
    } finally {
      setFormBusy(els.registerForm, false);
    }
  });
  els.forgotPasswordBtn?.addEventListener('click', async () => {
    clearAuthError();
    const login = prompt('Введите логин или email для восстановления пароля');
    if (!login) return;
    try {
      await withButtonLoading(els.forgotPasswordBtn, 'Отправляем ссылку...', () => requestPasswordReset(login));
    } catch (error) {
      showAuthError(error.message);
    }
  });

  els.messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.messageInput.value;
    if (!text.trim()) return;
    const sendBtn = e.submitter || els.messageForm.querySelector('.send');
    els.messageInput.value = '';
    els.messageForm.classList.add('is-sending');
    try {
      await withButtonLoading(sendBtn, '', () => sendTextMessage(text));
    } catch (error) {
      els.messageInput.value = text;
      toast(error.message);
    } finally {
      els.messageForm.classList.remove('is-sending');
    }
  });
  els.messageInput.addEventListener('input', () => { notifyTyping(); saveDraft(); });
  els.emojiBtn?.addEventListener('click', openEmojiPicker);
  els.cancelReply.addEventListener('click', clearReply);
  els.backToChats.addEventListener('click', () => {
    els.appShell.dataset.mobileView = 'list';
    markPageTransition(els.appShell);
  });
  els.chatSearch.addEventListener('input', renderChats);
  els.searchMessagesBtn?.addEventListener('click', openSearchMessagesModal);
  els.newChatBtn?.addEventListener('click', openNewChatModal);
  els.createGroupBtn?.addEventListener('click', openCreateGroupModal);
  els.createChannelBtn?.addEventListener('click', openCreateChannelModal);
  els.publicChannelsBtn?.addEventListener('click', openPublicChannelsModal);
  els.savedBtn?.addEventListener('click', openSavedMessagesModal);
  els.themeBtn?.addEventListener('click', toggleTheme);
  els.audioCallBtn?.addEventListener('click', () => startDirectCall('audio'));
  els.videoCallBtn?.addEventListener('click', () => startDirectCall('video'));
  els.acceptCallBtn.addEventListener('click', acceptIncomingCall);
  els.rejectCallBtn.addEventListener('click', () => state.call.incoming ? rejectIncomingCall() : endCall(true));
  els.endCallBtn.addEventListener('click', () => endCall(true));
  els.muteCallBtn.addEventListener('click', toggleCallMute);
  els.cameraCallBtn.addEventListener('click', toggleCallCamera);
  els.screenCallBtn.addEventListener('click', shareScreen);
  els.editProfileBtn?.addEventListener('click', openProfileModal);
  els.profileBtn?.addEventListener('click', openChatInfoModal);
  els.adminBtn?.addEventListener('click', openAdminModal);
  els.logoutBtn.addEventListener('click', async () => {
    await withButtonLoading(els.logoutBtn, '', async () => {
      showTopProgress('Выходим из аккаунта...');
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      localStorage.removeItem('bubble_access_token');
      state.token = '';
      state.user = null;
      state.socket?.disconnect();
      showAuth();
      hideTopProgress();
    });
  });
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
  els.voiceBtn.addEventListener('click', () => withButtonLoading(els.voiceBtn, '', () => startRecording('audio')));
  els.videoBtn.addEventListener('click', () => withButtonLoading(els.videoBtn, '', () => startRecording('video')));
  els.stopRecord.addEventListener('click', () => stopRecording(false));
  els.cancelRecord.addEventListener('click', () => stopRecording(true));
  els.closeRecord.addEventListener('click', () => stopRecording(true));
  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files[0];
    if (!file) return;
    const kind = file.type.startsWith('image/') ? 'image' : 'file';
    try { await withButtonLoading(els.attachBtn, '', () => uploadAndSendMedia(file, kind)); }
    catch (error) { toast(error.message); }
    finally { els.fileInput.value = ''; }
  });
}

async function bootstrap() {
  applyTheme();
  bindEvents();
  handleAuthLinksFromUrl();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
  if (!state.token) {
    const ok = await refreshToken();
    if (!ok) return showAuth();
  }
  showGlobalLoader('Восстанавливаем сессию...');
  try {
    const data = await api('/api/me');
    state.user = data.user;
    await afterAuth();
    await joinInviteFromUrl();
  } catch (_) {
    hideGlobalLoader();
    showAuth();
  }
}

bootstrap();
