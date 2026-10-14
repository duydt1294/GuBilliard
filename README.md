# 🎱 Gu Billiard – Đăng ký & xếp ca

Web app cho quán bida: nhân viên đăng ký ca hằng tuần (Thứ 2 – Thứ 7, 3 ca/ngày) trên điện thoại, chủ quán/người quản lý duyệt, xếp ca và công bố lịch.

- **Nhân viên:** mở link → chọn tên → chạm ô để đăng ký ca. Không cần tài khoản.
- **Chủ quán:** đăng nhập bằng **Gmail** (có sẵn `duydemo1294@gmail.com`, `hangochien2023@gmail.com`) hoặc mật khẩu dự phòng `OWNER_PASSWORD`. Tạo mã PIN cho từng người quản lý.
- **Người quản lý:** đăng nhập bằng mã PIN, xếp ca, quản lý nhân viên.
- Chạy trên **Vercel** (miễn phí), dữ liệu lưu ở **MongoDB Atlas** (miễn phí).

## Cấu trúc

```
public/index.html   Giao diện (tối ưu điện thoại, cài được lên màn hình chính)
api/index.js        API duy nhất – Vercel Function
lib/db.js           Kết nối MongoDB (dùng lại giữa các lần gọi)
lib/auth.js         Mật khẩu chủ quán, mã PIN, token phiên đăng nhập
lib/google.js       Xác minh đăng nhập Gmail (Sign in with Google)
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

### 2. Google Client ID (cho đăng nhập Gmail)

Làm sau khi đã có link Vercel (bước 3), rồi quay lại thêm biến `GOOGLE_CLIENT_ID`.

1. Vào [console.cloud.google.com](https://console.cloud.google.com) bằng Gmail chủ quán → tạo project mới (vd *GuBilliard*).
2. **APIs & Services → OAuth consent screen** (giao diện mới: **Google Auth Platform → Branding**): chọn **External**, điền tên ứng dụng *Lịch ca Gu Billiard*, email hỗ trợ → Lưu.
3. Mục **Audience** (hoặc *Publishing status*): bấm **Publish app** (chuyển sang *In production*). App chỉ xin email/tên nên **không cần Google xét duyệt**. Nếu để *Testing* thì phải thêm 2 Gmail chủ quán vào *Test users*.
4. **Credentials → Create credentials → OAuth client ID** (giao diện mới: **Clients → Create client**):
   - *Application type*: **Web application**
   - *Authorized JavaScript origins*: `https://<tên-app>.vercel.app` (và `http://localhost:3000` nếu chạy thử trên máy)
   - *Authorized redirect URIs*: để trống
5. Sao chép **Client ID** (dạng `xxxx.apps.googleusercontent.com`) → thêm vào Vercel biến `GOOGLE_CLIENT_ID` → **Redeploy**.

Thêm/bớt Gmail chủ quán: đặt biến `OWNER_EMAILS` trên Vercel, ví dụ `duydemo1294@gmail.com,hangochien2023@gmail.com,ban@gmail.com` → Redeploy.

### 3. Vercel

1. Vào [vercel.com](https://vercel.com) → đăng nhập bằng GitHub → **Add New… → Project** → chọn repo **GuBilliard** → **Import**.
2. *Framework Preset*: **Other**. Không cần sửa Build Command / Output Directory.
3. Mở **Environment Variables**, thêm:

   | Tên | Giá trị |
   |---|---|
   | `MONGODB_URI` | Chuỗi kết nối ở bước 1 |
   | `SESSION_SECRET` | Một dãy ký tự ngẫu nhiên dài (vd 40 ký tự) |
   | `GOOGLE_CLIENT_ID` | Client ID ở bước 2 (có thể thêm sau) |
   | `OWNER_PASSWORD` | Mật khẩu chủ quán dự phòng (tự đặt, dài, khó đoán) |
   | `OWNER_EMAILS` | *Không bắt buộc* – mặc định 2 Gmail ở trên |

4. Bấm **Deploy**. Xong sẽ có link dạng `https://gubilliard.vercel.app`.
5. Kiểm tra: mở `https://<link>/api` → thấy `"ok":true, "db":"connected", "googleLogin":true` là thành công.

Sau này mỗi lần đẩy code lên nhánh `main`, Vercel tự triển khai lại. Đổi biến môi trường thì vào **Deployments → … → Redeploy** để áp dụng.

### 4. Dùng lần đầu

1. Mở link → **Chủ quán đăng nhập** → **Đăng nhập bằng Google** (hoặc nhập `OWNER_PASSWORD`).
2. Tab **⚙️ Cài đặt**: sửa tên quán, giờ 3 ca, số người cần mỗi ca → Lưu. Thêm người quản lý + mã PIN (nếu có).
3. Tab **👥 Nhân viên**: thêm nhân viên.
4. Gửi link vào nhóm Zalo. Nhắc nhân viên **Thêm vào màn hình chính** để mở như ứng dụng.

## Quy trình hằng tuần

Nhân viên đăng ký → chủ quán **🔒 Khóa đăng ký** → xếp ca (hoặc **⚡ Xếp nhanh**) → **📢 Công bố lịch** → app tạo sẵn tin nhắn để dán vào nhóm Zalo.

## Bảo mật

- Đăng nhập Gmail được máy chủ xác minh chữ ký của Google, đúng Client ID của quán và email nằm trong danh sách chủ quán.
- Mở link trong Zalo/Facebook: Google chặn đăng nhập trong trình duyệt nhúng → bấm **⋯ → Mở bằng trình duyệt** (app có nhắc).
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
