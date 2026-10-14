# 🎱 Gu Billiard – Đăng ký & xếp ca

Web app cho quán bida: nhân viên đăng ký ca hằng tuần (Thứ 2 – Thứ 7, 3 ca/ngày) trên điện thoại, chủ quán/người quản lý duyệt, xếp ca và công bố lịch.

- **Nhân viên:** mở link → chọn tên → chạm ô để đăng ký ca. Không cần tài khoản.
- **Chủ quán:** đăng nhập bằng mật khẩu (`OWNER_PASSWORD`). Tạo mã PIN cho từng người quản lý.
- **Người quản lý:** đăng nhập bằng mã PIN, xếp ca, quản lý nhân viên.
- Chạy trên **Vercel** (miễn phí), dữ liệu lưu ở **MongoDB Atlas** (miễn phí).

## Cấu trúc

```
public/index.html   Giao diện (tối ưu điện thoại, cài được lên màn hình chính)
api/index.js        API duy nhất – Vercel Function
lib/db.js           Kết nối MongoDB (dùng lại giữa các lần gọi)
lib/auth.js         Mật khẩu chủ quán, mã PIN, token phiên đăng nhập
scripts/dev-server.js  Chạy thử trên máy (npm run dev)
```

Collection trong MongoDB (tự tạo khi dùng): `staff`, `registrations`, `assignments`, `weeks`, `settings`, `managers`.

## Triển khai

### 1. MongoDB Atlas

1. **Database Access**: user `duydemo1294` cần quyền *Read and write to any database*. Ghi lại mật khẩu.
2. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**. Bắt buộc vì Vercel không có IP cố định.
3. Chuỗi kết nối (thay `<db_password>`; nếu mật khẩu có ký tự đặc biệt `@ : / ? # %` thì phải [mã hóa URL](https://www.urlencoder.org/)):
   ```
   mongodb+srv://duydemo1294:<db_password>@duydt19.ayap1vy.mongodb.net/?retryWrites=true&w=majority&appName=Duydt19
   ```

### 2. Vercel

1. Vào [vercel.com](https://vercel.com) → đăng nhập bằng GitHub → **Add New… → Project** → chọn repo **GuBilliard** → **Import**.
2. *Framework Preset*: **Other**. Không cần sửa Build Command / Output Directory.
3. Mở **Environment Variables**, thêm:

   | Tên | Giá trị |
   |---|---|
   | `MONGODB_URI` | Chuỗi kết nối ở bước 1 |
   | `OWNER_PASSWORD` | Mật khẩu chủ quán (tự đặt, dài, khó đoán) |
   | `SESSION_SECRET` | Một dãy ký tự ngẫu nhiên dài (vd 40 ký tự) |

4. Bấm **Deploy**. Xong sẽ có link dạng `https://gubilliard.vercel.app`.
5. Kiểm tra: mở `https://<link>/api` → thấy `{"ok":true,"db":"connected","ownerPassword":true}` là thành công.

Sau này mỗi lần đẩy code lên nhánh `main`, Vercel tự triển khai lại. Đổi biến môi trường thì vào **Deployments → … → Redeploy** để áp dụng.

### 3. Dùng lần đầu

1. Mở link → **Chủ quán đăng nhập** → nhập `OWNER_PASSWORD`.
2. Tab **⚙️ Cài đặt**: sửa tên quán, giờ 3 ca, số người cần mỗi ca → Lưu. Thêm người quản lý + mã PIN (nếu có).
3. Tab **👥 Nhân viên**: thêm nhân viên.
4. Gửi link vào nhóm Zalo. Nhắc nhân viên **Thêm vào màn hình chính** để mở như ứng dụng.

## Quy trình hằng tuần

Nhân viên đăng ký → chủ quán **🔒 Khóa đăng ký** → xếp ca (hoặc **⚡ Xếp nhanh**) → **📢 Công bố lịch** → app tạo sẵn tin nhắn để dán vào nhóm Zalo.

## Bảo mật

- Quên/đổi mật khẩu chủ quán: sửa `OWNER_PASSWORD` trên Vercel rồi Redeploy. Mọi phiên đăng nhập cũ của chủ quán mất hiệu lực.
- Đổi PIN hoặc xóa người quản lý: người đó bị đăng xuất ngay.
- Đổi `SESSION_SECRET`: đăng xuất tất cả mọi người.
- Không bao giờ đưa mật khẩu database hay file `.env` lên GitHub.

## Chạy thử trên máy

```bash
npm install
cp .env.example .env     # điền MONGODB_URI, OWNER_PASSWORD, SESSION_SECRET
npm run dev              # mở http://localhost:3000
```
