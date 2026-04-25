const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const mime = require('mime-types');
const { z } = require('zod');
const { nanoid } = require('nanoid');
const config = require('./config');
const { query, withClient, migrate } = require('./db');
const { authRoutes, requireAuth, requireAdmin, normalizeUser, publicUserFields } = require('./auth');
const { attachSockets, emitToChat, emitToUser } = require('./socket');
const { saveUploadedFile, sendStoredFile } = require('./storage');

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      "connect-src": ["'self'", "ws:", "wss:"],
      "img-src": ["'self'", "data:", "blob:"],
      "media-src": ["'self'", "blob:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", "data:"]
    }
  }
}));
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));

app.use(rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false
}));

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: config.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_auth_attempts' }
});

const api = express.Router();
api.use('/auth/login', authLimiter);
api.use('/auth/register', authLimiter);
authRoutes(api);

function cleanText(value, max = 5000) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function publicMessage(row, reactions = []) {
  if (!row) return null;
  return {
    id: Number(row.id),
    chatId: Number(row.chat_id),
    senderId: row.sender_id ? Number(row.sender_id) : null,
    sender: row.sender_id ? {
      id: Number(row.sender_id),
      username: row.sender_username,
      displayName: row.sender_display_name,
      avatarUrl: row.sender_avatar_url
    } : null,
    body: row.deleted_at ? '' : row.body,
    type: row.deleted_at ? 'system' : row.type,
    replyToId: row.reply_to_id ? Number(row.reply_to_id) : null,
    media: row.media_id && !row.deleted_at ? {
      id: row.media_id,
      kind: row.media_kind,
      mimeType: row.media_mime_type,
      sizeBytes: Number(row.media_size_bytes || 0),
      originalName: row.media_original_name,
      durationSec: row.media_duration_sec,
      url: `/api/media/${row.media_id}`
    } : null,
    reactions,
    isEdited: Boolean(row.edited_at),
    isDeleted: Boolean(row.deleted_at),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at
  };
}

const messageSelect = `
  m.id, m.chat_id, m.sender_id, m.body, m.type, m.reply_to_id, m.media_id, m.edited_at, m.deleted_at, m.created_at,
  u.username AS sender_username, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url,
  mf.kind AS media_kind, mf.mime_type AS media_mime_type, mf.size_bytes AS media_size_bytes,
  mf.original_name AS media_original_name, mf.duration_sec AS media_duration_sec
`;

async function isChatMember(chatId, userId) {
  const result = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  return result.rows[0] || null;
}

async function requireChatMember(req, res, next) {
  const chatId = toNumber(req.params.chatId || req.body.chatId);
  if (!chatId) return res.status(400).json({ error: 'invalid_chat_id' });
  const member = await isChatMember(chatId, req.user.id);
  if (!member) return res.status(403).json({ error: 'chat_access_denied' });
  req.chatId = chatId;
  req.memberRole = member.role;
  next();
}

async function getChatMeta(chatId) {
  const result = await query('SELECT id, type, title, owner_id, is_public, description FROM chats WHERE id = $1', [chatId]);
  return result.rows[0] || null;
}

async function canSendToChat(chatId, userId) {
  const result = await query(
    `SELECT c.type, cm.role
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2
     WHERE c.id = $1`,
    [chatId, userId]
  );
  const row = result.rows[0];
  if (!row) return false;
  if (row.type === 'channel') return ['owner', 'admin'].includes(row.role);
  return true;
}

function extractMentions(body) {
  const names = new Set();
  for (const match of String(body || '').matchAll(/@([a-zA-Z0-9_]{2,32})/g)) names.add(match[1].toLowerCase());
  return [...names];
}

async function saveMentions(messageId, chatId, body) {
  const names = extractMentions(body);
  if (!names.length) return [];
  const result = await query(
    `SELECT u.id, u.username, u.display_name
     FROM users u
     JOIN chat_members cm ON cm.user_id = u.id AND cm.chat_id = $2
     WHERE lower(u.username) = ANY($1::text[])`,
    [names, chatId]
  );
  for (const user of result.rows) {
    await query(
      `INSERT INTO message_mentions (message_id, mentioned_user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [messageId, user.id]
    );
  }
  return result.rows.map(row => Number(row.id));
}

async function loadReactionsForMessages(messageIds, userId) {
  if (!messageIds.length) return new Map();
  const result = await query(
    `SELECT message_id, emoji, count(*)::int AS count,
            bool_or(user_id = $2) AS mine
     FROM message_reactions
     WHERE message_id = ANY($1::bigint[])
     GROUP BY message_id, emoji
     ORDER BY message_id, emoji`,
    [messageIds, userId || 0]
  );
  const map = new Map();
  for (const row of result.rows) {
    const id = String(row.message_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({ emoji: row.emoji, count: row.count, mine: row.mine });
  }
  return map;
}

async function listMessages(chatId, userId, before = null, limit = 40) {
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const params = [chatId, safeLimit];
  let beforeSql = '';
  if (before) {
    params.push(before);
    beforeSql = `AND m.id < $3`;
  }
  const result = await query(
    `SELECT ${messageSelect}
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.chat_id = $1 ${beforeSql}
     ORDER BY m.id DESC
     LIMIT $2`,
    params
  );
  const rows = result.rows.reverse();
  const ids = rows.map(r => Number(r.id));
  const reactionMap = await loadReactionsForMessages(ids, userId);
  return rows.map(row => publicMessage(row, reactionMap.get(String(row.id)) || []));
}

async function getMessage(messageId, userId) {
  const result = await query(
    `SELECT ${messageSelect}
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN media_files mf ON mf.id = m.media_id
     JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
     WHERE m.id = $1`,
    [messageId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const map = await loadReactionsForMessages([Number(row.id)], userId);
  return publicMessage(row, map.get(String(row.id)) || []);
}

async function insertMessage({ chatId, senderId, body = '', type = 'text', replyToId = null, mediaId = null }) {
  const cleanBody = cleanText(body, 5000);
  const result = await query(
    `INSERT INTO messages (chat_id, sender_id, body, type, reply_to_id, media_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [chatId, senderId, cleanBody, type, replyToId || null, mediaId || null]
  );
  const messageId = result.rows[0].id;
  if (type !== 'system') await saveMentions(messageId, chatId, cleanBody);
  const msg = await getMessage(messageId, senderId);
  await query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
  return msg;
}

api.get('/webrtc/ice-servers', requireAuth, (req, res) => {
  const iceServers = [];
  if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
  if (config.turnUrls.length && config.turnUsername && config.turnCredential) {
    iceServers.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
  }
  res.json({ iceServers });
});

api.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, app: config.appName, time: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'database_unavailable' });
  }
});

api.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

api.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      displayName: z.string().min(2).max(64).optional(),
      statusText: z.string().max(120).optional(),
      avatarUrl: z.string().max(500).optional().nullable(),
      allowDirectMessages: z.boolean().optional(),
      showOnline: z.boolean().optional()
    });
    const input = schema.parse(req.body);
    const result = await query(
      `UPDATE users
       SET display_name = COALESCE($2, display_name),
           status_text = COALESCE($3, status_text),
           avatar_url = COALESCE($4, avatar_url),
           allow_direct_messages = COALESCE($5, allow_direct_messages),
           show_online = COALESCE($6, show_online),
           updated_at = now()
       WHERE id = $1
       RETURNING ${publicUserFields}`,
      [req.user.id, input.displayName, input.statusText, input.avatarUrl, input.allowDirectMessages, input.showOnline]
    );
    const user = normalizeUser(result.rows[0]);
    emitToUser(req.user.id, 'user:updated', user);
    res.json({ user });
  } catch (error) { next(error); }
});

api.get('/users/search', requireAuth, async (req, res, next) => {
  try {
    const q = cleanText(req.query.q || '', 64);
    if (q.length < 1) return res.json({ users: [] });
    const result = await query(
      `SELECT ${publicUserFields}
       FROM users
       WHERE id <> $1 AND is_banned = false
         AND (username ILIKE $2 OR display_name ILIKE $2)
       ORDER BY display_name ASC
       LIMIT 20`,
      [req.user.id, `%${q}%`]
    );
    res.json({ users: result.rows.map(normalizeUser) });
  } catch (error) { next(error); }
});

api.get('/chats', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `WITH last_messages AS (
         SELECT DISTINCT ON (m.chat_id) m.*
         FROM messages m
         ORDER BY m.chat_id, m.id DESC
       ), unread AS (
         SELECT cm.chat_id,
                count(m.id)::int AS unread_count
         FROM chat_members cm
         LEFT JOIN messages m ON m.chat_id = cm.chat_id
          AND m.sender_id <> cm.user_id
          AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)
         WHERE cm.user_id = $1
         GROUP BY cm.chat_id
       )
       SELECT c.id, c.type, c.title, c.avatar_url, c.owner_id, c.is_public, c.description, c.created_at, c.updated_at,
              cm.role AS my_role, cm.last_read_message_id,
              COALESCE(unread.unread_count, 0) AS unread_count,
              lm.id AS last_message_id, lm.body AS last_message_body, lm.type AS last_message_type, lm.created_at AS last_message_at,
              CASE WHEN c.type = 'direct' THEN other.id ELSE NULL END AS other_id,
              CASE WHEN c.type = 'direct' THEN other.username ELSE NULL END AS other_username,
              CASE WHEN c.type = 'direct' THEN other.display_name ELSE NULL END AS other_display_name,
              CASE WHEN c.type = 'direct' THEN other.avatar_url ELSE NULL END AS other_avatar_url,
              CASE WHEN c.type = 'direct' THEN other.status_text ELSE NULL END AS other_status_text,
              CASE WHEN c.type = 'direct' THEN other.allow_direct_messages ELSE NULL END AS other_allow_direct_messages,
              CASE WHEN c.type = 'direct' THEN other.show_online ELSE NULL END AS other_show_online,
              CASE WHEN c.type = 'direct' AND other.show_online = true THEN other.last_seen ELSE NULL END AS other_last_seen
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
       LEFT JOIN unread ON unread.chat_id = c.id
       LEFT JOIN last_messages lm ON lm.chat_id = c.id
       LEFT JOIN chat_members other_cm ON other_cm.chat_id = c.id AND other_cm.user_id <> $1 AND c.type = 'direct'
       LEFT JOIN users other ON other.id = other_cm.user_id
       ORDER BY COALESCE(lm.created_at, c.updated_at, c.created_at) DESC`,
      [req.user.id]
    );
    const chats = result.rows.map(row => ({
      id: Number(row.id),
      type: row.type,
      title: row.type === 'direct' ? row.other_display_name : row.title,
      avatarUrl: row.type === 'direct' ? row.other_avatar_url : row.avatar_url,
      isPublic: Boolean(row.is_public),
      description: row.description || '',
      myRole: row.my_role,
      unreadCount: row.unread_count,
      otherUser: row.other_id ? {
        id: Number(row.other_id),
        username: row.other_username,
        displayName: row.other_display_name,
        avatarUrl: row.other_avatar_url,
        statusText: row.other_status_text,
        allowDirectMessages: row.other_allow_direct_messages !== false,
        showOnline: row.other_show_online !== false,
        lastSeen: row.other_last_seen
      } : null,
      lastMessage: row.last_message_id ? {
        id: Number(row.last_message_id),
        body: row.last_message_body,
        type: row.last_message_type,
        createdAt: row.last_message_at
      } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    res.json({ chats });
  } catch (error) { next(error); }
});

api.post('/chats/direct', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ userId: z.coerce.number().int().positive() });
    const { userId } = schema.parse(req.body);
    if (userId === req.user.id) return res.status(400).json({ error: 'cannot_chat_with_self' });
    const other = await query('SELECT id, allow_direct_messages FROM users WHERE id = $1 AND is_banned = false', [userId]);
    if (other.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    if (other.rows[0].allow_direct_messages === false && !['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'direct_messages_disabled' });
    }
    const blocked = await query(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [req.user.id, userId]
    );
    if (blocked.rowCount > 0) return res.status(403).json({ error: 'user_blocked' });

    const chat = await withClient(async (client) => {
      const existing = await client.query(
        `SELECT c.id
         FROM chats c
         JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1
         JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2
         WHERE c.type = 'direct'
         LIMIT 1`,
        [req.user.id, userId]
      );
      if (existing.rowCount > 0) return existing.rows[0].id;
      const inserted = await client.query(
        `INSERT INTO chats (type, owner_id) VALUES ('direct', $1) RETURNING id`,
        [req.user.id]
      );
      const chatId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
        [chatId, req.user.id, userId]
      );
      return chatId;
    });
    res.status(201).json({ chatId: Number(chat) });
  } catch (error) { next(error); }
});

api.post('/chats/group', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().min(2).max(80),
      memberIds: z.array(z.coerce.number().int().positive()).max(100).default([])
    });
    const input = schema.parse(req.body);
    const uniqueIds = [...new Set([req.user.id, ...input.memberIds.filter(id => id !== req.user.id)])];
    const chatId = await withClient(async (client) => {
      const inserted = await client.query(
        `INSERT INTO chats (type, title, owner_id) VALUES ('group', $1, $2) RETURNING id`,
        [cleanText(input.title, 80), req.user.id]
      );
      const id = inserted.rows[0].id;
      for (const userId of uniqueIds) {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [id, userId, userId === req.user.id ? 'owner' : 'member']
        );
      }
      return id;
    });
    const systemMsg = await insertMessage({ chatId, senderId: req.user.id, type: 'system', body: `${req.user.displayName} создал(а) группу` });
    emitToChat(chatId, 'message:new', systemMsg);
    res.status(201).json({ chatId: Number(chatId) });
  } catch (error) { next(error); }
});


api.post('/channels', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      title: z.string().min(2).max(80),
      description: z.string().max(300).default(''),
      isPublic: z.boolean().default(false)
    });
    const input = schema.parse(req.body);
    const chatId = await withClient(async (client) => {
      const inserted = await client.query(
        `INSERT INTO chats (type, title, owner_id, is_public, description)
         VALUES ('channel', $1, $2, $3, $4)
         RETURNING id`,
        [cleanText(input.title, 80), req.user.id, input.isPublic, cleanText(input.description, 300)]
      );
      const id = inserted.rows[0].id;
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [id, req.user.id]
      );
      return id;
    });
    const msg = await insertMessage({ chatId, senderId: req.user.id, type: 'system', body: `${req.user.displayName} создал(а) канал` });
    emitToChat(chatId, 'message:new', msg);
    res.status(201).json({ chatId: Number(chatId) });
  } catch (error) { next(error); }
});

api.get('/channels/public', requireAuth, async (req, res, next) => {
  try {
    const q = cleanText(req.query.q || '', 80);
    const result = await query(
      `SELECT c.id, c.title, c.avatar_url, c.description, c.updated_at,
              count(cm.user_id)::int AS member_count,
              bool_or(cm.user_id = $1) AS joined
       FROM chats c
       LEFT JOIN chat_members cm ON cm.chat_id = c.id
       WHERE c.type = 'channel' AND c.is_public = true
         AND ($2 = '' OR c.title ILIKE '%' || $2 || '%' OR c.description ILIKE '%' || $2 || '%')
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT 50`,
      [req.user.id, q]
    );
    res.json({ channels: result.rows.map(row => ({
      id: Number(row.id),
      title: row.title,
      avatarUrl: row.avatar_url,
      description: row.description || '',
      memberCount: Number(row.member_count || 0),
      joined: Boolean(row.joined),
      updatedAt: row.updated_at
    })) });
  } catch (error) { next(error); }
});

api.post('/channels/:chatId/join', requireAuth, async (req, res, next) => {
  try {
    const chatId = toNumber(req.params.chatId);
    const chat = await query(`SELECT id, type, is_public, title FROM chats WHERE id = $1`, [chatId]);
    if (chat.rowCount === 0 || chat.rows[0].type !== 'channel') return res.status(404).json({ error: 'channel_not_found' });
    if (!chat.rows[0].is_public) return res.status(403).json({ error: 'invite_required' });
    await query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [chatId, req.user.id]
    );
    emitToUser(req.user.id, 'chat:added', { chatId });
    res.status(201).json({ chatId });
  } catch (error) { next(error); }
});

api.get('/saved/messages', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${messageSelect}, s.created_at AS saved_at
       FROM saved_messages s
       JOIN messages m ON m.id = s.message_id
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $1
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN media_files mf ON mf.id = m.media_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    const ids = result.rows.map(r => Number(r.id));
    const reactionMap = await loadReactionsForMessages(ids, req.user.id);
    res.json({ messages: result.rows.map(row => ({
      ...publicMessage(row, reactionMap.get(String(row.id)) || []),
      savedAt: row.saved_at
    })) });
  } catch (error) { next(error); }
});

api.post('/messages/:messageId/save', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.messageId);
    const msg = await getMessage(id, req.user.id);
    if (!msg) return res.status(404).json({ error: 'message_not_found' });
    await query(
      `INSERT INTO saved_messages (user_id, message_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, id]
    );
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

api.delete('/messages/:messageId/save', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.messageId);
    await query('DELETE FROM saved_messages WHERE user_id = $1 AND message_id = $2', [req.user.id, id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/pins', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const schema = z.object({ messageId: z.coerce.number().int().positive() });
    const { messageId } = schema.parse(req.body);
    const found = await query('SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL', [messageId, req.chatId]);
    if (found.rowCount === 0) return res.status(404).json({ error: 'message_not_found' });
    await query(
      `INSERT INTO pinned_messages (chat_id, message_id, pinned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [req.chatId, messageId, req.user.id]
    );
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

api.delete('/chats/:chatId/pins/:messageId', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const messageId = toNumber(req.params.messageId);
    await query('DELETE FROM pinned_messages WHERE chat_id = $1 AND message_id = $2', [req.chatId, messageId]);
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/invites', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const schema = z.object({
      maxUses: z.coerce.number().int().min(1).max(10000).optional().nullable(),
      expiresInHours: z.coerce.number().int().min(1).max(24 * 365).optional().nullable()
    });
    const input = schema.parse(req.body);
    const token = nanoid(22);
    const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null;
    const result = await query(
      `INSERT INTO invite_links (chat_id, token, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, token, max_uses, used_count, expires_at, created_at`,
      [req.chatId, token, req.user.id, input.maxUses || null, expiresAt]
    );
    const row = result.rows[0];
    res.status(201).json({ invite: {
      id: Number(row.id), token: row.token, url: `/invite/${row.token}`,
      maxUses: row.max_uses, usedCount: Number(row.used_count || 0), expiresAt: row.expires_at, createdAt: row.created_at
    } });
  } catch (error) { next(error); }
});

api.delete('/chats/:chatId/invites/:inviteId', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    await query('UPDATE invite_links SET revoked_at = now() WHERE id = $1 AND chat_id = $2', [toNumber(req.params.inviteId), req.chatId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.post('/invites/:token/join', requireAuth, async (req, res, next) => {
  try {
    const token = cleanText(req.params.token, 64);
    const invite = await query(
      `SELECT il.*, c.title
       FROM invite_links il
       JOIN chats c ON c.id = il.chat_id
       WHERE il.token = $1
         AND il.revoked_at IS NULL
         AND (il.expires_at IS NULL OR il.expires_at > now())
         AND (il.max_uses IS NULL OR il.used_count < il.max_uses)
       LIMIT 1`,
      [token]
    );
    if (invite.rowCount === 0) return res.status(404).json({ error: 'invite_not_found_or_expired' });
    const row = invite.rows[0];
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [row.chat_id, req.user.id]
      );
      await client.query('UPDATE invite_links SET used_count = used_count + 1 WHERE id = $1', [row.id]);
    });
    emitToUser(req.user.id, 'chat:added', { chatId: Number(row.chat_id) });
    res.status(201).json({ chatId: Number(row.chat_id), title: row.title });
  } catch (error) { next(error); }
});


api.get('/chats/:chatId/details', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    const chatResult = await query(
      `SELECT c.id, c.type, c.title, c.avatar_url, c.owner_id, c.is_public, c.description, c.created_at, c.updated_at,
              cm.role AS my_role
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2
       WHERE c.id = $1`,
      [req.chatId, req.user.id]
    );
    if (chatResult.rowCount === 0) return res.status(404).json({ error: 'chat_not_found' });
    const membersResult = await query(
      `SELECT cm.user_id, cm.role, cm.last_read_message_id, cm.muted, cm.joined_at,
              u.username, u.display_name, u.avatar_url, u.status_text, u.show_online,
              CASE WHEN u.show_online = true THEN u.last_seen ELSE NULL END AS last_seen
       FROM chat_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = $1
       ORDER BY CASE cm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.display_name ASC`,
      [req.chatId]
    );
    const pinsResult = await query(
      `SELECT ${messageSelect}, p.created_at AS pinned_at, p.pinned_by
       FROM pinned_messages p
       JOIN messages m ON m.id = p.message_id
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN media_files mf ON mf.id = m.media_id
       WHERE p.chat_id = $1
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [req.chatId]
    );
    const pinIds = pinsResult.rows.map(r => Number(r.id));
    const pinReactions = await loadReactionsForMessages(pinIds, req.user.id);
    const inviteResult = ['owner', 'admin'].includes(chatResult.rows[0].my_role)
      ? await query(
          `SELECT id, token, max_uses, used_count, expires_at, revoked_at, created_at
           FROM invite_links
           WHERE chat_id = $1
           ORDER BY created_at DESC
           LIMIT 8`,
          [req.chatId]
        )
      : { rows: [] };

    res.json({
      chat: {
        id: Number(chatResult.rows[0].id),
        type: chatResult.rows[0].type,
        title: chatResult.rows[0].title,
        avatarUrl: chatResult.rows[0].avatar_url,
        isPublic: Boolean(chatResult.rows[0].is_public),
        description: chatResult.rows[0].description || '',
        ownerId: chatResult.rows[0].owner_id ? Number(chatResult.rows[0].owner_id) : null,
        myRole: chatResult.rows[0].my_role,
        createdAt: chatResult.rows[0].created_at,
        updatedAt: chatResult.rows[0].updated_at
      },
      pinnedMessages: pinsResult.rows.map(row => ({
        ...publicMessage(row, pinReactions.get(String(row.id)) || []),
        pinnedAt: row.pinned_at,
        pinnedBy: row.pinned_by ? Number(row.pinned_by) : null
      })),
      invites: inviteResult.rows.map(row => ({
        id: Number(row.id),
        token: row.token,
        url: `/invite/${row.token}`,
        maxUses: row.max_uses,
        usedCount: Number(row.used_count || 0),
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at
      })),
      members: membersResult.rows.map(row => ({
        userId: Number(row.user_id),
        role: row.role,
        muted: Boolean(row.muted),
        lastReadMessageId: row.last_read_message_id ? Number(row.last_read_message_id) : 0,
        joinedAt: row.joined_at,
        user: {
          id: Number(row.user_id),
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          statusText: row.status_text || '',
          showOnline: row.show_online !== false,
          lastSeen: row.last_seen
        }
      }))
    });
  } catch (error) { next(error); }
});

api.patch('/chats/:chatId', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const schema = z.object({
      title: z.string().min(2).max(80).optional(),
      avatarUrl: z.string().max(500).optional().nullable()
    });
    const input = schema.parse(req.body);
    const result = await query(
      `UPDATE chats
       SET title = COALESCE($2, title),
           avatar_url = COALESCE($3, avatar_url),
           updated_at = now()
       WHERE id = $1 AND type = 'group'
       RETURNING id, type, title, avatar_url, updated_at`,
      [req.chatId, input.title ? cleanText(input.title, 80) : undefined, input.avatarUrl]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'group_not_found' });
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    res.json({ chat: result.rows[0] });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/members', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const schema = z.object({ userId: z.coerce.number().int().positive() });
    const { userId } = schema.parse(req.body);
    const user = await query('SELECT id, display_name FROM users WHERE id = $1 AND is_banned = false', [userId]);
    if (user.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    await query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [req.chatId, userId]
    );
    const msg = await insertMessage({ chatId: req.chatId, senderId: req.user.id, type: 'system', body: `${req.user.displayName} добавил(а) ${user.rows[0].display_name}` });
    emitToChat(req.chatId, 'message:new', msg);
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    emitToUser(userId, 'chat:added', { chatId: req.chatId });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

api.patch('/chats/:chatId/members/:userId', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (req.memberRole !== 'owner') return res.status(403).json({ error: 'owner_required' });
    const schema = z.object({ role: z.enum(['admin', 'member']) });
    const { role } = schema.parse(req.body);
    const userId = toNumber(req.params.userId);
    if (userId === req.user.id) return res.status(400).json({ error: 'cannot_change_self' });
    const result = await query(
      `UPDATE chat_members SET role = $3
       WHERE chat_id = $1 AND user_id = $2 AND role <> 'owner'
       RETURNING user_id, role`,
      [req.chatId, userId, role]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'member_not_found' });
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    res.json({ member: result.rows[0] });
  } catch (error) { next(error); }
});

api.delete('/chats/:chatId/members/:userId', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (!['owner', 'admin'].includes(req.memberRole)) return res.status(403).json({ error: 'admin_required' });
    const userId = toNumber(req.params.userId);
    const target = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.chatId, userId]);
    if (target.rowCount === 0) return res.status(404).json({ error: 'member_not_found' });
    if (target.rows[0].role === 'owner') return res.status(400).json({ error: 'cannot_remove_owner' });
    if (req.memberRole === 'admin' && target.rows[0].role === 'admin') return res.status(403).json({ error: 'cannot_remove_admin' });
    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.chatId, userId]);
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    emitToUser(userId, 'chat:removed', { chatId: req.chatId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/leave', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    if (req.memberRole === 'owner') return res.status(400).json({ error: 'owner_cannot_leave_transfer_first' });
    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [req.chatId, req.user.id]);
    emitToChat(req.chatId, 'chat:updated', { chatId: req.chatId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.get('/chats/:chatId/search', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    const q = cleanText(req.query.q || '', 120);
    if (!q) return res.json({ messages: [] });
    const result = await query(
      `SELECT ${messageSelect}
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN media_files mf ON mf.id = m.media_id
       WHERE m.chat_id = $1 AND m.deleted_at IS NULL AND m.body ILIKE $2
       ORDER BY m.id DESC
       LIMIT 30`,
      [req.chatId, `%${q}%`]
    );
    const ids = result.rows.map(r => Number(r.id));
    const reactionMap = await loadReactionsForMessages(ids, req.user.id);
    res.json({ messages: result.rows.map(row => publicMessage(row, reactionMap.get(String(row.id)) || [])) });
  } catch (error) { next(error); }
});

api.get('/chats/:chatId/messages', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    const messages = await listMessages(req.chatId, req.user.id, req.query.before, req.query.limit);
    res.json({ messages });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/messages', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    const schema = z.object({
      body: z.string().max(5000).default(''),
      type: z.enum(['text', 'audio', 'video', 'image', 'file']).default('text'),
      replyToId: z.coerce.number().int().positive().optional().nullable(),
      mediaId: z.string().uuid().optional().nullable()
    });
    const input = schema.parse(req.body);
    if (input.type === 'text' && !cleanText(input.body)) return res.status(400).json({ error: 'empty_message' });
    if (input.type !== 'text' && !input.mediaId) return res.status(400).json({ error: 'media_required' });
    if (!(await canSendToChat(req.chatId, req.user.id))) return res.status(403).json({ error: 'channel_admin_required' });

    if (input.mediaId) {
      const media = await query('SELECT owner_id FROM media_files WHERE id = $1', [input.mediaId]);
      if (media.rowCount === 0) return res.status(404).json({ error: 'media_not_found' });
      if (Number(media.rows[0].owner_id) !== req.user.id) return res.status(403).json({ error: 'media_owner_required' });
    }
    const msg = await insertMessage({
      chatId: req.chatId,
      senderId: req.user.id,
      body: input.body,
      type: input.type,
      replyToId: input.replyToId,
      mediaId: input.mediaId
    });
    emitToChat(req.chatId, 'message:new', msg);
    res.status(201).json({ message: msg });
  } catch (error) { next(error); }
});

api.patch('/messages/:messageId', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ body: z.string().min(1).max(5000) });
    const input = schema.parse(req.body);
    const id = toNumber(req.params.messageId);
    const old = await query(
      `SELECT m.id, m.chat_id, m.sender_id, m.type
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id, req.user.id]
    );
    if (old.rowCount === 0) return res.status(404).json({ error: 'message_not_found' });
    if (Number(old.rows[0].sender_id) !== req.user.id) return res.status(403).json({ error: 'sender_required' });
    if (old.rows[0].type !== 'text') return res.status(400).json({ error: 'only_text_editable' });
    await query('UPDATE messages SET body = $2, edited_at = now() WHERE id = $1', [id, cleanText(input.body, 5000)]);
    const msg = await getMessage(id, req.user.id);
    emitToChat(msg.chatId, 'message:updated', msg);
    res.json({ message: msg });
  } catch (error) { next(error); }
});

api.delete('/messages/:messageId', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.messageId);
    const result = await query(
      `SELECT m.id, m.chat_id, m.sender_id, cm.role
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'message_not_found' });
    const row = result.rows[0];
    const canDelete = Number(row.sender_id) === req.user.id || ['owner', 'admin'].includes(row.role) || ['admin', 'moderator'].includes(req.user.role);
    if (!canDelete) return res.status(403).json({ error: 'delete_denied' });
    await query(`UPDATE messages SET deleted_at = now(), body = '' WHERE id = $1`, [id]);
    const msg = await getMessage(id, req.user.id);
    emitToChat(row.chat_id, 'message:deleted', msg);
    res.json({ message: msg });
  } catch (error) { next(error); }
});

api.post('/messages/:messageId/reactions', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ emoji: z.string().min(1).max(8) });
    const { emoji } = schema.parse(req.body);
    const id = toNumber(req.params.messageId);
    const msg = await getMessage(id, req.user.id);
    if (!msg) return res.status(404).json({ error: 'message_not_found' });
    await query(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, req.user.id, emoji]
    );
    const updated = await getMessage(id, req.user.id);
    emitToChat(updated.chatId, 'message:updated', updated);
    res.json({ message: updated });
  } catch (error) { next(error); }
});

api.delete('/messages/:messageId/reactions/:emoji', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.messageId);
    const msg = await getMessage(id, req.user.id);
    if (!msg) return res.status(404).json({ error: 'message_not_found' });
    await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [id, req.user.id, req.params.emoji]);
    const updated = await getMessage(id, req.user.id);
    emitToChat(updated.chatId, 'message:updated', updated);
    res.json({ message: updated });
  } catch (error) { next(error); }
});

api.post('/messages/:messageId/report', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ reason: z.string().min(3).max(500) });
    const { reason } = schema.parse(req.body);
    const id = toNumber(req.params.messageId);
    const msg = await getMessage(id, req.user.id);
    if (!msg) return res.status(404).json({ error: 'message_not_found' });
    await query('INSERT INTO reports (reporter_id, message_id, reason) VALUES ($1, $2, $3)', [req.user.id, id, cleanText(reason, 500)]);
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

api.post('/chats/:chatId/read', requireAuth, requireChatMember, async (req, res, next) => {
  try {
    const schema = z.object({ messageId: z.coerce.number().int().positive() });
    const { messageId } = schema.parse(req.body);
    await query(
      `UPDATE chat_members
       SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3)
       WHERE chat_id = $1 AND user_id = $2`,
      [req.chatId, req.user.id, messageId]
    );
    emitToChat(req.chatId, 'chat:read', { chatId: req.chatId, userId: req.user.id, messageId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).replace('.', '') || 'bin';
    cb(null, `${Date.now()}-${nanoid(14)}.${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
      'video/webm', 'video/mp4', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/zip', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (!allowed.includes(file.mimetype)) return cb(new Error('unsupported_file_type'));
    cb(null, true);
  }
});


api.post('/me/avatar', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'image_required' });
    const stored = await saveUploadedFile(req.file, { ownerId: req.user.id, kind: 'image' });
    const inserted = await query(
      `INSERT INTO media_files (owner_id, filename, original_name, mime_type, size_bytes, storage_path, kind, is_public, storage_driver)
       VALUES ($1, $2, $3, $4, $5, $6, 'image', true, $7)
       RETURNING id`,
      [req.user.id, stored.filename, req.file.originalname, req.file.mimetype, stored.sizeBytes, stored.storagePath, config.storageDriver]
    );
    const avatarUrl = `/api/media/${inserted.rows[0].id}`;
    const result = await query(
      `UPDATE users SET avatar_url = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${publicUserFields}`,
      [req.user.id, avatarUrl]
    );
    const user = normalizeUser(result.rows[0]);
    emitToUser(req.user.id, 'user:updated', user);
    res.status(201).json({ user });
  } catch (error) {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    next(error);
  }
});

api.post('/media/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const chatId = toNumber(req.body.chatId);
    const kind = cleanText(req.body.kind, 16);
    const duration = toNumber(req.body.durationSec, null);
    if (!chatId) return res.status(400).json({ error: 'chat_required' });
    const member = await isChatMember(chatId, req.user.id);
    if (!member) return res.status(403).json({ error: 'chat_access_denied' });
    const calculatedKind = kind || (req.file.mimetype.startsWith('audio/') ? 'audio' : req.file.mimetype.startsWith('video/') ? 'video' : req.file.mimetype.startsWith('image/') ? 'image' : 'file');
    if (!['audio', 'video', 'image', 'file'].includes(calculatedKind)) return res.status(400).json({ error: 'invalid_kind' });
    if (calculatedKind === 'audio' && duration && duration > config.maxVoiceSeconds + 5) return res.status(400).json({ error: 'voice_too_long' });
    if (calculatedKind === 'video' && duration && duration > config.maxVideoSeconds + 5) return res.status(400).json({ error: 'video_too_long' });
    const stored = await saveUploadedFile(req.file, { ownerId: req.user.id, kind: calculatedKind });
    const inserted = await query(
      `INSERT INTO media_files (owner_id, filename, original_name, mime_type, size_bytes, storage_path, kind, duration_sec, is_public, storage_driver)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
       RETURNING id, kind, mime_type, size_bytes, original_name, duration_sec`,
      [req.user.id, stored.filename, req.file.originalname, req.file.mimetype, stored.sizeBytes, stored.storagePath, calculatedKind, duration, config.storageDriver]
    );
    const media = inserted.rows[0];
    res.status(201).json({
      media: {
        id: media.id,
        kind: media.kind,
        mimeType: media.mime_type,
        sizeBytes: Number(media.size_bytes),
        originalName: media.original_name,
        durationSec: media.duration_sec,
        url: `/api/media/${media.id}`
      }
    });
  } catch (error) {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    next(error);
  }
});

api.get('/media/:mediaId', requireAuth, async (req, res, next) => {
  try {
    const mediaId = req.params.mediaId;
    const result = await query(
      `SELECT mf.*
       FROM media_files mf
       LEFT JOIN messages m ON m.media_id = mf.id
       LEFT JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE mf.id = $1
         AND (mf.is_public = true OR mf.owner_id = $2 OR cm.user_id = $2)
       LIMIT 1`,
      [mediaId, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'media_not_found' });
    const media = result.rows[0];
    await sendStoredFile(media, res);
  } catch (error) { next(error); }
});


api.get('/blocks', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status_text
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ users: result.rows.map(row => ({
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      statusText: row.status_text || ''
    })) });
  } catch (error) { next(error); }
});

api.post('/blocks/:userId', requireAuth, async (req, res, next) => {
  try {
    const userId = toNumber(req.params.userId);
    if (!userId || userId === req.user.id) return res.status(400).json({ error: 'invalid_user' });
    await query(
      `INSERT INTO blocked_users (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, userId]
    );
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

api.delete('/blocks/:userId', requireAuth, async (req, res, next) => {
  try {
    const userId = toNumber(req.params.userId);
    await query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, userId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

api.get('/admin/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [users, chats, messages, media, reports, calls] = await Promise.all([
      query('SELECT count(*)::int AS count FROM users'),
      query('SELECT type, count(*)::int AS count FROM chats GROUP BY type'),
      query('SELECT count(*)::int AS count FROM messages WHERE deleted_at IS NULL'),
      query('SELECT count(*)::int AS count, COALESCE(sum(size_bytes),0)::bigint AS bytes FROM media_files'),
      query('SELECT status, count(*)::int AS count FROM reports GROUP BY status'),
      query('SELECT status, count(*)::int AS count FROM call_history GROUP BY status')
    ]);
    res.json({
      users: users.rows[0].count,
      chats: chats.rows,
      messages: messages.rows[0].count,
      media: { count: media.rows[0].count, bytes: Number(media.rows[0].bytes || 0) },
      reports: reports.rows,
      calls: calls.rows
    });
  } catch (error) { next(error); }
});

api.get('/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await query(`SELECT ${publicUserFields} FROM users ORDER BY created_at DESC LIMIT 200`);
    res.json({ users: result.rows.map(normalizeUser) });
  } catch (error) { next(error); }
});

api.patch('/admin/users/:userId/ban', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userId = toNumber(req.params.userId);
    if (userId === req.user.id) return res.status(400).json({ error: 'cannot_ban_self' });
    const schema = z.object({ isBanned: z.boolean() });
    const { isBanned } = schema.parse(req.body);
    const result = await query(`UPDATE users SET is_banned = $2 WHERE id = $1 RETURNING ${publicUserFields}`, [userId, isBanned]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'user_not_found' });
    res.json({ user: normalizeUser(result.rows[0]) });
  } catch (error) { next(error); }
});

api.get('/admin/reports', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.reason, r.status, r.created_at, r.message_id,
              reporter.username AS reporter_username,
              reporter.display_name AS reporter_display_name,
              m.body AS message_body, m.chat_id
       FROM reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN messages m ON m.id = r.message_id
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    res.json({ reports: result.rows });
  } catch (error) { next(error); }
});


api.patch('/admin/reports/:reportId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['open', 'reviewed', 'closed']) });
    const { status } = schema.parse(req.body);
    const result = await query(
      `UPDATE reports SET status = $2 WHERE id = $1 RETURNING id, status`,
      [toNumber(req.params.reportId), status]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'report_not_found' });
    res.json({ report: result.rows[0] });
  } catch (error) { next(error); }
});

app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProduction ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((error, req, res, next) => {
  if (error.name === 'ZodError') return res.status(400).json({ error: 'validation_error', details: error.errors });
  if (error.message === 'unsupported_file_type') return res.status(400).json({ error: 'unsupported_file_type' });
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  console.error(error);
  res.status(500).json({ error: 'internal_error' });
});

attachSockets(server, { insertMessage, getMessage, isChatMember, listMessages });

async function start() {
  await migrate();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`${config.appName} listening on http://0.0.0.0:${config.port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { app, server, start, insertMessage, getMessage, isChatMember, listMessages };
