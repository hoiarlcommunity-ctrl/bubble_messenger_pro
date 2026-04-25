const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (!config.smtpHost) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined
  });
  return transporter;
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'mail';
}

async function saveDevMail(mail) {
  await fs.promises.mkdir(config.devMailDir, { recursive: true });
  const name = `${Date.now()}-${safeName(mail.to)}-${safeName(mail.subject)}.eml`;
  const file = path.join(config.devMailDir, name);
  const body = [
    `To: ${mail.to}`,
    `From: ${mail.from || config.mailFrom}`,
    `Subject: ${mail.subject}`,
    '',
    mail.text || '',
    '',
    mail.html ? `HTML:\n${mail.html}` : ''
  ].join('\n');
  await fs.promises.writeFile(file, body, 'utf8');
  console.warn(`[mail:dev] SMTP is not configured. Email saved to ${file}`);
  return { devFile: file };
}

async function sendMail({ to, subject, text, html }) {
  const mail = { from: config.mailFrom, to, subject, text, html };
  const tx = getTransporter();
  if (!tx) return saveDevMail(mail);
  return tx.sendMail(mail);
}

async function sendVerificationEmail(user, token) {
  const link = `${config.publicUrl.replace(/\/$/, '')}/?verify=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Подтверждение email в Bubble Messenger',
    text: `Здравствуйте, ${user.display_name || user.displayName || user.username}!\n\nПодтвердите email по ссылке:\n${link}\n\nЕсли вы не создавали аккаунт, просто проигнорируйте это письмо.`,
    html: `<p>Здравствуйте, ${escapeHtml(user.display_name || user.displayName || user.username)}!</p><p>Подтвердите email:</p><p><a href="${link}">${link}</a></p><p>Если вы не создавали аккаунт, просто проигнорируйте письмо.</p>`
  });
}

async function sendPasswordResetEmail(user, token) {
  const link = `${config.publicUrl.replace(/\/$/, '')}/?reset=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Восстановление пароля Bubble Messenger',
    text: `Здравствуйте, ${user.display_name || user.displayName || user.username}!\n\nСсылка для восстановления пароля действует ограниченное время:\n${link}\n\nЕсли вы не запрашивали восстановление, проигнорируйте это письмо.`,
    html: `<p>Здравствуйте, ${escapeHtml(user.display_name || user.displayName || user.username)}!</p><p>Ссылка для восстановления пароля действует ограниченное время:</p><p><a href="${link}">${link}</a></p><p>Если вы не запрашивали восстановление, проигнорируйте письмо.</p>`
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = { sendMail, sendVerificationEmail, sendPasswordResetEmail };
