'use strict';
/**
 * Đọc cấu hình. Ưu tiên file config.js ở gốc repo; biến môi trường trên Vercel
 * chỉ được dùng khi ô tương ứng trong config.js để trống.
 */
const C = require('../config');

const env = k => (process.env[k] !== undefined && String(process.env[k]).trim() !== '') ? String(process.env[k]).trim() : null;
const val = v => (v === undefined || v === null) ? '' : String(v).trim();
const PLACEHOLDER = 'NHAP_MAT_KHAU_DATABASE_VAO_DAY';
const hasPassword = () => { const p = val(C.DB_PASSWORD); return !!p && p !== PLACEHOLDER; };

function mongoUri() {
  if (hasPassword()) {
    return 'mongodb+srv://' + encodeURIComponent(val(C.DB_USER)) + ':' + encodeURIComponent(String(C.DB_PASSWORD)) +
      '@' + val(C.DB_HOST) + '/?retryWrites=true&w=majority&appName=' + encodeURIComponent(val(C.DB_APP_NAME) || 'GuBilliard');
  }
  return env('MONGODB_URI') || '';
}

module.exports = {
  mongoUri,
  dbName: () => val(C.DB_NAME) || env('MONGODB_DB') || 'gubilliard',
  ownerEmails: () => {
    const list = Array.isArray(C.OWNER_EMAILS) && C.OWNER_EMAILS.length ? C.OWNER_EMAILS
      : String(env('OWNER_EMAILS') || '').split(/[,;\s]+/);
    return list.map(x => String(x).trim().toLowerCase()).filter(Boolean);
  },
  googleClientId: () => val(C.GOOGLE_CLIENT_ID) || env('GOOGLE_CLIENT_ID') || '',
  ownerPassword: () => (C.OWNER_PASSWORD ? String(C.OWNER_PASSWORD) : '') || env('OWNER_PASSWORD') || '',
  sessionSecret: () => val(C.SESSION_SECRET) || env('SESSION_SECRET') || ''
};
