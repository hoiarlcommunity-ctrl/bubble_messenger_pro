const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { runSqlMigrations } = require('./migrationRunner');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
      avatar_url TEXT,
      status_text TEXT DEFAULT '',
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen TIMESTAMPTZ DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_direct_messages BOOLEAN NOT NULL DEFAULT TRUE`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_online BOOLEAN NOT NULL DEFAULT TRUE`);

  await query(`
    CREATE TABLE IF NOT EXISTS chats (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
      title TEXT,
      owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      avatar_url TEXT,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check`);
  await query(`ALTER TABLE chats ADD CONSTRAINT chats_type_check CHECK (type IN ('direct', 'group', 'channel'))`);
  await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);

  await query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      last_read_message_id BIGINT,
      muted BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_id, user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS media_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      storage_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('audio', 'video', 'image', 'file')),
      duration_sec INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE`);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'audio', 'video', 'image', 'file', 'system')),
      reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      media_id UUID REFERENCES media_files(id) ON DELETE SET NULL,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id, emoji)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS message_mentions (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      mentioned_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, mentioned_user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      pinned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_id, message_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS saved_messages (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS invite_links (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS call_history (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT REFERENCES chats(id) ON DELETE SET NULL,
      caller_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      callee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
      status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'answered', 'rejected', 'ended', 'missed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id),
      CHECK (blocker_id <> blocked_id)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC, id DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(media_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(mentioned_user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pins_chat ON pinned_messages(chat_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_messages(user_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_invites_chat ON invite_links(chat_id)`);

  await runSqlMigrations(query);

  if (config.initialAdminUsername && config.initialAdminPassword) {
    await ensureInitialAdmin();
  }

  if (config.demoUser) {
    await ensureDemoData();
  }
}

async function ensureInitialAdmin() {
  const username = String(config.initialAdminUsername).trim().toLowerCase();
  const password = String(config.initialAdminPassword);
  if (!username || !password) return;
  if (password.length < 12) {
    console.warn('[bootstrap] INITIAL_ADMIN_PASSWORD is too short. Use at least 12 characters.');
    return;
  }

  const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(password, 12);
    await query(
      `INSERT INTO users (username, display_name, password_hash, role, status_text)
       VALUES ($1, $2, $3, 'admin', 'Первый администратор проекта')`,
      [username, config.initialAdminDisplayName, hash]
    );
    console.log(`[bootstrap] Initial admin created: ${username}`);
  }
}

async function ensureDemoData() {
  const existing = await query('SELECT id FROM users WHERE username = $1', [config.demoUsername]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(config.demoPassword, 12);
    await query(
      `INSERT INTO users (username, display_name, password_hash, role, status_text)
       VALUES ($1, $2, $3, 'admin', 'Демо-аккаунт для проверки')`,
      [config.demoUsername, config.demoDisplayName, hash]
    );
  }

  const names = [
    ['lena', 'Лена', 'Космос и стикеры ✨'],
    ['max', 'Максим', 'На связи'],
    ['katya', 'Катя', 'Музыка, дизайн, мемы']
  ];

  for (const [username, displayName, status] of names) {
    const ex = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (ex.rowCount === 0) {
      const hash = await bcrypt.hash('demo123', 12);
      await query(
        `INSERT INTO users (username, display_name, password_hash, status_text)
         VALUES ($1, $2, $3, $4)`,
        [username, displayName, hash, status]
      );
    }
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withClient, migrate, close };
