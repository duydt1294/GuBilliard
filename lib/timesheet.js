'use strict';
/**
 * Chấm công & tính lương – dùng chung cho màn hình Chấm công và file Excel.
 *  - Ai được xếp ca mà chủ quán không sửa gì → coi như đi làm đúng giờ ca.
 *  - Chủ quán có thể sửa giờ vào/ra thực tế hoặc đánh dấu nghỉ.
 *  - Giờ ra nhỏ hơn hoặc bằng giờ vào → hiểu là ra vào ngày hôm sau (ca qua nửa đêm).
 */

/** "08:00 - 14:00", "8h-14h", "20:00 – 02:00", "19h30-1h" → { start: 'HH:MM', end: 'HH:MM' } hoặc null. */
function parseShiftTime(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(?:[:hg.]\s*(\d{2})?)?\s*[-–—~đến]+\s*(\d{1,2})\s*(?:[:hg.]\s*(\d{2})?)?/i);
  if (!m) return null;
  const h1 = +m[1], m1 = +(m[2] || 0), h2 = +m[3], m2 = +(m[4] || 0);
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  return { start: hhmm(h1 % 24, m1), end: hhmm(h2 % 24, m2) };
}

const pad = n => String(n).padStart(2, '0');
const hhmm = (h, m) => pad(h) + ':' + pad(m);

/** 'H:MM' / 'HH:MM' hợp lệ → 'HH:MM', sai → null. */
function normTime(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})[:hg.](\d{2})$/i);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return hhmm(+m[1], +m[2]);
}

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Số phút làm việc; ra ≤ vào thì cộng 24 giờ (qua nửa đêm). */
function workedMinutes(tin, tout) {
  if (!tin || !tout) return 0;
  let d = toMin(tout) - toMin(tin);
  if (d <= 0) d += 1440;
  return d;
}

/** Hiển thị kiểu bảng Excel của quán: "9:00", "0:30", "14:00". */
const showTime = t => (t ? String(+t.split(':')[0]) + ':' + t.split(':')[1] : '');

/**
 * Dựng bảng chấm công cho 1 tuần.
 * @param assignments [{day, shift, staffId, name, defIn?, defOut?}]
 * @param attendance  [{day, shift, staffId, absent, in, out, note}]
 * @param staff       [{id, name, rate?, active}]
 * @param settings    {shifts:[{name,time}], hourlyRate}
 * @param days        tên các ngày
 */
function buildTimesheet({ assignments, attendance, staff, settings, days }) {
  const rateDefault = Number(settings.hourlyRate) || 0;
  const byId = {}; staff.forEach(s => { byId[s.id] = s; });
  const att = {}; attendance.forEach(a => { att[a.day + '-' + a.shift + '-' + a.staffId] = a; });

  const records = assignments.filter(a => a.day >= 0 && a.day < days.length && a.shift >= 0 && a.shift < settings.shifts.length)
    .map(a => {
      const sh = settings.shifts[a.shift] || {};
      const def = (a.defIn && a.defOut) ? { start: a.defIn, end: a.defOut } : parseShiftTime(sh.time);
      const o = att[a.day + '-' + a.shift + '-' + a.staffId];
      const absent = !!(o && o.absent);
      const tin = absent ? '' : ((o && o.in) || (def && def.start) || '');
      const tout = absent ? '' : ((o && o.out) || (def && def.end) || '');
      const s = byId[a.staffId];
      return {
        day: a.day, shift: a.shift, staffId: a.staffId,
        name: s ? s.name : a.name, shiftName: sh.name || ('Ca ' + (a.shift + 1)),
        defIn: def ? def.start : '', defOut: def ? def.end : '',
        in: tin, out: tout, absent,
        edited: !!o, note: (o && o.note) || '',
        noTime: !absent && (!tin || !tout),
        minutes: absent ? 0 : workedMinutes(tin, tout)
      };
    })
    .sort((x, y) => x.day - y.day || x.shift - y.shift || x.name.localeCompare(y.name, 'vi'));

  /* Tổng hợp theo nhân viên, gộp các ca trong cùng một ngày. */
  const per = {};
  records.forEach(r => {
    const p = per[r.staffId] = per[r.staffId] || {
      id: r.staffId, name: r.name,
      rate: (byId[r.staffId] && Number(byId[r.staffId].rate)) || rateDefault,
      minutes: 0, shifts: 0, absents: 0, days: days.map(() => ({ segs: [], minutes: 0 }))
    };
    if (r.absent) { p.absents++; return; }
    p.shifts++;
    p.minutes += r.minutes;
    p.days[r.day].minutes += r.minutes;
    if (r.in && r.out) p.days[r.day].segs.push({ in: r.in, out: r.out, minutes: r.minutes });
  });

  const people = Object.values(per).map(p => {
    p.days.forEach(d => {
      /* Sắp theo giờ vào; gộp các ca liền nhau (ra ca trước = vào ca sau) thành 1 đoạn. */
      d.segs.sort((a, b) => toMin(a.in) - toMin(b.in));
      const merged = [];
      d.segs.forEach(sg => {
        const last = merged[merged.length - 1];
        if (last && sg.in === last.out) { last.out = sg.out; last.minutes += sg.minutes; }
        else merged.push(Object.assign({}, sg));
      });
      d.merged = merged;
      d.in = merged.length ? merged[0].in : '';
      d.out = merged.length ? merged[merged.length - 1].out : '';
    });
    p.hours = Math.round(p.minutes / 6) / 10;
    p.pay = Math.round(p.minutes * p.rate / 60);
    return p;
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return {
    records, people,
    totals: {
      minutes: people.reduce((s, p) => s + p.minutes, 0),
      pay: people.reduce((s, p) => s + p.pay, 0),
      edited: records.filter(r => r.edited && !r.absent).length,
      absents: records.filter(r => r.absent).length,
      noTime: records.filter(r => r.noTime).length
    },
    rateDefault
  };
}

module.exports = { parseShiftTime, normTime, workedMinutes, showTime, buildTimesheet, toMin };
