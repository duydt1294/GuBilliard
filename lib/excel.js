'use strict';
/**
 * Xuất bảng lương tuần ra Excel theo đúng mẫu quán đang dùng:
 *   A: TÊN NV | mỗi ngày Thứ 2 → Chủ nhật: VÀO, RA, TỔNG NGÀY | W: TỔNG TUẦN | X: LƯƠNG (nghìn/giờ) | Y: TỔNG TIỀN
 * Ô giờ là giờ thật của Excel (định dạng h:mm). TỔNG NGÀY / TỔNG TUẦN / TỔNG TIỀN là công thức,
 * nên sửa giờ trong Excel thì tự tính lại; ca qua nửa đêm xử lý bằng MOD(ra - vào, 1).
 * Sheet thứ 2 "Chi tiết ca" liệt kê từng ca để đối chiếu.
 */
const ExcelJS = require('exceljs');
const { toMin } = require('./timesheet');

const FONT = 'Times New Roman';
const thin = { style: 'thin', color: { argb: 'FF8C8C8C' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const HEAD_FILL = fill('FFFCE4D6');      /* đào nhạt – tiêu đề ngày */
const NAME_FILL = fill('FFDDEBF7');      /* xanh xám nhạt – cột tên */
const TOTAL_FILL = fill('FFEDEDED');
const EDIT_FILL = fill('FFFFF2CC');      /* vàng nhạt – giờ đã được chủ quán sửa */
const RED_FILL = fill('FFE03C31');

const timeVal = t => (t ? toMin(t) / 1440 : null);
const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const dm = (iso, add) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + add); return { d: d.getUTCDate(), m: d.getUTCMonth() + 1, y: d.getUTCFullYear() }; };

async function buildWorkbook(ts, week, days) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lịch ca Gu Billiard';
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('Lương tuần', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  });

  const nDays = days.length;
  const dayCol = i => 2 + i * 3;                  /* B, E, H, K, N, Q, T */
  const C_WEEK = 2 + nDays * 3;                  /* W */
  const C_RATE = C_WEEK + 1, C_PAY = C_WEEK + 2; /* X, Y */

  /* Độ rộng cột */
  ws.getColumn(1).width = 22;
  for (let i = 0; i < nDays; i++) { ws.getColumn(dayCol(i)).width = 7.5; ws.getColumn(dayCol(i) + 1).width = 7.5; ws.getColumn(dayCol(i) + 2).width = 7; }
  ws.getColumn(C_WEEK).width = 12; ws.getColumn(C_RATE).width = 10; ws.getColumn(C_PAY).width = 15;

  /* Tiêu đề */
  const a = dm(week, 0), b = dm(week, nDays - 1);
  const title = ws.getCell('A2');
  title.value = `TÍNH LƯƠNG TUẦN (${a.d}/${a.m}-${b.d}/${b.m}/${b.y})`;
  title.font = { name: FONT, size: 13, bold: true, italic: true };

  /* Hàng tiêu đề bảng (3–4) */
  const head = (r, c, v, opt = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { name: FONT, size: opt.size || 12, bold: true, italic: !!opt.italic, color: opt.color ? { argb: opt.color } : undefined };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = opt.fill || HEAD_FILL;
    cell.border = BORDER;
    return cell;
  };
  ws.mergeCells(3, 1, 4, 1); head(3, 1, 'TÊN NV', { fill: NAME_FILL });
  for (let i = 0; i < nDays; i++) {
    const c = dayCol(i);
    head(3, c + 1, null); head(3, c, days[i].toUpperCase()); ws.mergeCells(3, c, 3, c + 1);   /* gộp SAU khi ghi, tránh ô phụ đè mất tên ngày */
    head(4, c, 'VÀO'); head(4, c + 1, 'RA');
    ws.mergeCells(3, c + 2, 4, c + 2); head(3, c + 2, 'TỔNG NGÀY', { size: 9, fill: TOTAL_FILL });
  }
  ws.mergeCells(3, C_WEEK, 4, C_WEEK); head(3, C_WEEK, 'TỔNG TUẦN', { italic: true, fill: TOTAL_FILL });
  ws.mergeCells(3, C_RATE, 4, C_RATE); head(3, C_RATE, 'LƯƠNG', { italic: true, fill: TOTAL_FILL });
  ws.mergeCells(3, C_PAY, 4, C_PAY); head(3, C_PAY, 'TỔNG TIỀN', { italic: true, fill: TOTAL_FILL });
  ws.getRow(3).height = 22; ws.getRow(4).height = 20;

  /* Ô chỉnh sửa / nghỉ để tô màu */
  const editedDay = {}, absentDay = {}, workedDay = {};
  ts.records.forEach(r => {
    const k = r.staffId + '|' + r.day;
    if (r.absent) absentDay[k] = true; else workedDay[k] = true;
    if (r.edited && !r.absent) editedDay[k] = true;
  });

  /* Dữ liệu */
  const first = 5;
  ts.people.forEach((p, idx) => {
    const row = first + idx;
    const body = (c, v, opt = {}) => {
      const cell = ws.getCell(row, c);
      cell.value = v;
      cell.font = { name: FONT, size: 12, italic: true, bold: !!opt.bold, color: opt.color ? { argb: opt.color } : undefined };
      cell.alignment = { horizontal: opt.left ? 'left' : 'center', vertical: 'middle' };
      cell.border = BORDER;
      if (opt.fmt) cell.numFmt = opt.fmt;
      if (opt.fill) cell.fill = opt.fill;
      return cell;
    };
    body(1, p.name, { bold: true, left: true, fill: NAME_FILL });
    for (let i = 0; i < nDays; i++) {
      const c = dayCol(i), d = p.days[i], k = p.id + '|' + i;
      const ef = editedDay[k] ? EDIT_FILL : undefined;
      const L = colL(c), R = colL(c + 1);
      if (d.merged.length) {
        body(c, timeVal(d.in), { fmt: 'h:mm', fill: ef });
        body(c + 1, timeVal(d.out), { fmt: 'h:mm', fill: ef });
        if (d.merged.length === 1) {
          body(c + 2, { formula: `IF(COUNT(${L}${row}:${R}${row})<2,0,MOD(${R}${row}-${L}${row},1)*24)` }, { fmt: '0.0', fill: TOTAL_FILL });
        } else {
          /* Nhiều ca rời nhau trong ngày (vd 9:00–14:00 và 19:00–0:00): ghi tổng giờ + chú thích từng ca */
          const cell = body(c + 2, Math.round(d.minutes / 60 * 1000) / 1000, { fmt: '0.0', fill: TOTAL_FILL });
          cell.note = d.merged.map(s => `${s.in}–${s.out}`).join(', ');
        }
      } else {
        const off = absentDay[k] && !workedDay[k];
        body(c, off ? 'Nghỉ' : null, off ? { color: 'FFC00000' } : {});
        body(c + 1, null);
        body(c + 2, { formula: `IF(COUNT(${L}${row}:${R}${row})<2,0,MOD(${R}${row}-${L}${row},1)*24)` }, { fmt: '0.0', fill: TOTAL_FILL });
      }
    }
    const sumRefs = Array.from({ length: nDays }, (_, i) => colL(dayCol(i) + 2) + row).join(',');
    body(C_WEEK, { formula: `SUM(${sumRefs})` }, { fmt: '0.0', bold: true, fill: TOTAL_FILL });
    body(C_RATE, p.rate / 1000, { fmt: 'General' });
    body(C_PAY, { formula: `ROUND(${colL(C_WEEK)}${row}*${colL(C_RATE)}${row}*1000,0)` }, { fmt: '#,##0', bold: true });
    ws.getRow(row).height = 21;
  });

  /* Dòng tổng */
  const last = first + Math.max(ts.people.length, 1) - 1;
  const tr = last + 1;
  const tw = ws.getCell(tr, C_WEEK);
  tw.value = 'TỔNG TIỀN'; tw.font = { name: FONT, size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  tw.fill = RED_FILL; tw.alignment = { horizontal: 'center', vertical: 'middle' }; tw.border = BORDER;
  const tv = ws.getCell(tr, C_RATE);
  tv.value = 'VND'; tv.font = { name: FONT, size: 12, bold: true }; tv.alignment = { horizontal: 'center' }; tv.border = BORDER;
  const tp = ws.getCell(tr, C_PAY);
  tp.value = ts.people.length ? { formula: `SUM(${colL(C_PAY)}${first}:${colL(C_PAY)}${last})` } : 0;
  tp.numFmt = '#,##0'; tp.font = { name: FONT, size: 12, bold: true }; tp.alignment = { horizontal: 'right' }; tp.border = BORDER;
  ws.getRow(tr).height = 22;

  const note = ws.getCell(tr + 2, 1);
  note.value = 'Ghi chú: LƯƠNG tính theo nghìn đồng/giờ. Ô vàng = giờ đã được chỉnh so với giờ ca. TỔNG NGÀY tự tính, ca qua nửa đêm được cộng sang hôm sau.';
  note.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF666666' } };

  /* Sheet 2: chi tiết từng ca */
  const ds = wb.addWorksheet('Chi tiết ca', { views: [{ state: 'frozen', ySplit: 1 }] });
  ds.columns = [
    { header: 'Ngày', key: 'day', width: 14 }, { header: 'Ca', key: 'shift', width: 8 },
    { header: 'Nhân viên', key: 'name', width: 22 }, { header: 'Giờ ca', key: 'def', width: 14 },
    { header: 'Vào', key: 'in', width: 8 }, { header: 'Ra', key: 'out', width: 8 },
    { header: 'Số giờ', key: 'h', width: 8 }, { header: 'Trạng thái', key: 'st', width: 14 }, { header: 'Ghi chú', key: 'note', width: 30 }
  ];
  ds.getRow(1).eachCell(c => { c.font = { name: FONT, bold: true }; c.fill = HEAD_FILL; c.border = BORDER; });
  ts.records.forEach(r => {
    const dd = dm(week, r.day);
    const row = ds.addRow({
      day: `${days[r.day]} ${dd.d}/${dd.m}`, shift: r.shiftName, name: r.name,
      def: r.defIn && r.defOut ? `${r.defIn}–${r.defOut}` : '',
      in: r.absent ? null : timeVal(r.in), out: r.absent ? null : timeVal(r.out),
      h: Math.round(r.minutes / 60 * 100) / 100,
      st: r.absent ? 'Nghỉ' : (r.edited ? 'Đã sửa giờ' : (r.noTime ? 'Chưa có giờ' : 'Đúng giờ ca')), note: r.note
    });
    row.getCell('in').numFmt = 'h:mm'; row.getCell('out').numFmt = 'h:mm'; row.getCell('h').numFmt = '0.0#';
    row.eachCell(c => { c.border = BORDER; c.font = { name: FONT }; });
    if (r.absent) row.getCell('st').font = { name: FONT, color: { argb: 'FFC00000' } };
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
