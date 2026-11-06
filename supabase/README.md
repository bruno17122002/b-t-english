# B&T English Online – server (Supabase)

Thư mục này chứa phần chạy trên Supabase:

| Thành phần                 | Vai trò                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `migrations/0001_init.sql` | Bảng, RLS, RPC (tài khoản, đồng bộ, Telegram, hạn mức AI).                                 |
| `migrations/0002_cron.sql` | Bảng `bot_pending` cho nút bấm của bot + job `pg_cron` gọi `scheduler` mỗi 5 phút.         |
| `functions/telegram-bot`   | Webhook của **bot Telegram trung tâm** (nhiều người dùng, liên kết bằng mã `/start <mã>`). |
| `functions/scheduler`      | Gửi brief sáng, nhắc tối, báo cáo ngày/tuần/tháng theo lịch AI Coach của từng người.       |
| `functions/tutor`          | Gia sư AI cho PWA (`POST {message, history?}` + JWT người dùng).                           |
| `functions/_shared`        | Toàn bộ logic (TypeScript thuần, có unit test `tests/unit/server-*.test.ts`).              |

Bot dùng dữ liệu đã đồng bộ trong `sync_rows`, nên app desktop cần **đăng nhập tài khoản online và bật đồng bộ**. Kết quả ôn thẻ, từ đã lưu và hoạt động trên Telegram được ghi lại vào `sync_rows`, app tự kéo về ở lần đồng bộ sau.

---

## 1. Chuẩn bị

1. Đã có project Supabase và đã chạy `0001_init.sql` (xem `docs/ONLINE_PLAN.md`, mục "Việc người dùng cần làm").
2. Cài [Supabase CLI](https://supabase.com/docs/guides/cli) (Windows: `scoop install supabase`), hoặc không cài mà gọi qua `npx supabase …`. Supabase không hỗ trợ `npm i -g supabase`.
3. Tạo **một bot Telegram mới cho server** (khác bot cá nhân đang chạy trong app, vì một bot chỉ dùng được webhook **hoặc** polling):
   - Mở **@BotFather** → `/newbot` → đặt tên và username (ví dụ `lingua_quest_bot`).
   - Lưu lại **token** (dạng `123456789:AAH…`) và **username**.
4. Lấy **Gemini API key** tại <https://aistudio.google.com/apikey>.
5. Tạo 2 chuỗi bí mật ngẫu nhiên (Git Bash/WSL/macOS):

   ```bash
   openssl rand -hex 32   # dùng làm TELEGRAM_WEBHOOK_SECRET
   openssl rand -hex 32   # dùng làm SCHEDULER_SECRET
   ```

   PowerShell: `-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})`

## 2. Đăng nhập CLI và liên kết project

```bash
supabase login
supabase link --project-ref <PROJECT_REF>     # PROJECT_REF là phần xxxx trong https://xxxx.supabase.co
```

## 3. Đưa schema lên (migrations)

```bash
supabase db push
```

Lệnh này chạy `0001_init.sql` (nếu chưa chạy) và `0002_cron.sql`. Không dùng CLI thì mở **Dashboard → SQL Editor**, dán và chạy lần lượt từng file.

`0002_cron.sql` bật extension `pg_cron` và `pg_net`. Nếu báo lỗi quyền, bật chúng trong **Database → Extensions** rồi chạy lại.

**Cấu hình cho job cron (chạy một lần trong SQL Editor):** URL project và secret của scheduler được đọc từ Supabase Vault, nên không nằm trong migration. Thay 2 chỗ `<…>` rồi chạy:

```sql
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'lq_project_url');
select vault.create_secret('<SCHEDULER_SECRET>', 'lq_scheduler_secret');
```

Muốn đổi sau này:

```sql
select vault.update_secret((select id from vault.secrets where name = 'lq_scheduler_secret'), '<giá trị mới>');
```

## 4. Đặt secret cho Edge Functions

`SUPABASE_URL`, `SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY` do Supabase tự cung cấp, không cần đặt.

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123456789:AAH..." \
  TELEGRAM_WEBHOOK_SECRET="<chuỗi ngẫu nhiên 1>" \
  GEMINI_API_KEY="AIza..." \
  SCHEDULER_SECRET="<chuỗi ngẫu nhiên 2 – giống giá trị trong Vault>" \
  AI_DAILY_LIMIT=100 \
  TELEGRAM_BOT_USERNAME="lingua_quest_bot"
```

| Secret                    | Bắt buộc | Ý nghĩa                                                                                                           |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | có       | Token của bot server từ @BotFather.                                                                               |
| `TELEGRAM_WEBHOOK_SECRET` | có       | Telegram gửi kèm header `X-Telegram-Bot-Api-Secret-Token`; sai là bị từ chối (401). Chỉ dùng chữ, số, `_` và `-`. |
| `SCHEDULER_SECRET`        | có       | Header `x-scheduler-secret` mà job cron gửi cho `scheduler`.                                                      |
| `GEMINI_API_KEY`          | nên có   | AI của server. Thiếu key thì bot vẫn chạy `/today`, `/review`, `/habits`, `/report` (lời khuyên offline).         |
| `AI_DAILY_LIMIT`          | không    | Số lượt gọi AI mỗi người mỗi ngày (theo giờ của người học). Mặc định 100.                                         |
| `TELEGRAM_BOT_USERNAME`   | không    | Để bot nhận lệnh dạng `/report@lingua_quest_bot`.                                                                 |
| `GEMINI_MODEL`            | không    | Mặc định `gemini-2.5-flash`.                                                                                      |

PowerShell: viết trên một dòng, bỏ các dấu `\`.

## 5. Deploy functions

```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy scheduler --no-verify-jwt
supabase functions deploy tutor
```

- `telegram-bot` và `scheduler` cần `--no-verify-jwt`, vì Telegram và pg_cron không có JWT Supabase. Hai function này được bảo vệ bằng secret riêng.
- `tutor` giữ kiểm tra JWT mặc định. Function này còn tự xác minh token qua `/auth/v1/user`.
- Mỗi function có `deno.json` ánh xạ `ts-fsrs` sang `npm:ts-fsrs@6.0.0` (thuật toán FSRS giống app desktop).

## 6. Đăng ký webhook với Telegram

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"],
    "drop_pending_updates": true
  }'
```

Đăng ký menu lệnh (không bắt buộc, giúp gõ `/` thấy danh sách):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setMyCommands" \
  -H "content-type: application/json" \
  -d '{"commands":[
    {"command":"today","description":"Kế hoạch hôm nay, thẻ cần ôn, chuỗi ngày"},
    {"command":"review","description":"Ôn thẻ từ đến hạn (FSRS)"},
    {"command":"word","description":"Từ vựng của ngày"},
    {"command":"quiz","description":"Câu hỏi nhanh về điểm yếu của bạn"},
    {"command":"report","description":"Báo cáo thói quen: /report ngay|tuan|thang"},
    {"command":"advice","description":"AI phân tích thói quen học"},
    {"command":"habits","description":"Thống kê thói quen nhanh"},
    {"command":"plan","description":"Kế hoạch học ngày mai do AI đề xuất"},
    {"command":"reset","description":"Xóa lịch sử trò chuyện"},
    {"command":"help","description":"Danh sách lệnh"}
  ]}'
```

## 7. Kiểm tra

1. **Webhook:** `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`. Kết quả phải có `url` đúng, `pending_update_count` nhỏ và không có `last_error_message`.
2. **Bot:** nhắn `hi` cho bot. Bot phải trả lời cách liên kết, vì tài khoản Telegram của bạn chưa được liên kết.
3. **Liên kết trong app desktop:**
   - Vào Cài đặt → Tài khoản và đăng nhập.
   - Vào Cài đặt → Telegram, chọn **"Bot chạy trên server (cần tài khoản online)"**.
   - Nhập username của bot server, rồi bấm **Tạo mã liên kết**.
   - Gửi `/start <mã>` cho bot, hoặc bấm "Mở bot kèm mã này".
   - Trang trong app tự chuyển sang "Đã liên kết".
4. **Scheduler chạy tay:**

   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/scheduler" \
     -H "x-scheduler-secret: <SCHEDULER_SECRET>" -H "content-type: application/json" -d '{}'
   ```

   Kết quả mẫu: `{"ok":true,"users":1,"sent":1}`. Nếu không có lịch nào đến hạn, kết quả chỉ có `users`.

5. **Cron:** chạy trong SQL Editor:

   ```sql
   select * from cron.job_run_details order by start_time desc limit 5;
   select id, status_code, left(content, 200) from net._http_response order by created desc limit 5;
   ```

6. **Log:** Dashboard → Edge Functions → chọn function → Logs.

## 8. Cách hoạt động (tóm tắt)

- **Liên kết:**
  - App gọi RPC `create_link_code()` để nhận mã 6 số, hiệu lực 15 phút.
  - Bot nhận `/start <mã>`, ghi `telegram_links` và xóa mã.
  - Nhập sai 5 lần trong 15 phút thì chat đó bị khóa tạm thời.
  - Mỗi chat chỉ gắn với một tài khoản.
- **Ôn thẻ (`/review`):**
  - Tính FSRS trên `review_schedules` trong `sync_rows`.
  - Mỗi lần chấm, bot ghi:
    - bản cập nhật `review_schedules` (`row_key = word_key`);
    - `review_logs`, `activity_log` và `xp_events`, mỗi dòng có `row_key = server:<uuid>`.
  - `client_updated_at` không bao giờ lùi so với bản đang lưu, và mỗi lần ghi có `seq` mới, nên desktop kéo về được.
- **Lịch:**
  - App desktop đẩy lịch AI Coach lên `notification_schedules` khi bật chế độ server, khi đăng nhập và khi lịch thay đổi (kiểm tra mỗi phút).
  - Scheduler tính lịch theo `profiles.timezone`; nếu thiếu thì dùng múi giờ của máy (mặc định Asia/Ho_Chi_Minh).
  - Quy tắc gửi bù giống desktop:
    - Brief sáng, nhắc tối, báo cáo ngày: bù trong cùng ngày.
    - Báo cáo tuần: bù đến hết ngày hôm sau.
    - Báo cáo tháng: bù trong 3 ngày.
  - `notification_log` chống gửi trùng, kể cả khi hai lượt cron chạy chồng nhau.
  - Nhắc tối được bỏ qua nếu hôm đó đã học.
- **Desktop ở chế độ server:**
  - Bot local không nhận tin và không gửi Telegram, nên không có tin trùng.
  - Thông báo Windows vẫn hoạt động như cũ.
  - Chuyển về chế độ local thì lịch trên server bị xóa.

## 9. Chi phí và giới hạn

- **Supabase gói Free:**
  - 500.000 lượt gọi Edge Function mỗi tháng. Cron 5 phút một lần tốn khoảng 8.640 lượt/tháng; mỗi tin nhắn Telegram tốn 1 lượt.
  - Mỗi request chỉ được dùng khoảng 2 giây CPU, nhưng thời gian chờ Gemini không tính vào đó.
  - Project Free không hoạt động 7 ngày có thể bị **tạm dừng**. Khi đó bot ngừng chạy; vào Dashboard và bấm **Restore**.
- **Telegram Bot API:** miễn phí. File bot tải về tối đa 20 MB (ảnh, tin thoại).
- **Gemini:**
  - Gói miễn phí có giới hạn số request mỗi phút và mỗi ngày, tùy model. Xem tại <https://ai.google.dev/gemini-api/docs/rate-limits>.
  - Mỗi tin nhắn gia sư, ảnh hoặc tin thoại tốn 1 lượt; có thể thêm 1 lượt "sửa JSON" khi AI trả lời sai định dạng.
  - Brief sáng, nhắc tối và báo cáo có lời khuyên AI tốn mỗi loại 1 lượt.
  - `AI_DAILY_LIMIT` giới hạn số lượt mỗi người mỗi ngày (bảng `ai_usage`). Hết lượt thì bot dùng nội dung offline (từ có sẵn, lời khuyên theo quy tắc).
- **Không có trên server:** tạo ảnh (`/anh`) và đọc câu đúng bằng giọng nói (TTS). Hai tính năng này chỉ có khi bot chạy trên máy.

## 10. Bảo mật

- **Service role key:** chỉ nằm trong Edge Functions, do Supabase tự cấp. Key này bỏ qua RLS, nên mọi truy vấn dữ liệu người dùng trong `_shared/rest.ts` đều lọc `user_id` qua `forUser()`.
- **Webhook:** từ chối mọi request không có header `X-Telegram-Bot-Api-Secret-Token` đúng. Scheduler cũng tương tự với `x-scheduler-secret`.
- **`bot_pending`:** bật RLS và không có policy, nên chỉ service role truy cập được. Dữ liệu cũ hơn 2 ngày tự bị xóa.
- **Xóa tài khoản:** dữ liệu trong `bot_pending` bị xóa theo (`on delete cascade`). RPC `delete_my_data()` xóa các bảng còn lại; nút bấm cũ còn sót trong `bot_pending` hết hạn sau 2 ngày.

## 11. Gỡ bỏ / tạm dừng

```bash
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

```sql
select cron.unschedule('lq-scheduler');
```
