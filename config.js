'use strict';
/**
 * ⚙️ CẤU HÌNH ỨNG DỤNG – sửa trực tiếp file này rồi push lên GitHub, Vercel tự triển khai lại.
 * (Nếu có đặt biến môi trường cùng tên trên Vercel thì biến môi trường được ưu tiên.)
 */
module.exports = {
  /* ---------- MongoDB Atlas ---------- */
  // 👉 Chỉ cần thay dòng này bằng mật khẩu của database user "duydemo1294".
  //    Gõ đúng mật khẩu gốc, KHÔNG cần mã hóa ký tự đặc biệt (app tự xử lý).
  DB_PASSWORD: 'NHAP_MAT_KHAU_DATABASE_VAO_DAY',

  DB_USER: 'duydemo1294',
  DB_HOST: 'duydt19.ayap1vy.mongodb.net',
  DB_APP_NAME: 'Duydt19',
  DB_NAME: 'gubilliard',

  /* ---------- Đăng nhập ---------- */
  // Gmail có quyền chủ quán
  OWNER_EMAILS: ['duydemo1294@gmail.com', 'hangochien2023@gmail.com'],

  // Client ID "Sign in with Google" (công khai, không phải bí mật)
  GOOGLE_CLIENT_ID: '55981277953-70kkk72b2m31ku2d5n3p64t70c82gdkm.apps.googleusercontent.com',

  // Mật khẩu chủ quán dự phòng (khi không đăng nhập Gmail được). Để '' = tắt đăng nhập bằng mật khẩu.
  OWNER_PASSWORD: '',

  // Chuỗi bí mật ký phiên đăng nhập (đã tạo ngẫu nhiên). Đổi chuỗi này = đăng xuất tất cả mọi người.
  SESSION_SECRET: '2w-NxbChhX9uBvNxUfQ4hJq-xizjl-TZ'
};
