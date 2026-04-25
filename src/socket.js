const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('./config');
const { query } = require('./db');
const { getUserById } = require('./auth');

let io = null;
const onlineUsers = new Map(); // userId -> { sockets: Set(socketId), showOnline: boolean }

function emitToChat(chatId, event, payload) {
  if (!io) return;
  io.to(`chat:${chatId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitPresence(userId, online) {
  if (!io) return;
  io.emit('presence:update', { userId: Number(userId), online, at: new Date().toISOString() });
}

async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token || extractCookieToken(socket.handshake.headers.cookie || '', 'accessToken');
    if (!token) return next(new Error('auth_required'));
    const payload = jwt.verify(token, config.jwtAccessSecret);
    const user = await getUserById(payload.sub);
    if (!user || user.isBanned) return next(new Error('invalid_user'));
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('invalid_token'));
  }
}

function extractCookieToken(cookieHeader, name) {
  const part = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  if (!part) return null;
  return decodeURIComponent(part.slice(name.length + 1));
}

async function attachRedisAdapter(socketServer) {
  if (!config.redisUrl) return;
  try {
    const pubClient = createClient({ url: config.redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    socketServer.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter enabled');
  } catch (error) {
    console.warn('Redis adapter disabled:', error.message);
  }
}

async function joinUserChats(socket) {
  const result = await query('SELECT chat_id FROM chat_members WHERE user_id = $1', [socket.user.id]);
  for (const row of result.rows) {
    socket.join(`chat:${row.chat_id}`);
  }
}

function addOnline(user, socketId) {
  const key = String(user.id);
  const wasOffline = !onlineUsers.has(key) || onlineUsers.get(key).sockets.size === 0;
  if (!onlineUsers.has(key)) onlineUsers.set(key, { sockets: new Set(), showOnline: user.showOnline !== false });
  const entry = onlineUsers.get(key);
  entry.sockets.add(socketId);
  entry.showOnline = user.showOnline !== false;
  if (wasOffline && entry.showOnline) emitPresence(user.id, true);
}

async function removeOnline(userId, socketId) {
  const key = String(userId);
  const entry = onlineUsers.get(key);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    const shouldEmit = entry.showOnline;
    onlineUsers.delete(key);
    await query('UPDATE users SET last_seen = now() WHERE id = $1', [userId]).catch(() => {});
    if (shouldEmit) emitPresence(userId, false);
  }
}

function getOnlineIds() {
  return [...onlineUsers.entries()].filter(([, entry]) => entry.showOnline).map(([id]) => Number(id));
}

function attachSockets(server, services) {
  io = new Server(server, {
    cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true },
    maxHttpBufferSize: config.maxUploadMb * 1024 * 1024
  });

  attachRedisAdapter(io);
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    try {
      socket.join(`user:${socket.user.id}`);
      await joinUserChats(socket);
      addOnline(socket.user, socket.id);
      socket.emit('presence:snapshot', { onlineUserIds: getOnlineIds() });
      await query('UPDATE users SET last_seen = now() WHERE id = $1', [socket.user.id]);

      socket.on('chat:join', async ({ chatId } = {}, ack) => {
        try {
          const member = await services.isChatMember(chatId, socket.user.id);
          if (!member) throw new Error('chat_access_denied');
          socket.join(`chat:${chatId}`);
          ack?.({ ok: true });
        } catch (error) { ack?.({ ok: false, error: error.message }); }
      });

      socket.on('typing:start', async ({ chatId } = {}) => {
        const member = await services.isChatMember(chatId, socket.user.id);
        if (!member) return;
        socket.to(`chat:${chatId}`).emit('typing:update', {
          chatId: Number(chatId),
          userId: socket.user.id,
          displayName: socket.user.displayName,
          typing: true
        });
      });

      socket.on('typing:stop', async ({ chatId } = {}) => {
        const member = await services.isChatMember(chatId, socket.user.id);
        if (!member) return;
        socket.to(`chat:${chatId}`).emit('typing:update', {
          chatId: Number(chatId),
          userId: socket.user.id,
          displayName: socket.user.displayName,
          typing: false
        });
      });

      socket.on('chat:send', async (payload = {}, ack) => {
        try {
          const chatId = Number(payload.chatId);
          const member = await services.isChatMember(chatId, socket.user.id);
          if (!member) throw new Error('chat_access_denied');
          const meta = await query(
            `SELECT type FROM chats WHERE id = $1`,
            [chatId]
          );
          if (meta.rows[0]?.type === 'channel' && !['owner', 'admin'].includes(member.role)) {
            throw new Error('channel_admin_required');
          }
          const body = typeof payload.body === 'string' ? payload.body : '';
          if (!body.trim()) throw new Error('empty_message');
          const msg = await services.insertMessage({
            chatId,
            senderId: socket.user.id,
            body,
            type: 'text',
            replyToId: payload.replyToId || null
          });
          emitToChat(chatId, 'message:new', msg);
          ack?.({ ok: true, message: msg });
        } catch (error) { ack?.({ ok: false, error: error.message }); }
      });

      socket.on('chat:read', async ({ chatId, messageId } = {}, ack) => {
        try {
          const member = await services.isChatMember(chatId, socket.user.id);
          if (!member) throw new Error('chat_access_denied');
          await query(
            `UPDATE chat_members
             SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3)
             WHERE chat_id = $1 AND user_id = $2`,
            [chatId, socket.user.id, messageId]
          );
          emitToChat(chatId, 'chat:read', { chatId: Number(chatId), userId: socket.user.id, messageId: Number(messageId) });
          ack?.({ ok: true });
        } catch (error) { ack?.({ ok: false, error: error.message }); }
      });

      async function canSignalCall(chatId, targetUserId) {
        const result = await query(
          `SELECT c.id
           FROM chats c
           JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $2
           JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $3
           WHERE c.id = $1
           LIMIT 1`,
          [chatId, socket.user.id, targetUserId]
        );
        return result.rowCount > 0;
      }

      socket.on('call:offer', async (payload = {}, ack) => {
        try {
          const chatId = Number(payload.chatId);
          const targetUserId = Number(payload.targetUserId);
          if (!chatId || !targetUserId) throw new Error('invalid_call_target');
          if (!(await canSignalCall(chatId, targetUserId))) throw new Error('call_access_denied');
          const history = await query(
            `INSERT INTO call_history (chat_id, caller_id, callee_id, kind, status)
             VALUES ($1, $2, $3, $4, 'started')
             RETURNING id`,
            [chatId, socket.user.id, targetUserId, payload.kind === 'video' ? 'video' : 'audio']
          );
          emitToUser(targetUserId, 'call:offer', {
            callId: Number(history.rows[0].id),
            chatId,
            fromUser: { id: socket.user.id, username: socket.user.username, displayName: socket.user.displayName, avatarUrl: socket.user.avatarUrl },
            kind: payload.kind === 'video' ? 'video' : 'audio',
            offer: payload.offer
          });
          ack?.({ ok: true, callId: Number(history.rows[0].id) });
        } catch (error) { ack?.({ ok: false, error: error.message }); }
      });

      socket.on('call:answer', async (payload = {}, ack) => {
        try {
          const targetUserId = Number(payload.targetUserId);
          if (!targetUserId) throw new Error('invalid_call_target');
          if (payload.callId) await query(`UPDATE call_history SET status = 'answered' WHERE id = $1`, [Number(payload.callId)]).catch(() => {});
          emitToUser(targetUserId, 'call:answer', { callId: payload.callId, fromUserId: socket.user.id, answer: payload.answer });
          ack?.({ ok: true });
        } catch (error) { ack?.({ ok: false, error: error.message }); }
      });

      socket.on('call:ice', (payload = {}, ack) => {
        const targetUserId = Number(payload.targetUserId);
        if (!targetUserId) return ack?.({ ok: false, error: 'invalid_call_target' });
        emitToUser(targetUserId, 'call:ice', { callId: payload.callId, fromUserId: socket.user.id, candidate: payload.candidate });
        ack?.({ ok: true });
      });

      socket.on('call:end', async (payload = {}, ack) => {
        const targetUserId = Number(payload.targetUserId);
        if (payload.callId) await query(`UPDATE call_history SET status = 'ended', ended_at = now() WHERE id = $1`, [Number(payload.callId)]).catch(() => {});
        if (targetUserId) emitToUser(targetUserId, 'call:end', { callId: payload.callId, fromUserId: socket.user.id });
        ack?.({ ok: true });
      });

      socket.on('call:reject', async (payload = {}, ack) => {
        const targetUserId = Number(payload.targetUserId);
        if (payload.callId) await query(`UPDATE call_history SET status = 'rejected', ended_at = now() WHERE id = $1`, [Number(payload.callId)]).catch(() => {});
        if (targetUserId) emitToUser(targetUserId, 'call:reject', { callId: payload.callId, fromUserId: socket.user.id });
        ack?.({ ok: true });
      });

      socket.on('disconnect', () => {
        removeOnline(socket.user.id, socket.id).catch(() => {});
      });
    } catch (error) {
      console.error('socket connection error', error);
      socket.disconnect(true);
    }
  });

  return io;
}

module.exports = { attachSockets, emitToChat, emitToUser, getOnlineIds };
