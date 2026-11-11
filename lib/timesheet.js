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

/** Phút → giờ, làm tròn 2 số thập phân (10 phút → 0,17; 2 giờ 14 phút → 2,23). m*5/3 = m/60*100 nhưng không sai số. */
const hours2 = m => Math.round((m || 0) * 5 / 3) / 100;

/** Hiển thị kiểu bảng Excel của quán: "9:00", "0:30", "14:00". */
const showTime = t => (t ? String(+t.split(':')[0]) + ':' + t.split(':')[1] : '');

/**
 * Dựng bảng chấm công cho 1 tuần.
 * @param assignments [{day, shift, staffId, name, defIn?, defOut?}]
 * @param attendance  [{day, shift, staffId, absent, in, out, note}]  – chủ quán sửa (ưu tiên cao nhất)
 * @param clocks      [{day, shift, staffId, name, in, out, inGap, outGap, noteIn, noteOut}] – nhân viên tự chấm công
 * @param staff       [{id, name, rate?, active}]
 * @param settings    {shifts:[{name,time}], hourlyRate}
 * @param days        tên các ngày
 */
function buildTimesheet({ assignments, attendance, staff, settings, days, clocks, week, today, clockFrom }) {
  /* Ngày (yyyy-MM-dd) của từng thứ trong tuần – để biết ca nào thuộc giai đoạn bắt buộc tự chấm công */
  const dateOf = d => { if (!week) return ''; const x = new Date(week + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const rateDefault = Number(settings.hourlyRate) || 0;
  const byId = {}; staff.forEach(s => { byId[s.id] = s; });
  const keyOf = a => a.day + '-' + a.shift + '-' + a.staffId;
  const att = {}; attendance.forEach(a => { att[keyOf(a)] = a; });
  const clk = {}; (clocks || []).forEach(c => { clk[keyOf(c)] = c; });

  /* Ca tự nhận mà không có trong lịch đã xếp → vẫn tính công, đánh dấu "ngoài lịch". */
  const asgKeys = new Set(assignments.map(keyOf));
  const extras = (clocks || []).filter(c => !asgKeys.has(keyOf(c)))
    .map(c => ({ day: c.day, shift: c.shift, staffId: c.staffId, name: c.name, extra: true }));

  const records = assignments.concat(extras).filter(a => a.day >= 0 && a.day < days.length && a.shift >= 0 && a.shift < settings.shifts.length)
    .map(a => {
      const sh = settings.shifts[a.shift] || {};
      const def = (a.defIn && a.defOut) ? { start: a.defIn, end: a.defOut } : parseShiftTime(sh.time);
      const k = keyOf(a), o = att[k], c = clk[k];
      const absent = !!(o && o.absent);
      const date = dateOf(a.day);
      const required = !!(clockFrom && date && date >= clockFrom);       /* từ ngày này: không bấm chấm công = 0 giờ */
      let tin = '', tout = '', src;
      if (absent) src = o ? 'owner' : 'default';                            /* nghỉ: 0 giờ */
      else if (o) { src = 'owner'; tin = o.in || ''; tout = o.out || ''; } /* chủ quán sửa → ưu tiên, giữ đúng giờ đã nhập */
      else if (c) {                                                         /* nhân viên tự chấm */
        src = 'clock';
        tin = c.in || '';
        tout = c.out || '';
        /* chưa kết ca: tạm tính tới hết giờ ca (nếu hợp lý) */
        if (!tout && def && tin && workedMinutes(tin, def.end) <= 16 * 60) tout = def.end;
      } else if (required) src = today && date < today ? 'noclock' : 'pending';   /* không chấm: 0 giờ, chờ chủ quán xác nhận */
      else { src = 'default'; tin = (def && def.start) || ''; tout = (def && def.end) || ''; }   /* trước ngày bắt buộc: đúng giờ ca */
      const raw = absent ? 0 : workedMinutes(tin, tout);
      const s = byId[a.staffId];
      return {
        day: a.day, shift: a.shift, staffId: a.staffId,
        name: s ? s.name : a.name, shiftName: sh.name || ('Ca ' + (a.shift + 1)),
        defIn: def ? def.start : '', defOut: def ? def.end : '',
        in: tin, out: tout, absent,
        edited: !!o, required, date,
        src,
        extra: !!a.extra,
        open: !!(c && !c.out),
        clock: c ? { in: c.in || '', out: c.out || '', inGap: c.inGap || 0, outGap: c.outGap || 0,
                     inAt: c.inAt || null, outAt: c.outAt || null,
                     approved: !!c.approvedAt, approvedBy: c.approvedBy || '' } : null,
        note: (o && o.note) || (c ? [c.noteIn, c.noteOut].filter(Boolean).join(' · ') : ''),
        noTime: !absent && (src === 'owner' || src === 'clock' || src === 'default') && (!tin || !tout),
        minutes: raw
      };
    })
    .sort((x, y) => x.day - y.day || x.shift - y.shift || x.name.localeCompare(y.name, 'vi'));

  /* Ca trong lịch mà nhân viên không bấm riêng, nhưng nằm trong khoảng giờ đã tự chấm của ca khác cùng ngày
     (vd làm Ca 1 + Ca 2 liền nhau, chỉ nhận ca 1 lần 9:00 → 19:00) → không cộng thêm giờ ca lần nữa. */
  const span = (a, b) => { let x = toMin(a); if (x < 360) x += 1440; let y = toMin(b); if (y < 360) y += 1440; if (y <= x) y += 1440; return [x, y]; };
  const clocked = {};
  records.filter(r => r.src === 'clock' && r.in && r.out).forEach(r => {
    (clocked[r.staffId + '|' + r.day] = clocked[r.staffId + '|' + r.day] || []).push({ s: span(r.in, r.out), r });
  });
  records.filter(r => ['default', 'noclock', 'pending'].includes(r.src) && !r.absent && r.defIn && r.defOut).forEach(r => {
    const [a, b] = span(r.defIn, r.defOut);
    const hit = (clocked[r.staffId + '|' + r.day] || []).find(c => c.s[0] < b && a < c.s[1]);
    if (!hit) return;
    Object.assign(r, { src: 'covered', in: '', out: '', minutes: 0, noTime: false,
      coveredBy: { shiftName: hit.r.shiftName, in: hit.r.in, out: hit.r.out } });
  });

  /* Tổng hợp theo nhân viên, gộp các ca trong cùng một ngày. */
  const per = {};
  records.forEach(r => {
    const p = per[r.staffId] = per[r.staffId] || {
      id: r.staffId, name: r.name,
      rate: (byId[r.staffId] && Number(byId[r.staffId].rate)) || rateDefault,
      minutes: 0, shifts: 0, absents: 0, noclock: 0, days: days.map(() => ({ segs: [], minutes: 0 }))
    };
    if (r.absent) { p.absents++; return; }
    if (r.src === 'noclock' || r.src === 'pending') { p.noclock++; return; }
    p.shifts++;
    p.minutes += r.minutes;
    p.days[r.day].minutes += r.minutes;
    if (r.in && r.out) p.days[r.day].segs.push({ in: r.in, out: r.out, minutes: r.minutes });
  });

  const people = Object.values(per).map(p => {
    p.days.forEach(d => {
      /* Sắp theo giờ vào (giờ trước 6:00 sáng tính là đêm cùng ngày, xếp sau ca tối);
         gộp các ca liền nhau (ra ca trước = vào ca sau) thành 1 đoạn. */
      const ord = t => { const m = toMin(t); return m < 360 ? m + 1440 : m; };
      d.segs.sort((a, b) => ord(a.in) - ord(b.in));
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
    /* Lương tính theo thời gian thực tế (như bảng lương của quán); giờ chỉ hiển thị 2 số thập phân */
    p.hours = hours2(p.minutes);
    p.pay = Math.round(p.minutes * p.rate / 60);
    return p;
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return {
    records, people,
    totals: {
      minutes: people.reduce((s, p) => s + p.minutes, 0),
      hours: hours2(people.reduce((s, p) => s + p.minutes, 0)),
      pay: people.reduce((s, p) => s + p.pay, 0),
      edited: records.filter(r => r.edited && !r.absent).length,
      clocked: records.filter(r => r.src === 'clock').length,
      extra: records.filter(r => r.extra).length,
      open: records.filter(r => r.open && !r.edited).length,
      noclock: records.filter(r => r.src === 'noclock').length,
      toApprove: records.filter(r => r.clock && r.clock.out && !r.clock.approved).length,
      pending: records.filter(r => r.src === 'pending').length,
      absents: records.filter(r => r.absent).length,
      noTime: records.filter(r => r.noTime).length
    },
    rateDefault, clockFrom: clockFrom || ''
  };
}

module.exports = { parseShiftTime, normTime, workedMinutes, showTime, buildTimesheet, toMin, hours2 };
