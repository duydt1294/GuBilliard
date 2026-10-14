'use strict';
/**
 * Đăng nhập quản lý:
 *  - Chủ quán: Gmail (xem lib/google.js) hoặc mật khẩu OWNER_PASSWORD trong config.js.
 *  - Người quản lý: mã PIN do chủ quán tạo trong app (lưu dạng băm scrypt).
 * Phiên đăng nhập là token ký HMAC (không lưu phía máy chủ), hạn 30 ngày.
 * Đổi OWNER_PASSWORD hoặc đổi/xóa PIN của ai thì token cũ của người đó mất hiệu lực.
 */
const crypto = require('crypto');
const CFG = require('./config');

const TOKEN_DAYS = 30;

function secret() {
  return CFG.sessionSecret() ||
    crypto.createHash('sha256').update('gub-session:' + CFG.mongoUri() + ':' + CFG.ownerPassword()).digest('hex');
}

const b64u = buf => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return p;
}

function ownerTag() {
  return crypto.createHash('sha256').update('owner:' + CFG.ownerPassword()).digest('hex').slice(0, 12);
}

function safeEqual(x, y) {
  const a = crypto.createHash('sha256').update(String(x)).digest();
  const b = crypto.createHash('sha256').update(String(y)).digest();
  return crypto.timingSafeEqual(a, b);
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return salt + ':' + h;
}

function checkPin(pin, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, h] = stored.split(':');
  const x = crypto.scryptSync(String(pin), salt, 32);
  const y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function newToken(user) {
  return sign(Object.assign({}, user, { exp: Date.now() + TOKEN_DAYS * 864e5 }));
}

module.exports = { sign, verify, ownerTag, safeEqual, hashPin, checkPin, newToken };
