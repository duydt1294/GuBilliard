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
const TS = require('../lib/timesheet');

const CFG = require('../lib/config');
const googleClientId = CFG.googleClientId;     /* Client ID Google – sửa trong config.js */
const ownerEmails = CFG.ownerEmails;           /* Gmail chủ quán – sửa trong config.js */

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const STATUS = ['MO', 'KHOA', 'CONG_BO'];
const TZ = 'Asia/Ho_Chi_Minh';
const DEFAULT_SETTINGS = {
  shopName: 'Gu Billiard',
  shifts: [
    { name: 'Ca 1', time: '09:00 - 14:00', need: 2 },
    { name: 'Ca 2', time: '14:00 - 19:00', need: 2 },
    { name: 'Ca 3', time: '19:00 - 00:00', need: 2 }
  ],
  hourlyRate: 18000
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
  return s ? { shopName: s.shopName, shifts: s.shifts, hourlyRate: s.hourlyRate != null ? s.hourlyRate : DEFAULT_SETTINGS.hourlyRate }
           : DEFAULT_SETTINGS;
}

async function staffList(db) {
  const rows = await db.collection('staff').find({}).toArray();
  return rows.map(r => ({ id: r._id, name: r.name, active: r.active !== false, rate: r.rate || null }))
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

const MAX_FAILS = 8, FAIL_WINDOW_MS = 15 * 60e3;

/** Chặn dò mật khẩu/PIN: sai quá MAX_FAILS lần trong 15 phút từ cùng một IP → tạm khóa. */
async function checkLoginLimit(db, ip) {
  const f = await db.collection('loginFails').findOne({ _id: ip });
  if (f && f.count >= MAX_FAILS && Date.now() - new Date(f.first).getTime() < FAIL_WINDOW_MS) {
    const mins = Math.ceil((FAIL_WINDOW_MS - (Date.now() - new Date(f.first).getTime())) / 60e3);
    fail(`Nhập sai quá nhiều lần. Vui lòng thử lại sau ${mins} phút.`);
  }
}
async function recordLoginFail(db, ip) {
  const col = db.collection('loginFails');
  const f = await col.findOne({ _id: ip });
  if (!f || Date.now() - new Date(f.first).getTime() >= FAIL_WINDOW_MS) {
    await col.updateOne({ _id: ip }, { $set: { count: 1, first: new Date() } }, { upsert: true });
  } else {
    await col.updateOne({ _id: ip }, { $inc: { count: 1 } });
  }
}

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
    status: status === 'MO' && week < currentMonday() ? 'QUA' : status,
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
    if (week < currentMonday()) fail('Tuần này đã qua, không sửa đăng ký được nữa.');
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
    await checkLoginLimit(db, ctx.ip);
    let user = null;
    if (CFG.ownerPassword() && A.safeEqual(pass, CFG.ownerPassword())) {
      user = { role: 'owner', sub: 'owner', tag: A.ownerTag(), name: 'Chủ quán' };
    } else {
      for (const m of await db.collection('managers').find({}).toArray()) {
        if (A.checkPin(pass, m.pinHash)) { user = { role: 'manager', sub: m._id, ver: m.ver, name: m.name }; break; }
      }
    }
    if (!user) {
      await recordLoginFail(db, ctx.ip);
      await new Promise(r => setTimeout(r, 900));          /* làm chậm dò mật khẩu */
      fail('Sai mật khẩu hoặc mã PIN.');
    }
    await db.collection('loginFails').deleteOne({ _id: ctx.ip });
    const token = A.newToken(user);
    ctx.user = { role: user.role, name: user.name, id: user.sub };
    return { token, me: { name: user.name, role: user.role }, data: week ? await ADMIN.getAdminWeek(db, ctx, week) : null };
  }
};

/* ======================= QUẢN LÝ (cần đăng nhập) ======================= */

/** Lương/giờ tính bằng đồng: '' / null → null (theo mức mặc định); số ngoài 1.000đ–10.000.000đ → lỗi. */
function parseRate(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Math.round(Number(String(v).replace(/[^\d.]/g, '')));
  if (!(n >= 1000) || n > 10000000) fail('Lương/giờ phải từ 1.000đ đến 10.000.000đ.');
  return n;
}

const ADMIN = {
  async getAdminWeek(db, ctx, week) {
    checkWeek(week);
    const [list, s, w] = await Promise.all([staffList(db), settings(db), db.collection('weeks').findOne({ _id: week })]);
    const status = w && STATUS.includes(w.status) ? w.status : 'MO';
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
      rev: (w && w.arev) || 0,
      savedBy: (w && w.aby) || '', savedAt: w && w.aat ? fmtTime(w.aat) : '',
      assigned: await assignedMap(db, week, byId),
      notes: Object.values(notes),
      staff: list, settings: s,
      me: { name: ctx.user.name, role: ctx.user.role, email: ctx.user.email || '' }
    };
  },

  async saveAssignment(db, ctx, week, assigned, rev) {
    checkWeek(week);
    /* Chỉ lưu khi lịch chưa bị ai khác sửa kể từ lúc mình tải (rev khớp). */
    if (rev !== undefined && rev !== null) {
      const r0 = Number(rev) || 0;
      const filter = r0 === 0 ? { _id: week, $or: [{ arev: { $exists: false } }, { arev: 0 }] } : { _id: week, arev: r0 };
      let ok = false;
      try {
        const u = await db.collection('weeks').updateOne(filter,
          { $set: { arev: r0 + 1, aby: ctx.user.name, aat: new Date() } }, { upsert: r0 === 0 });
        ok = u.matchedCount > 0 || u.upsertedCount > 0;
      } catch (e) { if (e && e.code !== 11000) throw e; }
      if (!ok) {
        const w = await db.collection('weeks').findOne({ _id: week });
        fail(`CONFLICT: Lịch tuần này vừa được ${(w && w.aby) || 'người khác'} lưu${w && w.aat ? ' lúc ' + fmtTime(w.aat) : ''}. Hãy tải lại để xem bản mới rồi xếp tiếp.`);
      }
    }
    const byId = byIdOf(await staffList(db));
    const st = await settings(db), n = st.shifts.length;
    const defs = st.shifts.map(x => TS.parseShiftTime(x.time));
    const now = new Date(), docs = [];
    Object.keys(assigned && typeof assigned === 'object' ? assigned : {}).filter(k => validKey(k, n)).sort(keyCmp)
      .forEach(k => {
        const [day, shift] = k.split('-').map(Number);
        Array.from(new Set((Array.isArray(assigned[k]) ? assigned[k] : []).map(String))).forEach(id => {
          if (byId[id]) docs.push({ week, day, shift, staffId: id, name: byId[id].name, updatedAt: now,
            defIn: defs[shift] ? defs[shift].start : '', defOut: defs[shift] ? defs[shift].end : '' });
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
    const active = s.active !== false;
    const id = String(s.id || '');
    const list = await staffList(db);
    const dup = list.find(x => x.active && x.id !== id && x.name.toLowerCase() === name.toLowerCase());
    if (dup && active) fail(`Đã có nhân viên tên "${name}". Hãy thêm chữ để phân biệt (vd: ${name} B).`);
    const set = { name, active, updatedAt: new Date() };
    if (s.rate !== undefined) set.rate = parseRate(s.rate);          /* null = theo lương mặc định */
    if (id) {
      const r = await db.collection('staff').updateOne({ _id: id }, { $set: set });
      if (!r.matchedCount) fail('Không tìm thấy nhân viên (có thể đã bị xóa).');
    } else {
      const used = new Set(list.map(x => x.id));
      let nid; do { nid = newId('NV'); } while (used.has(nid));
      if (set.rate == null) set.rate = (await settings(db)).hourlyRate || null;   /* nhân viên mới: lương mặc định */
      await db.collection('staff').insertOne(Object.assign({ _id: nid, createdAt: new Date() }, set, { active: true }));
    }
    return staffList(db);
  },

  /** Tăng/giảm lương nhanh từ danh sách nhân viên (đồng/giờ). */
  async setStaffRate(db, ctx, id, rate) {
    const r = parseRate(rate);
    if (r == null) fail('Lương/giờ không hợp lệ.');
    const u = await db.collection('staff').updateOne({ _id: String(id || '') }, { $set: { rate: r, updatedAt: new Date() } });
    if (!u.matchedCount) fail('Không tìm thấy nhân viên (có thể đã bị xóa).');
    return staffList(db);
  },

  /** Bảng chấm công & lương của tuần. */
  async getTimesheet(db, ctx, week) {
    checkWeek(week);
    return timesheetOf(db, week);
  },

  /** Sửa giờ vào/ra thực tế, đánh dấu nghỉ, hoặc đặt lại theo giờ ca (reset). */
  async saveAttendance(db, ctx, week, day, shift, staffId, data) {
    checkWeek(week);
    day = Number(day); shift = Number(shift); staffId = String(staffId || '');
    data = data || {};
    const asg = await db.collection('assignments').findOne({ week, day, shift, staffId });
    if (!asg) fail('Người này không còn được xếp ca đó – hãy tải lại.');
    const _id = [week, day, shift, staffId].join('|');
    if (data.reset) {
      await db.collection('attendance').deleteOne({ _id });
    } else {
      const absent = !!data.absent;
      let tin = '', tout = '';
      if (!absent) {
        tin = TS.normTime(data.in); tout = TS.normTime(data.out);
        if (!tin || !tout) fail('Giờ vào/ra không hợp lệ (dạng 19:00).');
        if (tin === tout) fail('Giờ vào và giờ ra không được trùng nhau.');
      }
      await db.collection('attendance').updateOne({ _id }, { $set: { week, day, shift, staffId, absent, in: tin, out: tout,
        note: String(data.note || '').slice(0, 200), by: ctx.user.name, at: new Date() } }, { upsert: true });
    }
    return timesheetOf(db, week);
  },

  /** Xuất Excel giống bảng lương của quán. Trả về base64 để tải về. */
  async exportTimesheet(db, ctx, week) {
    checkWeek(week);
    const ts = await timesheetOf(db, week);
    const buf = await require('../lib/excel').buildWorkbook(ts, week, DAYS);
    const [y, m, d] = week.split('-');
    return { filename: `Luong-tuan-${d}-${m}-${y}.xlsx`, data: Buffer.from(buf).toString('base64') };
  },

  /** Xóa hẳn: bỏ nhân viên và các ca đăng ký / đã xếp từ tuần này trở đi. Lịch sử tuần trước vẫn giữ. */
  async deleteStaff(db, ctx, id) {
    id = String(id || '');
    const r = await db.collection('staff').deleteOne({ _id: id });
    if (!r.deletedCount) fail('Không tìm thấy nhân viên (có thể đã bị xóa).');
    const cur = currentMonday();
    await Promise.all(['registrations', 'assignments', 'attendance'].map(c =>
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
    const cur = await settings(db);
    let hourlyRate = cur.hourlyRate;
    if (s.hourlyRate !== undefined && String(s.hourlyRate).trim() !== '') {
      hourlyRate = parseInt(String(s.hourlyRate).replace(/[^\d]/g, ''), 10);
      if (!(hourlyRate >= 0) || hourlyRate > 10000000) fail('Lương mặc định/giờ không hợp lệ.');
    }
    await db.collection('settings').updateOne({ _id: 'app' }, { $set: { shopName, shifts, hourlyRate, updatedAt: new Date() } }, { upsert: true });
    return { shopName, shifts, hourlyRate };
  }
};

async function timesheetOf(db, week) {
  const [assignments, attendance, staff, st] = await Promise.all([
    db.collection('assignments').find({ week }).toArray(),
    db.collection('attendance').find({ week }).toArray(),
    staffList(db), settings(db)
  ]);
  const ts = TS.buildTimesheet({ assignments, attendance, staff, settings: st, days: DAYS });
  ts.week = week;
  ts.shifts = st.shifts;
  return ts;
}

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
      if (CFG.ownerPassword() && A.safeEqual(pin, CFG.ownerPassword())) fail('Mã PIN không được trùng mật khẩu chủ quán.');
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

/** Dịch lỗi kỹ thuật thành hướng dẫn sửa cụ thể (hiện cả ở /api và trong app). */
function explainError(e) {
  const m = String((e && e.message) || e || '');
  const n = String((e && e.name) || '');
  if (/Chưa nhập mật khẩu database|Không tải được khóa xác minh của Google/.test(m)) return m;
  const uri = CFG.mongoUri();
  if (/<db_password>|%3Cdb_password%3E/i.test(uri))
    return 'Chuỗi kết nối vẫn còn chữ <db_password> – hãy nhập mật khẩu thật vào DB_PASSWORD trong config.js.';
  const auth = (uri.match(/^mongodb(?:\+srv)?:\/\/([^/?]*)/) || [])[1] || '';
  if ((auth.match(/@/g) || []).length > 1)
    return 'Mật khẩu trong MONGODB_URI có ký tự @ chưa mã hóa – đổi @ thành %40 (hoặc đặt mật khẩu database chỉ gồm chữ và số).';
  if (n === 'MongoParseError' || /Invalid scheme|URI must include|mongodb\+srv URI|Password contains unescaped|Username contains unescaped|URI malformed/i.test(m))
    return 'MONGODB_URI viết sai định dạng. Kiểm tra lại chuỗi kết nối; nếu mật khẩu có ký tự đặc biệt (@ : / ? # %) phải mã hóa URL. Chi tiết: ' + m.slice(0, 120);
  if (/authentication failed|bad auth|AuthenticationFailed/i.test(m))
    return 'Sai mật khẩu database (DB_PASSWORD trong config.js). Kiểm tra lại, hoặc đặt mật khẩu mới ở MongoDB Atlas → Database Access.';
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(m))
    return 'Không tìm thấy cụm MongoDB – kiểm tra DB_HOST (…mongodb.net) trong config.js.';
  if (n === 'MongoServerSelectionError' || /ECONNREFUSED|Server selection|timed out|ETIMEDOUT|ECONNRESET|SSL|TLS/i.test(m))
    return 'Không kết nối được MongoDB. Vào MongoDB Atlas → Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0).';
  if (/not authorized|Unauthorized|requires authentication/i.test(m))
    return 'Database user chưa có quyền ghi. MongoDB Atlas → Database Access → Edit → Read and write to any database.';
  return 'Lỗi máy chủ: ' + m.slice(0, 160);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET') {                                /* kiểm tra nhanh: mở /api trên trình duyệt */
    try { const db = await getDb(); await db.command({ ping: 1 });
      return res.status(200).end(JSON.stringify({ ok: true, db: 'connected',
        googleLogin: !!googleClientId(), ownerEmails: ownerEmails().length,
        ownerPassword: !!CFG.ownerPassword() })); }
    catch (e) { console.error('health', e); return res.status(500).end(JSON.stringify({ ok: false, error: explainError(e), detail: String(e && e.message || '').slice(0, 200) })); }
  }
  if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const fnName = String((body && body.fn) || '');
  const args = Array.isArray(body && body.args) ? body.args : [];
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  try {
    const db = await getDb();
    const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim().slice(0, 64);
    const ctx = { user: await currentUser(db, token), ip };
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
    const msg = explainError(e);
    return res.status(500).end(JSON.stringify({ error: msg }));
  }
};
