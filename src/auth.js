const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const config = require('./config');
const { query } = require('./db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./email');

const publicUserFields = `id, username, email, email_verified_at, display_name, role, avatar_url, status_text, is_banned, last_seen, allow_direct_messages, show_online, created_at`;

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email().max(254),
  displayName: z.string().min(2).max(64),
  password: z.string().min(8).max(128),
  captchaToken: z.string().max(4000).optional().default('')
});

const loginSchema = z.object({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(128)
});

const emailOrUsernameSchema = z.object({
  login: z.string().min(1).max(254)
});

const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128)
});

const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    config.jwtAccessSecret,
    { expiresIn: config.accessTokenTtl }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user.id), tokenType: 'refresh' },
    config.jwtRefreshSecret,
    { expiresIn: config.refreshTokenTtl }
  );
}

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/auth/refresh'
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email || '',
    emailVerified: Boolean(row.email_verified_at),
    displayName: row.display_name,
    role: row.role,
    avatarUrl: row.avatar_url,
    statusText: row.status_text || '',
    isBanned: Boolean(row.is_banned),
    allowDirectMessages: row.allow_direct_messages !== false,
    showOnline: row.show_online !== false,
    lastSeen: row.show_online === false ? null : row.last_seen,
    createdAt: row.created_at
  };
}

async function getUserById(id) {
  const result = await query(`SELECT ${publicUserFields} FROM users WHERE id = $1`, [id]);
  return normalizeUser(result.rows[0]);
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const cookieToken = req.cookies?.accessToken;
    const token = bearer || cookieToken;
    if (!token) return res.status(401).json({ error: 'auth_required' });

    const payload = jwt.verify(token, config.jwtAccessSecret);
    const user = await getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'user_not_found' });
    if (user.isBanned) return res.status(403).json({ error: 'user_banned' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}


function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createEmailToken(userId, purpose, ttlMinutes) {
  const token = randomToken();
  await query(
    `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [userId, purpose, hashToken(token), ttlMinutes]
  );
  return token;
}

async function verifyCaptchaIfNeeded(token, remoteIp) {
  if (!config.hcaptchaSecret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: config.hcaptchaSecret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  const res = await fetch('https://hcaptcha.com/siteverify', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  return Boolean(data.success);
}

async function sendVerificationForUser(row) {
  if (!row?.email) return;
  const token = await createEmailToken(row.id, 'email_verify', config.emailTokenTtlMinutes);
  await sendVerificationEmail(row, token);
}

async function consumeToken(token, purpose) {
  const tokenHash = hashToken(token);
  const result = await query(
    `UPDATE email_tokens
     SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING id, user_id`,
    [tokenHash, purpose]
  );
  return result.rows[0] || null;
}

function authRoutes(router) {
  router.get('/auth/public-config', (req, res) => {
    res.json({
      registrationOpen: config.registrationOpen,
      requireEmailVerification: config.requireEmailVerification,
      hcaptchaSiteKey: config.hcaptchaSiteKey || ''
    });
  });

  router.post('/auth/register', async (req, res, next) => {
    try {
      if (!config.registrationOpen) return res.status(403).json({ error: 'registration_closed' });
      const input = registerSchema.parse(req.body);
      const captchaOk = await verifyCaptchaIfNeeded(input.captchaToken, req.ip);
      if (!captchaOk) return res.status(400).json({ error: 'captcha_required' });
      const passwordHash = await bcrypt.hash(input.password, 12);
      const inserted = await query(
        `INSERT INTO users (username, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${publicUserFields}`,
        [input.username.toLowerCase(), input.email.toLowerCase(), input.displayName, passwordHash, config.requireEmailVerification ? null : new Date()]
      );
      const row = inserted.rows[0];
      if (config.requireEmailVerification) {
        await sendVerificationForUser(row);
        return res.status(201).json({ requiresEmailVerification: true, message: 'verification_email_sent' });
      }
      const user = normalizeUser(row);
      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      setRefreshCookie(res, refreshToken);
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: config.cookieSecure ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000
      });
      res.status(201).json({ user, accessToken });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'username_or_email_taken' });
      next(error);
    }
  });

  router.post('/auth/login', async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await query(
        `SELECT ${publicUserFields}, password_hash FROM users WHERE username = $1 OR lower(email) = $1`,
        [input.username.toLowerCase()]
      );
      const row = result.rows[0];
      if (!row) return res.status(401).json({ error: 'invalid_credentials' });
      const ok = await bcrypt.compare(input.password, row.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      if (row.is_banned) return res.status(403).json({ error: 'user_banned' });
      if (config.requireEmailVerification && row.email && !row.email_verified_at) return res.status(403).json({ error: 'email_not_verified' });
      await query('UPDATE users SET last_seen = now() WHERE id = $1', [row.id]);
      const user = normalizeUser(row);
      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      setRefreshCookie(res, refreshToken);
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: config.cookieSecure ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000
      });
      res.json({ user, accessToken });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/refresh', async (req, res, next) => {
    try {
      const token = req.cookies?.refreshToken || req.body?.refreshToken;
      if (!token) return res.status(401).json({ error: 'refresh_required' });
      const payload = jwt.verify(token, config.jwtRefreshSecret);
      if (payload.tokenType !== 'refresh') return res.status(401).json({ error: 'invalid_refresh' });
      const user = await getUserById(payload.sub);
      if (!user || user.isBanned) return res.status(401).json({ error: 'invalid_user' });
      const accessToken = signAccessToken(user);
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: config.cookieSecure ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000
      });
      res.json({ user, accessToken });
    } catch (error) {
      next(error);
    }
  });


  router.post('/auth/verify-email', async (req, res, next) => {
    try {
      const { token } = verifyEmailSchema.parse(req.body);
      const consumed = await consumeToken(token, 'email_verify');
      if (!consumed) return res.status(400).json({ error: 'invalid_or_expired_token' });
      await query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1', [consumed.user_id]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/auth/resend-verification', async (req, res, next) => {
    try {
      const { login } = emailOrUsernameSchema.parse(req.body);
      const result = await query(
        `SELECT id, username, email, display_name, email_verified_at FROM users WHERE username = $1 OR lower(email) = $1`,
        [login.toLowerCase()]
      );
      const row = result.rows[0];
      if (row && row.email && !row.email_verified_at) await sendVerificationForUser(row);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/auth/request-password-reset', async (req, res, next) => {
    try {
      const { login } = emailOrUsernameSchema.parse(req.body);
      const result = await query(
        `SELECT id, username, email, display_name FROM users WHERE (username = $1 OR lower(email) = $1) AND is_banned = false`,
        [login.toLowerCase()]
      );
      const row = result.rows[0];
      if (row && row.email) {
        const token = await createEmailToken(row.id, 'password_reset', config.passwordResetTtlMinutes);
        await sendPasswordResetEmail(row, token);
      }
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/auth/reset-password', async (req, res, next) => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      const consumed = await consumeToken(token, 'password_reset');
      if (!consumed) return res.status(400).json({ error: 'invalid_or_expired_token' });
      const passwordHash = await bcrypt.hash(password, 12);
      await query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1', [consumed.user_id, passwordHash]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/auth/logout', (req, res) => {
    clearRefreshCookie(res);
    res.clearCookie('accessToken');
    res.json({ ok: true });
  });
}

module.exports = {
  authRoutes,
  requireAuth,
  requireAdmin,
  getUserById,
  normalizeUser,
  signAccessToken,
  publicUserFields
};
