'use strict';
/**
 * Xác minh "Sign in with Google" (ID token dạng JWT, ký RS256) mà không cần thư viện ngoài:
 *  - chữ ký đúng khóa công khai của Google (tải từ GOOGLE_CERTS_URL, có cache),
 *  - aud = GOOGLE_CLIENT_ID của quán, iss = accounts.google.com, chưa hết hạn,
 *  - email đã được Google xác minh.
 */
const crypto = require('crypto');

const CERTS_URL = () => process.env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
let cache = { keys: null, exp: 0 };

async function getKeys(force) {
  if (!force && cache.keys && Date.now() < cache.exp) return cache.keys;
  const r = await fetch(CERTS_URL());
  if (!r.ok) throw new Error('Không tải được khóa xác minh của Google (' + r.status + ')');
  const j = await r.json();
  const m = String(r.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  cache = { keys: j.keys || [], exp: Date.now() + (m ? Number(m[1]) * 1000 : 3600e3) };
  return cache.keys;
}

const part = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function verifyIdToken(idToken, clientId) {
  const bad = why => { const e = new Error(why); e.badToken = true; return e; };
  if (!clientId) throw bad('Chưa cấu hình GOOGLE_CLIENT_ID.');
  const seg = String(idToken || '').split('.');
  if (seg.length !== 3) throw bad('Token Google không hợp lệ.');
  let header, payload;
  try { header = part(seg[0]); payload = part(seg[1]); } catch (e) { throw bad('Token Google không hợp lệ.'); }
  if (header.alg !== 'RS256' || !header.kid) throw bad('Token Google không hợp lệ.');

  let jwk = (await getKeys(false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(true)).find(k => k.kid === header.kid);   /* Google vừa xoay khóa */
  if (!jwk) throw bad('Token Google không hợp lệ (khóa lạ).');

  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(seg[0] + '.' + seg[1]), pub, Buffer.from(seg[2], 'base64url'));
  if (!ok) throw bad('Chữ ký token Google không đúng.');

  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw bad('Token không do Google cấp.');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw bad('Token Google không dành cho ứng dụng này.');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw bad('Phiên Google đã hết hạn, vui lòng đăng nhập lại.');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw bad('Gmail chưa được Google xác minh.');
  if (!payload.email) throw bad('Không lấy được email từ Google.');

  return { email: String(payload.email).trim().toLowerCase(), name: payload.name || payload.email, picture: payload.picture || '' };
}

module.exports = { verifyIdToken };
