# Lingua Quest Online – thiết kế 4 giai đoạn

**Nguyên tắc chung:**
- **Local-first:** SQLite trên máy vẫn là dữ liệu chính, cloud chỉ là bản sao để sao lưu và đồng bộ.
- **Không bắt buộc đăng nhập:** không có tài khoản, app vẫn chạy offline đầy đủ.
- **Không đưa API key của người dùng lên cloud.**

## Kiến trúc

```
Desktop (Electron)                 Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron)
┌──────────────────────┐  HTTPS   ┌──────────────────────────────────────────────────────────┐
│ kernel/cloud         │────────▶│ auth.users (email OTP, Google sau)                         │
│  · auth (OTP code)   │          │ profiles, devices                                          │
│  · backup (Storage)  │          │ sync_rows  ← bản sao các bảng học tập (RLS theo user)      │
│  · sync (push/pull)  │          │ storage: backups/<uid>/*.sqlite                            │
└──────────────────────┘          │ telegram_links, bot_messages, notification_* (GĐ2)        │
                                  │ functions: telegram-bot (webhook), scheduler (cron)        │
PWA điện thoại (GĐ4) ───────────▶│ functions: tutor (AI qua key của server, có hạn mức)       │
                                  └──────────────────────────────────────────────────────────┘
```

**Truy cập dữ liệu:**
- **Desktop:** gọi REST của Supabase (`/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`) bằng `fetch`, không dùng SDK, để dễ test bằng fetch giả.
- **Phân quyền:** mọi bảng bật Row Level Security, mỗi người chỉ đọc và ghi dòng của chính mình (`user_id = auth.uid()`).
- **Edge Functions:** dùng service role key, lưu trong secret của Supabase và không bao giờ nằm trong app.

## Giai đoạn 1 – Tài khoản tùy chọn và sao lưu cloud

**Đăng nhập:**
- Dùng email OTP: nhập email, nhận mã 6 số, nhập vào app. Không cần deep link, không cần cấu hình Google.
- Có thể thêm Google OAuth (PKCE qua trình duyệt hệ thống) sau.
- Access token và refresh token được mã hóa bằng DPAPI (KeyStore id `cloud`). App tự làm mới token và đăng xuất ở mọi chỗ.

**Sao lưu cloud:**
- Tải file SQLite (giống bản sao lưu local) lên bucket riêng `backups/<uid>/`.
- Có danh sách bản sao lưu, khôi phục, xóa.
- App tự sao lưu mỗi ngày nếu bật.
- File sao lưu không chứa key, vì key nằm trong `keys.bin` chứ không nằm trong DB.

**Cấu hình máy chủ:** nhập URL dự án Supabase và anon key (anon key là khóa công khai) trong Cài đặt → Tài khoản. Có thể đóng gói sẵn lúc build bằng `LQ_CLOUD_URL` / `LQ_CLOUD_ANON_KEY`.

## Giai đoạn 2 – Bot Telegram và lịch thông báo trên server

- **Một bot trung tâm:**
  - Telegram gọi webhook tới Edge Function `telegram-bot`, nên bot vẫn chạy khi PC tắt.
  - Liên kết bằng mã: trong app, Cài đặt → Telegram → "Chạy trên server" tạo mã 6 số (`link_codes`), người dùng gửi `/start <mã>` cho bot.
- **Dữ liệu cho bot:** đọc từ `sync_rows` (từ vựng đến hạn, thống kê, kế hoạch).
- **AI:** dùng key Gemini của server (secret `GEMINI_API_KEY`), có hạn mức theo ngày cho mỗi người (`ai_usage`).
- **Lệnh:** giống bot trong app (`/today`, `/review`, `/word`, `/quiz`, `/report`, `/advice`, `/habits`, `/plan`, `/help`), cộng thêm chat với gia sư.
- **Lịch gửi:**
  - `pg_cron` gọi function `scheduler` mỗi 5 phút để gửi brief sáng, nhắc tối, báo cáo ngày/tuần/tháng theo `notification_schedules`.
  - `notification_log` chống gửi trùng.
- **Ôn từ trên Telegram:** kết quả ôn ghi vào `sync_rows`, desktop kéo về ở lần đồng bộ sau.
- **Desktop khi ở chế độ server:** tắt polling của bot local, nhưng vẫn gửi thông báo Windows.

## Giai đoạn 3 – Đồng bộ nhiều máy

**Bảng trên cloud:** dùng một bảng chung `sync_rows(user_id, tbl, row_key, data jsonb, deleted, client_updated_at, seq)`.

**Khóa ổn định cho từng loại dữ liệu:**

| Loại | Bảng | Khóa / quy tắc |
|---|---|---|
| Chỉ thêm, không sửa | `activity_log`, `xp_events`, `review_logs`, `listening_history`, `reading_history`, `writing_submissions`, `speaking_sessions`, `lesson_attempts`, `tutor_messages`, `coach_sessions`… | `<device_id>:<local id>`. Không bao giờ xung đột. |
| Có thể sửa | `vocabulary` (khóa = `word_key`), `review_schedules` (khóa = `word_key`), `user_profile`, `skill_levels`, `learning_goals`, `story_progress`, `favorites`, `bookmarks`, `reading_highlights`, `roadmaps`, `lessons` | Bản sửa sau cùng được giữ, theo `client_updated_at`. |
| Tính lại sau khi kéo về | `daily_stats`, `achievements`, `quests` | Tính lại từ các bảng log. Không đồng bộ trực tiếp. |

**Chiều đẩy lên (push):**
- Các dòng thay đổi kể từ lần đẩy trước được ghi nhận bằng trigger SQLite vào bảng `sync_outbox` (module migration).
- Gửi qua RPC `sync_push`. Server chỉ nhận một dòng nếu `client_updated_at` không cũ hơn bản đang có.

**Chiều kéo về (pull):**
- `select … where seq > cursor order by seq`.
- Dòng kéo về được áp vào SQLite theo bảng ánh xạ, rồi tính lại thống kê và lịch FSRS.

**Lịch chạy:** đồng bộ khi mở app, mỗi 5 phút khi đang online, khi đóng app, và khi bấm "Đồng bộ ngay".

## Giai đoạn 4 – Web/PWA cho điện thoại

- **Vị trí và công nghệ:** thư mục `web/`, dùng Vite + React + Tailwind, cùng design token Windows 11. Có thể cài lên màn hình chính điện thoại (manifest và service worker).
- **Đăng nhập:** email OTP, cùng tài khoản với desktop.
- **Dữ liệu:** đọc và ghi `sync_rows` qua REST với JWT của người dùng.
- **Tính năng:**
  - Tổng quan: streak, XP, kế hoạch hôm nay.
  - Ôn thẻ FSRS, dùng lại `@core/srs`.
  - Thống kê ngày/tuần/tháng, báo cáo Huấn luyện AI.
  - Chat với gia sư qua function `tutor`.
- **Offline:** cache dữ liệu đã tải; các lượt ôn làm khi offline được đưa vào hàng đợi rồi gửi lên khi có mạng.
- **Triển khai:** build ra `web/dist`, host tĩnh miễn phí (Cloudflare Pages, Netlify hoặc GitHub Pages).

## Việc người dùng cần làm (một lần)

1. Tạo project tại <https://supabase.com>, chọn region Singapore.
2. Chạy SQL trong `supabase/migrations/` bằng SQL Editor hoặc lệnh `supabase db push`.
3. Bật Email OTP trong Authentication → Providers → Email, dùng "Email OTP" thay cho magic link.
4. Dán Project URL và anon key vào app: Cài đặt → Tài khoản.
5. Cho giai đoạn 2:
   - Cài Supabase CLI, chạy `supabase functions deploy telegram-bot scheduler tutor`.
   - Đặt secret: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`.
   - Chạy script đăng ký webhook và cron có sẵn trong `supabase/README.md`.
6. Cho giai đoạn 4: `npm run web:build`, rồi đưa thư mục `web/dist` lên dịch vụ host tĩnh.

## Bảo mật và quyền riêng tư

- **Phân quyền:** RLS bật trên mọi bảng. Không có lệnh SQL nào chạy với quyền anon nếu chưa đăng nhập.
- **Key và token:**
  - Không đưa lên cloud: API key Gemini/OpenAI của người dùng, token bot cá nhân.
  - Token đăng nhập trên desktop được mã hóa bằng DPAPI.
- **Xóa dữ liệu:** có nút "Xóa tài khoản và toàn bộ dữ liệu cloud" (RPC `delete_my_data`) và "Xuất dữ liệu cloud", phù hợp Nghị định 13/2023.
- **Webhook Telegram:** được xác thực bằng header `X-Telegram-Bot-Api-Secret-Token`.
