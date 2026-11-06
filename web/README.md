# Lingua Quest Online (PWA)

Bản điện thoại của Lingua Quest. Ứng dụng gọi thẳng tới Supabase bằng tài khoản của người dùng (email OTP) và đọc/ghi bảng `sync_rows` mà ứng dụng desktop đồng bộ lên. Nội dung thiết kế xem ở `docs/ONLINE_PLAN.md`, giai đoạn 4.

## Chạy và build

```bash
npm run web:dev       # http://localhost:5180 (cũng mở được từ điện thoại trong cùng mạng Wi-Fi)
npm run web:build     # build ra web/dist
npm run web:preview   # chạy thử bản build (service worker chỉ bật ở bản build)
python -I web/scripts/make_icons.py   # tạo lại icon PWA từ build/icon.png
```

**Cấu hình máy chủ, có 2 cách:**

- **Đóng gói sẵn lúc build:** tạo file `web/.env.local` với `VITE_CLOUD_URL=https://<project>.supabase.co` và `VITE_CLOUD_ANON_KEY=<anon key>`. Anon key là khóa công khai, được phép nằm trong bundle.
- **Nhập lúc chạy:** nếu không có biến môi trường, lần mở đầu tiên app hiện màn hình "Kết nối máy chủ" và lưu cấu hình vào `localStorage`.

## Triển khai

`web/dist` là thư mục file tĩnh, dùng `base: './'` và HashRouter, nên đặt ở bất kỳ thư mục con nào cũng chạy, không cần rewrite rule:

- **Cloudflare Pages / Netlify:** build command `npm run web:build`, output `web/dist`.
- **GitHub Pages:** đẩy nội dung `web/dist` lên nhánh `gh-pages`.

**Yêu cầu:**

- Phải dùng HTTPS, vì service worker và nút "Thêm vào màn hình chính" cần HTTPS.
- Trong Supabase → Authentication → URL Configuration, thêm địa chỉ trang vào danh sách cho phép. Việc này chỉ cần khi sau này bật đăng nhập bằng link; OTP 6 số không cần redirect.
- Function `tutor` phải được deploy (`supabase functions deploy tutor`) và có secret `GEMINI_API_KEY`. Nếu thiếu, màn hình Gia sư sẽ báo rõ là chưa triển khai hoặc chưa bật AI.

Muốn người dùng nhận bản mới ngay, tăng `VERSION` trong `public/sw.js`. Khi đã có mạng, `index.html` luôn được tải theo kiểu network-first, và các file trong `assets/` có hash trong tên, nên thường không cần tăng.

## Dữ liệu

| Màn hình   | Đọc từ `sync_rows` (tbl)                                                                                                                                | Ghi                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Hôm nay    | `activity_log` (streak), `xp_events` (cấp/XP), `lessons` (bài hôm nay), `user_profile` (mục tiêu phút), `vocabulary` + `review_schedules` (thẻ đến hạn) | –                                                                                                                                |
| Ôn thẻ     | `vocabulary`, `review_schedules` (nối với nhau bằng `word_key`)                                                                                         | `review_schedules` (row_key = word_key), `review_logs`, `activity_log`, `xp_events` (row_key = `web:<uuid>`) qua RPC `sync_push` |
| Thống kê   | `activity_log` (phút, từ mới = `word_saved`, lượt ôn = `review_done`, XP)                                                                               | –                                                                                                                                |
| Báo cáo AI | `coach_reports` (`advice` là JSON: headline, recommendations, nextPeriodPlan…)                                                                          | –                                                                                                                                |
| Gia sư     | `POST /functions/v1/tutor {message, history}`                                                                                                           | lịch sử chat lưu trong `localStorage` của máy                                                                                    |

**Cách đồng bộ:**

- Kéo dữ liệu theo con trỏ `seq` (`seq=gt.<cursor>`, mỗi trang 1000 dòng) vào cache IndexedDB. Đồng bộ lúc mở app, mỗi 5 phút, khi app được mở lại từ nền, và khi có mạng trở lại.
- Mỗi lượt ôn được áp ngay vào cache để giao diện cập nhật, đồng thời đưa vào hàng đợi trong `localStorage`. Hàng đợi được gửi lên khi có mạng.
- Server giữ bản có `client_updated_at` mới nhất (last-writer-wins). Nếu đồng hồ điện thoại chậm hơn bản đang có, dòng lịch ôn được ghi thời điểm sau bản cũ 1 ms, giống cách bot làm.

## Lưu phiên đăng nhập trong trình duyệt

Desktop mã hóa token bằng DPAPI. Trình duyệt không có kho khóa tương tự, nên PWA lưu access token và refresh token trong `localStorage`.

**Rủi ro:** nếu trang bị chèn script (XSS), script đó đọc được token.

**Cách giảm rủi ro:**

- Không tải script của bên thứ ba và không dùng CDN, mọi thứ nằm trong bundle.
- React tự escape mọi nội dung hiển thị, kể cả câu trả lời của AI.
- Access token chỉ sống khoảng 1 giờ và được tự làm mới bằng refresh token.
- Nút Đăng xuất thu hồi refresh token của thiết bị này (`/auth/v1/logout?scope=local`, desktop vẫn đăng nhập), rồi xóa cache IndexedDB và cache API của service worker.

**Lưu ý:**

- Không nên đăng nhập trên máy dùng chung.
- Các lượt ôn chưa gửi được vẫn nằm trong hàng đợi để gửi lên khi đăng nhập lại.
