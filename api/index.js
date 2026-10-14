'use strict';
/**
 * API duy nhất của ứng dụng (1 Vercel Function).
 * Giao diện gửi:  POST /api  { "fn": "<tên hàm>", "args": [...] }
 * Đăng nhập quản lý gửi kèm header:  Authorization: Bearer <token>
 */
const crypto = require('crypto');
const { getDb } = require('../lib/db');
const A = require('../lib/auth');
const G = require('../lib/google');

/** Client ID "Sign in with Google" của quán (công khai, không phải bí mật). Đổi bằng biến GOOGLE_CLIENT_ID. */
const DEFAULT_GOOGLE_CLIENT_ID = '55981277953-70kkk72b2m31ku2d5n3p64t70c82gdkm.apps.googleusercontent.com';
const googleClientId = () => String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();

/** Gmail có quyền CHỦ QUÁN. Đổi bằng biến môi trường OWNER_EMAILS (phân cách bằng dấu phẩy). */
const DEFAULT_OWNER_EMAILS = ['duydemo1294@gmail.com', 'hangochien2023@gmail.com'];
function ownerEmails() {
  const env = String(process.env.OWNER_EMAILS || '').trim();
  return (env ? env.split(/[,;\s]+/) : DEFAULT_OWNER_EMAILS).map(e => e.trim().toLowerCase()).filter(Boolean);
}

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const STATUS = ['MO', 'KHOA', 'CONG_BO'];
const TZ = 'Asia/Ho_Chi_Minh';
const DEFAULT_SETTINGS = {
  shopName: 'Gu Billiard',
  shifts: [
    { name: 'Ca 1', time: '08:00 - 14:00', need: 2 },
    { name: 'Ca 2', time: '14:00 - 20:00', need: 2 },
    { name: 'Ca 3', time: '20:00 - 02:00', need: 2 }
  ]
};

class UserError extends Error {}
class AuthError extends Error {}
const fail = m => { throw new UserError(m); };

/* ======================= TIỆN ÍCH ======================= */

function checkWeek(week) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || ''))) fail('Tuần không hợp lệ.');
  return String(week);
}

function fmtTime(d) {
  if (!d) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false }).formatToParts(new Date(d));
  const g = t => (p.find(x => x.type === t) || {}).value;
  return `${g('hour')}:${g('minute')} ${g('day')}/${g('month')}/${g('year')}`;
}

/** Ngày thứ 2 của tuần hiện tại theo giờ Việt Nam, dạng yyyy-MM-dd. */
function currentMonday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());                                   /* yyyy-MM-dd */
  const d = new Date(p + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

function validKey(k, n) {
  const p = String(k).split('-').map(Number);
  return p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) &&
    p[0] >= 0 && p[0] < DAYS.length && p[1] >= 0 && p[1] < n;
}
const keyOf = r => r.day + '-' + r.shift;
const keyCmp = (a, b) => { const x = a.split('-').map(Number), y = b.split('-').map(Number); return x[0] - y[0] || x[1] - y[1]; };
const newId = prefix => prefix + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

async function settings(db) {
  const s = await db.collection('settings').findOne({ _id: 'app' });
  return s ? { shopName: s.shopName, shifts: s.shifts } : DEFAULT_SETTINGS;
}

async function staffList(db) {
  const rows = await db.collection('staff').find({}).toArray();
  return rows.map(r => ({ id: r._id, name: r.name, phone: r.phone || '', active: r.active !== false }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

async function weekStatus(db, week) {
  const w = await db.collection('weeks').findOne({ _id: week });
  return w && STATUS.includes(w.status) ? w.status : 'MO';
}

async function assignedMap(db, week, byId) {
  const map = {};
  (await db.collection('assignments').find({ week }).toArray()).forEach(r => {
    const k = keyOf(r);
    (map[k] = map[k] || []).push({ id: r.staffId, name: byId[r.staffId] ? byId[r.staffId].name : r.name });
  });
  return map;
}

const byIdOf = list => { const m = {}; list.forEach(s => { m[s.id] = s; }); return m; };

/* ======================= ĐĂNG NHẬP ======================= */

async function currentUser(db, token) {
  const p = A.verify(token);
  if (!p) return null;
  if (p.role === 'owner' && p.via === 'google') {
    return ownerEmails().includes(p.sub) ? { role: 'owner', name: p.name || p.sub, id: p.sub, email: p.sub } : null;
  }
  if (p.role === 'owner') return p.tag === A.ownerTag() ? { role: 'owner', name: 'Chủ quán', id: 'owner' } : null;
  if (p.role === 'manager') {
    const m = await db.collection('managers').findOne({ _id: p.sub });
    return m && m.ver === p.ver ? { role: 'manager', name: m.name, id: m._id } : null;
  }
  return null;
}

/* ======================= NHÂN VIÊN (không cần đăng nhập) ======================= */

async function getStaffWeek(db, staffId, week) {
  checkWeek(week);
  staffId = String(staffId || '');
  const status = await weekStatus(db, week);
  const mine = await db.collection('registrations').find({ week, staffId }).toArray();
  let schedule = null;
  if (status === 'CONG_BO') schedule = await assignedMap(db, week, byIdOf(await staffList(db)));
  return {
    status,
    slots: mine.map(keyOf),
    note: mine.length ? (mine[0].note || '') : '',
    updated: mine.length ? fmtTime(mine[0].updatedAt) : '',
    schedule
  };
}

const PUBLIC = {
  async getInit(db, ctx, staffId, week) {
    const [s, list] = await Promise.all([settings(db), staffList(db)]);
    const active = list.filter(x => x.active);
    const out = {
      shopName: s.shopName, shifts: s.shifts, days: DAYS,
      staff: active.map(x => ({ id: x.id, name: x.name })),
      week: null,
      me: ctx.user ? { name: ctx.user.name, role: ctx.user.role, email: ctx.user.email || '' } : null,
      googleClientId: googleClientId()
    };
    if (staffId && /^\d{4}-\d{2}-\d{2}$/.test(String(week || '')) && active.some(x => x.id === String(staffId))) {
      out.week = await getStaffWeek(db, staffId, week);
    }
    return out;
  },

  getStaffWeek(db, ctx, staffId, week) { return getStaffWeek(db, staffId, week); },

  async saveRegistration(db, ctx, staffId, week, slots, note) {
    checkWeek(week);
    if ((await weekStatus(db, week)) !== 'MO') fail('Tuần này đã khóa đăng ký. Liên hệ chủ quán nếu cần đổi ca.');
    const st = await db.collection('staff').findOne({ _id: String(staffId || '') });
    if (!st || st.active === false) fail('Không tìm thấy nhân viên này.');
    const n = (await settings(db)).shifts.length;
    const clean = Array.from(new Set((Array.isArray(slots) ? slots : []).map(String)))
      .filter(k => validKey(k, n)).sort(keyCmp);
    const now = new Date(), nt = String(note || '').slice(0, 300);
    await db.collection('registrations').deleteMany({ week, staffId: st._id });
    if (clean.length) {
      await db.collection('registrations').insertMany(clean.map(k => {
        const [day, shift] = k.split('-').map(Number);
        return { week, day, shift, staffId: st._id, name: st.name, note: nt, updatedAt: now };
      }));
    }
    return getStaffWeek(db, st._id, week);
  },

  async googleLogin(db, ctx, credential, week) {
    let g;
    try { g = await G.verifyIdToken(credential, googleClientId()); }
    catch (e) { if (e.badToken) fail(e.message); throw e; }
    if (!ownerEmails().includes(g.email)) fail(`Gmail ${g.email} chưa được cấp quyền chủ quán.`);
    const user = { role: 'owner', via: 'google', sub: g.email, name: g.name };
    const token = A.newToken(user);
    ctx.user = { role: 'owner', name: g.name, id: g.email, email: g.email };
    return { token, me: { name: g.name, role: 'owner', email: g.email },
      data: week ? await ADMIN.getAdminWeek(db, ctx, week) : null };
  },

  async adminLogin(db, ctx, pass, week) {
    pass = String(pass || '').trim();
    if (!pass) fail('Vui lòng nhập mật khẩu hoặc mã PIN.');
    let user = null;
    if (process.env.OWNER_PASSWORD && A.safeEqual(pass, process.env.OWNER_PASSWORD)) {
      user = { role: 'owner', sub: 'owner', tag: A.ownerTag(), name: 'Chủ quán' };
    } else {
      for (const m of await db.collection('managers').find({}).toArray()) {
        if (A.checkPin(pass, m.pinHash)) { user = { role: 'manager', sub: m._id, ver: m.ver, name: m.name }; break; }
      }
    }
    if (!user) {
      await new Promise(r => setTimeout(r, 900));          /* làm chậm dò mật khẩu */
      fail('Sai mật khẩu hoặc mã PIN.');
    }
    const token = A.newToken(user);
    ctx.user = { role: user.role, name: user.name, id: user.sub };
    return { token, me: { name: user.name, role: user.role }, data: week ? await ADMIN.getAdminWeek(db, ctx, week) : null };
  }
};

/* ======================= QUẢN LÝ (cần đăng nhập) ======================= */

const ADMIN = {
  async getAdminWeek(db, ctx, week) {
    checkWeek(week);
    const [list, s, status] = await Promise.all([staffList(db), settings(db), weekStatus(db, week)]);
    const byId = byIdOf(list);
    const registered = {}, notes = {};
    (await db.collection('registrations').find({ week }).toArray()).forEach(r => {
      const name = byId[r.staffId] ? byId[r.staffId].name : r.name;
      const k = keyOf(r);
      (registered[k] = registered[k] || []).push({ id: r.staffId, name });
      if (r.note) notes[r.staffId] = { name, note: r.note };
    });
    return {
      status, registered,
      assigned: await assignedMap(db, week, byId),
      notes: Object.values(notes),
      staff: list, settings: s,
      me: { name: ctx.user.name, role: ctx.user.role, email: ctx.user.email || '' }
    };
  },

  async saveAssignment(db, ctx, week, assigned) {
    checkWeek(week);
    const byId = byIdOf(await staffList(db));
    const n = (await settings(db)).shifts.length;
    const now = new Date(), docs = [];
    Object.keys(assigned && typeof assigned === 'object' ? assigned : {}).filter(k => validKey(k, n)).sort(keyCmp)
      .forEach(k => {
        const [day, shift] = k.split('-').map(Number);
        Array.from(new Set((Array.isArray(assigned[k]) ? assigned[k] : []).map(String))).forEach(id => {
          if (byId[id]) docs.push({ week, day, shift, staffId: id, name: byId[id].name, updatedAt: now });
        });
      });
    await db.collection('assignments').deleteMany({ week });
    if (docs.length) await db.collection('assignments').insertMany(docs);
    return ADMIN.getAdminWeek(db, ctx, week);
  },

  async setWeekStatus(db, ctx, week, code) {
    checkWeek(week);
    if (!STATUS.includes(code)) fail('Trạng thái không hợp lệ.');
    await db.collection('weeks').updateOne({ _id: week },
      { $set: { status: code, updatedAt: new Date(), by: ctx.user.name } }, { upsert: true });
    return ADMIN.getAdminWeek(db, ctx, week);
  },

  async saveStaff(db, ctx, s) {
    s = s || {};
    const name = String(s.name || '').trim().replace(/\s+/g, ' ');
    if (!name) fail('Vui lòng nhập họ tên.');
    if (name.length > 60) fail('Tên quá dài.');
    const phone = String(s.phone || '').trim().slice(0, 30);
    const active = s.active !== false;
    const id = String(s.id || '');
    const list = await staffList(db);
    const dup = list.find(x => x.active && x.id !== id && x.name.toLowerCase() === name.toLowerCase());
    if (dup && active) fail(`Đã có nhân viên tên "${name}". Hãy thêm chữ để phân biệt (vd: ${name} B).`);
    if (id) {
      const r = await db.collection('staff').updateOne({ _id: id }, { $set: { name, phone, active, updatedAt: new Date() } });
      if (!r.matchedCount) fail('Không tìm thấy nhân viên (có thể đã bị xóa).');
    } else {
      const used = new Set(list.map(x => x.id));
      let nid; do { nid = newId('NV'); } while (used.has(nid));
      await db.collection('staff').insertOne({ _id: nid, name, phone, active: true, createdAt: new Date() });
    }
    return staffList(db);
  },

  /** Xóa hẳn: bỏ nhân viên và các ca đăng ký / đã xếp từ tuần này trở đi. Lịch sử tuần trước vẫn giữ. */
  async deleteStaff(db, ctx, id) {
    id = String(id || '');
    const r = await db.collection('staff').deleteOne({ _id: id });
    if (!r.deletedCount) fail('Không tìm thấy nhân viên (có thể đã bị xóa).');
    const cur = currentMonday();
    await Promise.all(['registrations', 'assignments'].map(c =>
      db.collection(c).deleteMany({ staffId: id, week: { $gte: cur } })));
    return staffList(db);
  },

  async saveSettings(db, ctx, s) {
    s = s || {};
    const shopName = String(s.shopName || '').trim().slice(0, 60) || DEFAULT_SETTINGS.shopName;
    const shifts = (Array.isArray(s.shifts) ? s.shifts : []).slice(0, 4).map((x, i) => ({
      name: String((x && x.name) || '').trim().slice(0, 30) || ('Ca ' + (i + 1)),
      time: String((x && x.time) || '').trim().slice(0, 30),
      need: Math.max(0, Math.min(20, parseInt(x && x.need, 10) || 0))
    }));
    if (!shifts.length) fail('Cần ít nhất 1 ca.');
    await db.collection('settings').updateOne({ _id: 'app' }, { $set: { shopName, shifts, updatedAt: new Date() } }, { upsert: true });
    return { shopName, shifts };
  }
};

/* ======================= CHỈ CHỦ QUÁN: người quản lý ======================= */

async function managerList(db) {
  return (await db.collection('managers').find({}).toArray())
    .map(m => ({ id: m._id, name: m.name, createdAt: fmtTime(m.createdAt) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

const OWNER = {
  listManagers(db) { return managerList(db); },

  async saveManager(db, ctx, m) {
    m = m || {};
    const name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const pin = String(m.pin || '').trim();
    const id = String(m.id || '');
    if (!name) fail('Vui lòng nhập tên người quản lý.');
    if (!id || pin) {
      if (!/^\d{4,8}$/.test(pin)) fail('Mã PIN gồm 4 đến 8 chữ số.');
      if (process.env.OWNER_PASSWORD && A.safeEqual(pin, process.env.OWNER_PASSWORD)) fail('Mã PIN không được trùng mật khẩu chủ quán.');
      const others = await db.collection('managers').find({ _id: { $ne: id } }).toArray();
      if (others.some(o => A.checkPin(pin, o.pinHash))) fail('Mã PIN này đã có người dùng, hãy chọn mã khác.');
    }
    if (id) {
      const set = { name, updatedAt: new Date() };
      if (pin) { set.pinHash = A.hashPin(pin); set.ver = crypto.randomBytes(4).toString('hex'); }
      const r = await db.collection('managers').updateOne({ _id: id }, { $set: set });
      if (!r.matchedCount) fail('Không tìm thấy người quản lý.');
    } else {
      await db.collection('managers').insertOne({ _id: newId('QL'), name, pinHash: A.hashPin(pin),
        ver: crypto.randomBytes(4).toString('hex'), createdAt: new Date() });
    }
    return managerList(db);
  },

  async deleteManager(db, ctx, id) {
    await db.collection('managers').deleteOne({ _id: String(id || '') });
    return managerList(db);
  }
};

/* ======================= XỬ LÝ REQUEST ======================= */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET') {                                /* kiểm tra nhanh: mở /api trên trình duyệt */
    try { const db = await getDb(); await db.command({ ping: 1 });
      return res.status(200).end(JSON.stringify({ ok: true, db: 'connected',
        googleLogin: !!googleClientId(), ownerEmails: ownerEmails().length,
        ownerPassword: !!process.env.OWNER_PASSWORD })); }
    catch (e) { return res.status(500).end(JSON.stringify({ ok: false, error: e.message })); }
  }
  if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const fnName = String((body && body.fn) || '');
  const args = Array.isArray(body && body.args) ? body.args : [];
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  try {
    const db = await getDb();
    const ctx = { user: await currentUser(db, token) };
    let fn;
    if (Object.prototype.hasOwnProperty.call(PUBLIC, fnName)) fn = PUBLIC[fnName];
    else if (Object.prototype.hasOwnProperty.call(ADMIN, fnName)) {
      if (!ctx.user) throw new AuthError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
      fn = ADMIN[fnName];
    } else if (Object.prototype.hasOwnProperty.call(OWNER, fnName)) {
      if (!ctx.user) throw new AuthError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
      if (ctx.user.role !== 'owner') fail('Chỉ chủ quán mới quản lý được danh sách người quản lý.');
      fn = OWNER[fnName];
    } else fail('Yêu cầu không hợp lệ.');
    const result = await fn(db, ctx, ...args);
    return res.status(200).end(JSON.stringify({ ok: true, result: result === undefined ? null : result }));
  } catch (e) {
    if (e instanceof AuthError) return res.status(401).end(JSON.stringify({ error: 'AUTH: ' + e.message }));
    if (e instanceof UserError) return res.status(400).end(JSON.stringify({ error: e.message }));
    console.error(fnName, e);
    const msg = /Không tải được khóa xác minh của Google/.test(e.message || '') ? e.message : /ECONNREFUSED|ENOTFOUND|Server selection|timed out|querySrv/i.test(e.message || '')
      ? 'Không kết nối được cơ sở dữ liệu. Kiểm tra MONGODB_URI và Network Access (0.0.0.0/0) trên MongoDB Atlas.'
      : (/authentication failed|bad auth/i.test(e.message || '') ? 'Sai mật khẩu database trong MONGODB_URI.' : 'Lỗi máy chủ, vui lòng thử lại.');
    return res.status(500).end(JSON.stringify({ error: msg }));
  }
};
