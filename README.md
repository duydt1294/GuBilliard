# 🎱 Gu Billiard – Đăng ký & xếp ca

Web app cho quán bida: nhân viên đăng ký ca hằng tuần (Thứ 2 – Chủ nhật, 3 ca/ngày) trên điện thoại, chủ quán/người quản lý duyệt, xếp ca và công bố lịch.

- **Nhân viên:** mở link → chọn tên → chạm ô để đăng ký ca. Không cần tài khoản.
- **Chủ quán:** đăng nhập bằng **Gmail** (có sẵn `duydemo1294@gmail.com`, `hangochien2023@gmail.com`) (mật khẩu dự phòng `OWNER_PASSWORD` trong `config.js`, mặc định tắt). Tạo mã PIN cho từng người quản lý.
- **Người quản lý:** đăng nhập bằng mã PIN, xếp ca, chấm công, quản lý nhân viên.
- **Chấm công & lương:** ai được xếp ca coi như đi làm đúng giờ ca; chủ quán chỉ sửa giờ vào/ra thực tế hoặc đánh dấu nghỉ. App tự tính giờ (kể cả ca qua nửa đêm) và lương, **xuất Excel** đúng mẫu bảng lương của quán.
- Chạy trên **Vercel** (miễn phí), dữ liệu lưu ở **MongoDB Atlas** (miễn phí).

## Cấu trúc

```
config.js           ⚙️ Cấu hình (mật khẩu database, Gmail chủ quán, Google Client ID)
public/index.html   Giao diện (tối ưu điện thoại, cài được lên màn hình chính)
api/index.js        API duy nhất – Vercel Function
lib/db.js           Kết nối MongoDB (dùng lại giữa các lần gọi)
lib/config.js       Đọc cấu hình (biến môi trường → config.js)
lib/auth.js         Mật khẩu chủ quán, mã PIN, token phiên đăng nhập
lib/google.js       Xác minh đăng nhập Gmail (Sign in with Google)
lib/timesheet.js    Chấm công & tính lương (giờ ca, sửa giờ, nghỉ, qua nửa đêm)
lib/excel.js        Xuất bảng lương tuần ra Excel
scripts/dev-server.js  Chạy thử trên máy (npm run dev)
```

Collection trong MongoDB (tự tạo khi dùng): `staff`, `registrations`, `assignments`, `attendance` (giờ đã sửa / nghỉ), `weeks`, `settings`, `managers`, `loginFails`.

## Triển khai

Toàn bộ cấu hình nằm trong **`config.js`** ở gốc repo – **không cần đặt biến môi trường trên Vercel**.

### 1. Nhập mật khẩu database

Mở `config.js`, sửa đúng một dòng:

```js
DB_PASSWORD: 'NHAP_MAT_KHAU_DATABASE_VAO_DAY',
```

thành mật khẩu của database user `duydemo1294` (gõ mật khẩu gốc, app tự mã hóa ký tự đặc biệt). Các giá trị khác (Gmail chủ quán, Google Client ID, khóa phiên) đã điền sẵn.

### 2. MongoDB Atlas

- **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)** – bắt buộc vì Vercel không có IP cố định.
- **Database Access**: user `duydemo1294` có quyền *Read and write to any database*.

### 3. Google Cloud (đăng nhập Gmail)

Client `55981277953-70kk…` → **Authorized JavaScript origins** thêm `https://gubilliard.vercel.app` (không có `/` cuối). Mục **Audience**: *Publish app* hoặc thêm 2 Gmail chủ quán vào *Test users*. App **không dùng Client secret**.

### 4. Push & kiểm tra

```bash
git add .
git commit -m "Cấu hình"
git push
```

Vercel tự triển khai. Mở `https://gubilliard.vercel.app/api` → thấy `"ok":true,"db":"connected"` là xong. Nếu lỗi, trang này ghi rõ nguyên nhân và cách sửa.

> ⚠️ `config.js` chứa mật khẩu database. Nên để repo ở chế độ **Private** (GitHub → Settings → General → Danger Zone → Change visibility).
> `config.js` luôn được ưu tiên. Biến môi trường trên Vercel (nếu có) chỉ được dùng khi ô tương ứng trong `config.js` để trống – nên có thể xóa hết biến cũ trên Vercel.

### 5. Dùng lần đầu

1. Mở link → **Chủ quán đăng nhập** → **Đăng nhập bằng Google**.
2. Tab **⚙️ Cài đặt**: sửa tên quán, giờ 3 ca, số người cần mỗi ca → Lưu. Thêm người quản lý + mã PIN (nếu có).
3. Tab **👥 Nhân viên**: thêm nhân viên.
4. Gửi link vào nhóm Zalo. Nhắc nhân viên **Thêm vào màn hình chính** để mở như ứng dụng.

## Quy trình hằng tuần

Nhân viên đăng ký → chủ quán **🔒 Khóa đăng ký** → xếp ca (hoặc **⚡ Xếp nhanh**) → **📢 Công bố lịch** → app tạo sẵn tin nhắn để dán vào nhóm Zalo.

- Được **xếp dư** so với số người cần của ca (hiện màu xanh dương "dư N"). *Xếp nhanh* chỉ điền tới đủ số người cần.
- Nhiều người cùng xếp ca: nếu lịch vừa được người khác lưu, app báo và cho tải bản mới – không ghi đè mất dữ liệu của nhau.
- Nhân viên không sửa được đăng ký của các tuần đã qua.

## Chấm công & lương

1. Tab **👥 Nhân viên**: mỗi người có lương riêng tính theo **nghìn đồng/giờ** (mặc định **18**), bấm **−/+** ngay trên danh sách để giảm/tăng 1.000đ, hoặc chạm tên để nhập số (vd 18,5). Tab **⚙️ Cài đặt**: lương mặc định cho nhân viên mới và giờ từng ca dạng `09:00 - 14:00`.
2. Tab **💰 Chấm công** → chọn tuần → chọn ngày → chạm tên người:
   - **Đi làm**: sửa *giờ vào / giờ ra* thực tế (giờ ra nhỏ hơn giờ vào = ra hôm sau, vd 19:00 → 3:00 = 8 giờ).
   - **Nghỉ / bỏ ca**: ca đó tính 0 giờ.
   - **Đặt lại đúng giờ ca**: bỏ chỉnh sửa.
   - Không chạm gì = đi làm đúng giờ ca.
3. Bấm **📥 Xuất Excel bảng lương**: file gồm sheet *Lương tuần* (TÊN NV · Thứ 2 → Chủ nhật VÀO/RA/TỔNG NGÀY · TỔNG TUẦN · LƯƠNG · TỔNG TIỀN, dòng tổng đỏ) và sheet *Chi tiết ca*. Các cột tổng là công thức – sửa giờ trong Excel tự tính lại. Ô vàng = giờ đã chỉnh.

Người làm 2 ca liền nhau (vd Ca 1 + Ca 2) được gộp thành một khung giờ 9:00–19:00 trong Excel; 2 ca rời nhau trong ngày thì ô TỔNG NGÀY có chú thích từng ca.

## Bảo mật

- Đăng nhập Gmail được máy chủ xác minh chữ ký của Google, đúng Client ID của quán và email nằm trong danh sách chủ quán.
- Mở link trong Zalo/Facebook: Google chặn đăng nhập trong trình duyệt nhúng → bấm **⋯ → Mở bằng trình duyệt** (app có nhắc).
- Thêm/bớt Gmail chủ quán: sửa `OWNER_EMAILS` trong `config.js` rồi push.
- Đổi PIN hoặc xóa người quản lý: người đó bị đăng xuất ngay.
- Nhập sai mật khẩu/PIN quá 8 lần trong 15 phút: tạm khóa đăng nhập từ máy đó (đếm cả khi gửi hàng loạt cùng lúc); toàn hệ thống quá 60 lần sai cũng tạm khóa đăng nhập PIN – Gmail chủ quán vẫn vào được.
- Chỉ **chủ quán** sửa được lương (từng người và mức mặc định); người quản lý chỉ xem.
- Đổi `SESSION_SECRET` trong `config.js`: đăng xuất tất cả mọi người.

## Chạy thử trên máy

```bash
npm install
npm run dev              # mở http://localhost:3000
```
