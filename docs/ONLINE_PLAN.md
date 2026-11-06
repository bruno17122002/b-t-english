# B&T English Online – thiết kế 4 giai đoạn

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

| Loại                    | Bảng                                                                                                                                                                                                                | Khóa / quy tắc                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Chỉ thêm, không sửa     | `activity_log`, `xp_events`, `review_logs`, `listening_history`, `reading_history`, `writing_submissions`, `speaking_sessions`, `lesson_attempts`, `tutor_messages`, `coach_sessions`…                              | `<device_id>:<local id>`. Không bao giờ xung đột.    |
| Có thể sửa              | `vocabulary` (khóa = `word_key`), `review_schedules` (khóa = `word_key`), `user_profile`, `skill_levels`, `learning_goals`, `story_progress`, `favorites`, `bookmarks`, `reading_highlights`, `roadmaps`, `lessons` | Bản sửa sau cùng được giữ, theo `client_updated_at`. |
| Tính lại sau khi kéo về | `daily_stats`, `achievements`, `quests`                                                                                                                                                                             | Tính lại từ các bảng log. Không đồng bộ trực tiếp.   |

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

## Hợp đồng dữ liệu đồng bộ (`sync_rows`) – đã triển khai ở desktop

Desktop, bot trên server và PWA cùng đọc/ghi bảng `sync_rows`. Mã nguồn tham chiếu: `src/main/kernel/cloud/syncTables.ts` (danh sách bảng) và `src/main/kernel/cloud/sync.ts` (push/pull).

**Định dạng một dòng:**

| Cột                 | Ý nghĩa                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tbl`               | Tên bảng SQLite trên máy (ví dụ `vocabulary`, `review_logs`).                                                                                                                                                      |
| `row_key`           | Khóa ổn định, xem bảng bên dưới. Tối đa 200 ký tự.                                                                                                                                                                 |
| `data`              | Toàn bộ dòng local dạng JSON, giữ nguyên tên cột local (snake_case), cộng thêm các trường tham chiếu (cột "Trường thêm"). Cột JSON trong SQLite (ví dụ `examples`, `purposes`) là **chuỗi JSON**, không phải mảng. |
| `deleted`           | `true` = dòng đã bị xóa. `data` khi đó là `{}` (riêng `vocabulary`/`review_schedules` là `{ "word_key": … }`).                                                                                                     |
| `client_updated_at` | Thời điểm sửa (ISO 8601). Server giữ bản có thời điểm mới nhất (last-writer-wins).                                                                                                                                 |
| `device_id`         | `devices.id` của máy đẩy lên; bot/PWA để `null`.                                                                                                                                                                   |

**Ba loại khóa:**

- **Theo thiết bị** (bảng chỉ thêm hoặc có id tự tăng): `row_key = <deviceId>:<id local>`. Bot và PWA tự tạo dòng mới thì dùng tiền tố riêng, ví dụ `tg:<uuid>` hoặc `web:<uuid>`. Khi sửa một dòng đã có thì **giữ nguyên `row_key` cũ**.
- **Khóa tự nhiên:** giá trị cố định của dòng, ví dụ `word_key`.
- **Singleton:** `row_key = 'singleton'`.

| Bảng                                                                                                     | Loại      | `row_key`                                                      | Trường thêm trong `data`                                      |
| -------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `user_profile`                                                                                           | singleton | `singleton`                                                    | –                                                             |
| `skill_levels`                                                                                           | tự nhiên  | `skill`                                                        | –                                                             |
| `learning_goals`                                                                                         | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `vocabulary`                                                                                             | tự nhiên  | `word_key` (chữ thường, đã trim)                               | –                                                             |
| `review_schedules`                                                                                       | tự nhiên  | `word_key` của từ                                              | `word_key`                                                    |
| `review_logs`                                                                                            | thiết bị  | `<dev>:<id>`                                                   | `word_key` (bắt buộc)                                         |
| `assessments`                                                                                            | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `assessment_answers`                                                                                     | thiết bị  | `<dev>:<id>`                                                   | `assessment_key` = `row_key` của bài đánh giá                 |
| `roadmaps`                                                                                               | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `roadmap_weeks`                                                                                          | thiết bị  | `<dev>:<id>`                                                   | `roadmap_key` = `row_key` của lộ trình                        |
| `lessons`                                                                                                | tự nhiên  | `${date}:${module}:${content_ref ?? title}`                    | `roadmap_key` (có thể null)                                   |
| `lesson_attempts`                                                                                        | thiết bị  | `<dev>:<id>`                                                   | `lesson_key` = `row_key` của bài học (có thể null)            |
| `writing_submissions`, `speaking_sessions`, `listening_history`, `reading_history`, `reading_highlights` | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `stories`                                                                                                | tự nhiên  | `id`                                                           | –                                                             |
| `story_progress`                                                                                         | tự nhiên  | `story_id`                                                     | –                                                             |
| `xp_events`, `activity_log`                                                                              | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `tutor_conversations`                                                                                    | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `tutor_messages`                                                                                         | thiết bị  | `<dev>:<id>`                                                   | `conversation_key` = `row_key` của cuộc trò chuyện (bắt buộc) |
| `learner_mistakes`                                                                                       | tự nhiên  | `pattern_key`                                                  | –                                                             |
| `favorites`                                                                                              | tự nhiên  | `${kind}:${ref}`                                               | –                                                             |
| `bookmarks`                                                                                              | thiết bị  | `<dev>:<id>`                                                   | –                                                             |
| `coach_sessions`, `coach_views`                                                                          | thiết bị  | `<dev>:<id>` (id là chuỗi UUID, được giữ nguyên trên máy khác) | –                                                             |
| `coach_reports`                                                                                          | tự nhiên  | `${period}:${period_key}`                                      | –                                                             |
| `coach_qa`                                                                                               | thiết bị  | `<dev>:<id>`                                                   | –                                                             |

**Không bao giờ đồng bộ:**

- **Bí mật và cấu hình máy:** `app_settings`, `ai_settings`, `keys.bin` (API key, token bot, phiên đăng nhập).
- **Dữ liệu riêng từng máy:** `telegram_messages`, `generated_content` (cache), `coach_notifications`, `tutor_message_meta`, `tutor_conversation_state`.
- **Dữ liệu tính lại:** `daily_stats`, `achievements`, `quests`. Máy nhận dữ liệu sẽ tự tính lại.

**Quy tắc cho bot và PWA khi ghi:**

- **Ôn một từ:**
  - Ghi `review_logs` với `row_key = tg:<uuid>` hoặc `web:<uuid>`, kèm `word_key` và các cột `rating`, `state_before`, `elapsed_days`, `scheduled_days`, `duration_ms`, `reviewed_at`.
  - Upsert `review_schedules` với `row_key = word_key`. `data` gồm `word_key` và các cột `state`, `due_at`, `stability`, `difficulty`, `reps`, `lapses`, `scheduled_days`, `last_review_at`, `learning_steps`.
- **Tính XP và streak:** ghi `activity_log` (`module`, `action`, `minutes`, `xp`, `date` dạng `YYYY-MM-DD` theo giờ Việt Nam, `created_at`) và `xp_events` (`amount`, `source`, `date`, `created_at`). Desktop sẽ tính lại `daily_stats` từ hai bảng này.
- **`client_updated_at`:** luôn đặt là thời điểm thật của thay đổi. Đặt sai (quá mới) sẽ đè bản sửa của người dùng trên máy.
- **Đọc dữ liệu:** bỏ qua dòng `deleted = true` và bảng không quen biết. Dòng thiếu cột sẽ được desktop điền giá trị mặc định. Dòng thiếu tham chiếu bắt buộc (ví dụ `word_key` không có trong `vocabulary`) bị bỏ qua.

**Cách desktop đồng bộ:**

- **Ghi nhận thay đổi:** trigger SQLite (migration v5, kèm trigger lúc chạy cho bảng `coach_*`) ghi vào `sync_outbox`. Trigger chỉ bật sau lần đồng bộ đầu tiên. Lần đầu (hoặc khi đổi tài khoản), toàn bộ dữ liệu được đưa lên, với `client_updated_at` lấy từ `updated_at`/`created_at` của dòng. Hồ sơ chưa xong onboarding dùng mốc 1970, nên máy mới cài không đè hồ sơ thật.
- **Đẩy lên:** RPC `sync_push(rows, device)`, mỗi lượt tối đa 500 dòng. Máy phải được đăng ký trong `devices` trước (khóa ngoại `device_id`).
- **Kéo về:** `GET /rest/v1/sync_rows?select=*&seq=gt.<cursor>&order=seq&limit=1000`, lặp theo trang.
- **Áp dữ liệu:**
  - Chạy trong một transaction, có tắt trigger, nên dòng kéo về không bị đẩy ngược lên.
  - Bỏ qua dòng có `device_id` của chính máy này.
  - Dòng thiết bị khác được ánh xạ id qua `sync_map(tbl, row_key, local_id)`, khóa ngoại được nối lại qua `word_key`/`*_key`.
  - Nếu máy có bản sửa local mới hơn đang chờ gửi thì giữ bản local.
  - Sau đó tính lại `daily_stats` cho các ngày bị ảnh hưởng và mở khóa thành tích.
- **Khôi phục bản sao lưu (local hoặc cloud):** lần khởi động sau, máy nhận `deviceId` mới. Các dòng cũ giữ khóa cũ qua `sync_map`, cursor về 0 để kéo lại các thay đổi mới hơn trên cloud mà không tạo bản trùng.
- **Lịch chạy:**
  - 5 giây sau khi mở app, rồi mỗi 5 phút, nếu bật "Tự động đồng bộ".
  - Khi đóng app: gửi nốt thay đổi, chờ tối đa 4 giây.
  - Khi bấm "Đồng bộ ngay".
  - Sao lưu cloud hằng ngày nếu bật, giữ 20 bản gần nhất: `backups/<uid>/lingua-quest-<YYYY-MM-DD-HH-mm-ss>.sqlite`.
