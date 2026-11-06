# Báo cáo QA "phá app" – tầng dữ liệu / IPC (06/11/2026)

Mục tiêu: trước khi phát hành công khai, thử mọi cách một người dùng cẩu thả hoặc cố tình phá có thể làm hỏng
Lingua Quest từ phía dữ liệu và IPC. Yêu cầu: app không bao giờ crash, không làm hỏng dữ liệu và luôn trả lỗi
rõ ràng bằng tiếng Việt (mã lỗi ổn định, không lộ stack trace hay bí mật).

Phạm vi: `src/main/**`, `src/modules/*/main/**`, `src/modules/*/contract.ts`, `src/shared/**`, `src/core/**` và
test. Giao diện (`src/renderer/**`, `src/modules/*/renderer/**`) do agent UI kiểm thử song song – các việc cần
sửa phía giao diện nằm ở mục 6.

## 1. Đã thử những gì

| Nhóm              | File test                               | Số test | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fuzz IPC          | `tests/integration/abuse-ipc.test.ts`   |      44 | **168 kênh** trong `CONTRACT`, mỗi kênh một mẫu hợp lệ sinh từ schema zod + các biến thể xấu: `undefined`/`null`/`{}`/`[]`/sai kiểu, thiếu / thừa trường, khoá `__proto__`/`constructor`, object lồng 3 000 tầng, NaN, ±Infinity, -1, 0, -0, 0.5, 1e308, 2^53+2, id không tồn tại, chuỗi rỗng, 100 000 ký tự, emoji/ZWJ/cờ, zero-width, RTL override, dấu kết hợp, `<script>`, `'; DROP TABLE`, ký tự regex, NUL, surrogate lẻ, công thức CSV, path traversal, Uint8Array 0 byte / 26 MB / rác, mảng 10 000 phần tử, giá trị biên `max` và `max + 1`. Chạy 2 lần: AI giả lập (handler chạy hết luồng) và AI thật trả 401 kèm key trong body / mạng mất. **20 028 lần dispatch**. |
| Bấm đúp / race    | `tests/integration/abuse-races.test.ts` |      15 | Cùng kênh 2–10 lần đồng thời (`Promise.all`): vocab:save, vocab:review, writing:submit, journey:assessmentAnswer / assessmentFinish, grammar:submit, cinema:advance, tutor:send, tutor:create, coach:generateReport, coach:applyPlan, data:createBackup, sync:now, cloud:createBackup; bấm lặp tuần tự trong 1,5 s; payload khác nhau vẫn phải chạy.                                                                                                                                                                                                                                                                                                                             |
| Đồng hồ           | `tests/integration/abuse-time.test.ts`  |      10 | Đồng hồ lùi 1 phút / 1 ngày / 1 năm, tiến 1 năm rồi quay lại; 23:59:59 → 00:00:01; ngày 23 h / 25 h (DST America/New_York); ôn thẻ "trước" lần ôn cuối; scheduler Coach với ngày NaN, cuối năm, đồng hồ lùi. Sau mỗi bước gọi ~25 kênh và quét mọi số trong kết quả (không NaN / Infinity / số âm).                                                                                                                                                                                                                                                                                                                                                                              |
| Toàn vẹn dữ liệu  | `tests/integration/abuse-data.test.ts`  |      34 | DB bị xoá / 0 byte / cắt đôi / byte ngẫu nhiên / header còn nhưng trang bị xoá / file text; DB và `.bak` cùng hỏng; DB của phiên bản mới hơn; `keys.bin` rác, `null`, mảng, sai kiểu, mã hoá trên máy khác; `app_settings` JSON lỗi / sai kiểu; content có mục lỗi; khôi phục khi còn ghi chờ; khôi phục file thiếu / không phải SQLite / rỗng / mới hơn; nhập CSV 50 000 dòng, CSV rỗng, ảnh / zip / JSON lỗi / JSON sai cấu trúc / JSON của bản mới hơn; báo cáo Coach hỏng; captive portal trả HTML; DB 20 000 từ (đo thời gian).                                                                                                                                             |
| Văn bản người học | `tests/integration/abuse-text.test.ts`  |       9 | Tên hiển thị / tiêu đề / ghi chú với HTML, emoji, RTL, zero-width, xuống dòng, 10 000 ký tự; tìm kiếm với `% _ \ ( [ * + ? .* ^$`, emoji, SQL; CSV xuất → nhập với dấu nháy, dấu phẩy, xuống dòng, `= + - @ TAB`; escape HTML và chia tin nhắn Telegram.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Tổng**          |                                         | **112** | Bất biến chung: dispatch không bao giờ throw / treo (> 15 s), lỗi do người dùng không bao giờ là `internal`, kết quả structured-clone được, thông điệp lỗi không chứa key / stack / đường dẫn mã nguồn và ≤ 600 ký tự, sau mỗi kênh `PRAGMA integrity_check = ok` và `foreign_key_check` rỗng, không cột TEXT nào lưu > 20 000 ký tự, `Object.prototype` không bị ô nhiễm.                                                                                                                                                                                                                                                                                                       |

Kết quả cuối: `npx vitest run` → **59 file, 636 test, tất cả đạt** (trước đợt này 524 test). `npm run typecheck`
và `npx eslint . --max-warnings 0` sạch.

## 2. Lỗi tìm thấy và đã sửa (B18–B38, chi tiết trong `docs/BUGS.md`)

| Mức độ       | Lỗi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nghiêm trọng | **B26** DB 0 byte mở như DB mới trống và lần lưu sau ghi đè `.bak` tốt; DB + `.bak` hỏng → app không bao giờ khởi động được. **B27** Khôi phục bản sao lưu rồi có lần ghi trước khi khởi động lại → bản khôi phục bị ghi đè (mất dữ liệu).                                                                                                                                                                                                                                                               |
| Cao          | **B18** Patch có trường `undefined` làm hỏng lưu hồ sơ / từ (`internal`). **B22** Bấm đúp nhân đôi bản ghi và XP ở 7 kênh. **B24** Đồng hồ lùi → không ôn được thẻ. **B28** Nhập từ vựng: farm XP (20 000 từ ≈ 40 000 XP), treo main process ~8 s, nhập file ảnh thành từ rác. **B31** `keys.bin` = `null` → không vào được app.                                                                                                                                                                         |
| Trung bình   | **B19** Ôn / sửa từ đã xoá → `internal`. **B21** Lỗi khôi phục lộ đường dẫn, tiếng Anh, 1 084 ký tự. **B23** Nội dung AI trùng id → `internal` hoặc ghi đè mất bài / phim cũ. **B29** CSV xuất ra bị chèn công thức Excel.                                                                                                                                                                                                                                                                               |
| Thấp         | **B20** Xoá sao lưu ngoài thư mục / file không phải sao lưu; trùng tên trong cùng giây. **B25** Scheduler Coach: NaN và gửi lại khi đồng hồ lùi. **B30** `%`/`_` khớp mọi từ. **B32** Settings sai kiểu lên UI. **B33** Tên / tiêu đề có ký tự RTL, vô hình, xuống dòng; ngày mục tiêu không giới hạn. **B34** `vocab:stats` 300 ms. **B35** `splitHtml` OOM với giới hạn nhỏ. **B36** Captive portal → `internal`. **B37** Báo cáo Coach hỏng → `internal`. **B38** Thông báo DB mới hơn chỉ tiếng Anh. |

Các thay đổi chính:

- `src/main/ipc/router.ts`: bỏ khoá `undefined`; gộp lời gọi giống hệt đang chạy (mọi kênh); `REPEAT_GUARDED_CHANNELS`
  trả lại kết quả lần đầu khi lặp trong 1,5 s (bật trong `src/main/index.ts`); mã `db_closed`; cắt ngắn thông điệp.
- `src/main/kernel/errors.ts` (mới): `UserError`, `definedOnly()` dùng chung cho kernel và module.
- `src/main/db/database.ts`: kiểm tra header + integrity cho file chính và `.bak`, cách ly file hỏng, `recovery`,
  `discard()`, `runBatch()`, `uniqueId()`, `DatabaseClosedError`.
- `src/main/kernel/data/dataService.ts` + `VocabHub.importMany`: nhập hàng loạt an toàn và nhanh, CSV chống công thức.
- `src/core/srs.ts`, `src/modules/coach/main/scheduler.ts`: chịu được đồng hồ lùi / NaN.
- `src/core/text.ts` `cleanInline()`; `KeyStore`, `SettingsService`, `CloudClient.json()`, `CoachService.report()` đọc dữ liệu hỏng an toàn.

## 3. Hiệu năng (DB 20 000 từ, ¾ đã ôn, tốt nhất trong 3 lần, Windows 11, Node 20)

| Thao tác                                                                 |                    Chạy riêng | Chạy cùng cả bộ test |
| ------------------------------------------------------------------------ | ----------------------------: | -------------------: |
| `vocab:list` mặc định (100 dòng)                                         |                          5 ms |                 8 ms |
| `vocab:list` tìm kiếm / không có kết quả                                 |                    19 / 17 ms |           32 / 27 ms |
| `vocab:list` sắp theo hạn ôn (500 dòng)                                  |                         14 ms |                22 ms |
| `vocab:list` offset 19 000                                               |                          6 ms |                10 ms |
| `vocab:due` 200 thẻ                                                      |                         15 ms |                34 ms |
| `vocab:stats`                                                            | 46 ms (trước sửa: 269–305 ms) |               100 ms |
| `search:query` (bỏ dấu, có ký tự regex)                                  |                      52–61 ms |           108–115 ms |
| `app:bootstrap`, `progress:stats`, `journey:dashboard`, `coach:overview` |                        ≤ 2 ms |               ≤ 3 ms |
| Xuất CSV 20 000 từ                                                       |                        139 ms |               234 ms |
| Nhập 20 000 từ                                                           |  316 ms (trước sửa: 7 760 ms) |               625 ms |
| Nhập CSV 50 000 dòng (giữ 20 000)                                        |  382 ms (trước sửa: 9 292 ms) |               732 ms |

Mọi thao tác đọc đều dưới ngưỡng 300 ms; test hiệu năng kiểm tra ngưỡng này.

## 4. Đã kiểm tra, không có lỗi

- 168 kênh đều có schema zod chặn sai kiểu, NaN/Infinity, chuỗi quá dài và giá trị ngoài enum; không có ô nhiễm prototype.
- Các module đã chặn đúng: hoàn thành bài kiểm tra hai lần, áp dụng kế hoạch hai lần (`plan_expired`, `created: 0`),
  xem tiếp phim đã kết thúc (`story_completed`), cảnh không khớp (`scene_mismatch`), trả lời câu không phải câu hiện tại.
- Key AI không bao giờ xuất hiện trong lỗi hay log, kể cả khi nhà cung cấp trả body chứa key.
- Escape HTML cho Telegram / Coach (`escapeHtml`, `esc`) bao phủ mọi chuỗi người học; chuỗi qua ngày, DST và tuần ISO đúng lịch.
- `sync:now` đã tự gộp lời gọi đồng thời; content registry bỏ qua mục lỗi và báo trong `contentIssues`.

## 5. Rủi ro còn lại

- Chống bấm đúp chỉ áp dụng cho payload **giống hệt**; hai lần nộp khác nhau một ký tự vẫn là hai lần nộp (đúng ý nghĩa,
  nhưng giao diện vẫn nên khoá nút khi đang chờ). Cửa sổ 1,5 s dùng đồng hồ thật, không phải `kernel.now`.
- Khi cả DB và `.bak` hỏng, app khởi động với dữ liệu trống: người học phải tự khôi phục bản sao lưu hằng ngày
  (Cài đặt → Dữ liệu). File hỏng được giữ lại cạnh DB (`*.corrupt-<thời gian>`).
- Dữ liệu đồng bộ từ máy khác chỉ được kiểm tra kỹ ở báo cáo Coach; các bảng khác vẫn tin JSON trong DB
  (đa số đã có `try/catch` hoặc `safeParse`).
- Lọc kho từ (`vocab:list`) dùng `lower()` của SQLite (chỉ ASCII) và chưa bỏ dấu tiếng Việt; tìm kiếm toàn cục đã bỏ dấu.
- Xem lại phim (`cinema:start` với `restart`) vẫn được cộng XP mỗi lần – là thiết kế hiện tại, có thể bị "cày" XP.
- Bot Telegram chỉ được fuzz qua các kênh cấu hình (mạng mất); lệnh bot với nội dung xấu chưa được chạy end-to-end.
- Ngưỡng 300 ms đo trên máy phát triển; máy yếu có thể chậm hơn ~2 lần (vẫn dưới 300 ms trừ khi máy rất chậm).

## 6. Việc cần làm phía giao diện (agent UI)

1. **`app:bootstrap` → `dataRecovery`** (mới): khi khác `null`, hiện thông báo một lần –
   `backup`: "Dữ liệu bị hỏng nên Lingua Quest đã mở bản lưu gần nhất; vài thay đổi cuối có thể bị mất.";
   `fresh`: "Dữ liệu bị hỏng và không có bản lưu dùng được. Vào Cài đặt → Dữ liệu để khôi phục bản sao lưu." (kèm nút mở thư mục sao lưu).
2. Mã lỗi **`db_closed`** (sau khi khôi phục, trước khi app khởi động lại): không hiện như lỗi đỏ; hiện "Đang khởi động lại…".
3. Mã lỗi mới / đổi: `not_found` (từ đã xoá – nên làm mới danh sách ôn), `invalid_backup`, `backup_too_new`
   (gợi ý cập nhật app), `invalid_import`, `report_damaged`, `cloud_server` (mạng trả HTML). Tất cả đã có thông điệp tiếng Việt.
4. Nhập từ vựng: kết quả `skipped` giờ gồm cả các dòng vượt 20 000; nên hiện "Đã thêm X, gộp Y, bỏ qua Z".
   Nhập **không còn cộng XP** – nếu giao diện hứa XP cho việc nhập thì cần bỏ.
5. Mục tiêu: `targetDate` phải là `YYYY-MM-DD`, chuỗi rỗng hoặc `null` (ô `type="date"` hiện tại đã đúng).
6. Vẫn nên khoá nút trong lúc chờ (nộp bài, gửi tin, tạo báo cáo, sao lưu): main đã chống trùng nhưng người học cần thấy phản hồi.
7. Tên hiển thị, từ vựng, ghi chú có thể chứa `<script>` dạng văn bản: không dùng `dangerouslySetInnerHTML` với dữ liệu người học
   (kiểm tra lại trình hiển thị markdown của Tutor với nội dung do người học nhập).
8. Tên hiển thị bị cắt ở 60 ký tự **theo ký tự Unicode** và bỏ xuống dòng / ký tự vô hình: ô nhập nên dùng `maxLength={60}` và một dòng.

---

# Giao diện – QA "phá app" phía renderer (06/11/2026)

Mục tiêu: mọi thứ một người dùng cẩu thả hoặc cố tình phá có thể làm trên **giao diện** (bấm loạn, gõ rác, phím tắt sai
chỗ, rời trang giữa chừng, mất mạng, không có micro, phóng to…) không được làm app lỗi, treo, trắng màn hình, vỡ bố cục,
mất dữ liệu hay gây khó hiểu. Phạm vi: `src/renderer/**`, `src/modules/*/renderer/**`, `tests/e2e/**`.

## G1. Đã thử những gì

| Nhóm                | File                       |      Số test | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------- | -----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monkey test có seed | `tests/e2e/monkey.spec.ts` | 5 (mặc định) | Đi ngẫu nhiên có seed (mulberry32, in seed + bước khi lỗi để chạy lại: `LQ_MONKEY_SEEDS=404 LQ_MONKEY_STEPS=400 npx playwright test monkey`). Mỗi bước: bấm nút / link / tab / thẻ đang nhìn thấy và thật sự bấm được (kiểm tra `elementFromPoint`), bấm đúp, gõ chuỗi xấu (emoji, tiếng Việt, 5 000 ký tự, HTML/script, SQL, số, RTL, zero-width) vào ô nhập, chọn ô chọn, nhấn phím (Space, Enter, Esc, 1–4, Ctrl+K, F1, Tab, mũi tên, Backspace, Ctrl+R, Ctrl+số, Alt+←), nhảy tới 39 route (kể cả id không tồn tại), back/forward, đổi kích thước 1024×680 – 1920×1080, cuộn, chờ. Sau **mỗi** bước: không `pageerror` / console error, không ErrorBoundary, trang không trắng, không tràn ngang, IPC ping < 2 s. Hộp thoại file, link ngoài, mở thư mục và relaunch được thay bằng stub trong main (khôi phục / xóa dữ liệu / đăng xuất bị bỏ qua). |
| Phá có chủ đích     | `tests/e2e/abuse.spec.ts`  |           28 | Xem G2. Đo số lần gọi IPC thật bằng cách bọc handler `lq:invoke` trong main (đếm theo kênh, chèn độ trễ, giả lập lỗi "mất mạng" `ai_network`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Seed đã chạy: 101, 202, 303, 404, 505 (× 400 bước, nằm trong bộ test mặc định) và 11, 22, 33, 44, 55, 66 (× 600 bước),
404, 505, 606, 707, 808 (× 400 bước) → **6 800 thao tác ngẫu nhiên khác nhau (hơn 14 000 tính cả các lần chạy lại seed mặc định) thao tác ngẫu nhiên**.

## G2. Test phá có chủ đích (`abuse.spec.ts`)

- Bấm đúp / ba lần + spam Enter trên mọi nút chính → **đúng 1 lần gọi IPC**, nút bị khóa khi đang chờ: lưu từ (Đọc),
  chấm thẻ (nút và phím 1–4), nộp bài viết, Ngữ pháp (Enter ở mọi câu → nộp 1 lần), lựa chọn trong Rạp phim, gửi tin Tutor,
  bài kiểm tra xếp lớp (Xác nhận + Enter), tạo lộ trình, sao lưu, lưu API key.
- Rời trang khi request đang chờ (Writing, Tutor, Lộ trình): không bị kéo về trang cũ, không còn spinner, không lỗi.
- Space / Enter / 1–4 / ↓ / Backspace trên 12 trang không dùng chúng: vẫn ở trang cũ.
- Ctrl+K / F1 lặp lại: chỉ 1 hộp thoại; palette mở trên hộp nhập từ → Esc chỉ đóng palette; ô tìm kiếm ≤ 100 ký tự.
- Nhập rất dài: Tutor 2 500 → 2 000 + bộ đếm; bài viết 10 000 từ → cảnh báo giới hạn ký tự; ghi chú 5 000 → 1 000 + bộ đếm;
  20 ví dụ → "chỉ giữ 8"; tên onboarding 5 000 → 60 + bộ đếm; ô điền Ngữ pháp 2 000 → 400.
- Emoji / RTL / zero-width / từ 75 chữ cái: Tổng quan, Từ vựng, Phiêu lưu, Thống kê, **lật mọi thẻ ôn**, tin nhắn Tutor – không tràn.
- Trang để mở 5 giờ (đồng hồ nhảy) rồi mới làm xong bài Ngữ pháp → vẫn lưu được.
- Mất mạng AI (Tutor, Writing, Lộ trình): lỗi rõ ràng bằng tiếng Việt, giữ bản nháp, "Thử lại" hoạt động khi có mạng.
- Thẻ đang ôn bị xóa ở nơi khác → bỏ qua kèm thông báo, phiên ôn tiếp tục.
- Nút sao chép không bao giờ ném lỗi (đã chép hoặc báo không chép được).
- Tải lại (reload) trên 19 route: app vẫn chạy đúng trang.
- Đổi giao diện sáng/tối + ngôn ngữ liên tục 12 lần: kết quả cuối khớp lần chọn cuối, cả trong DB.
- Phóng to 50 % – 200 % trên 4 trang: thanh bên, thanh trên và nội dung không chồng nhau, cửa sổ không cuộn ngang.
- 8 thẻ chúc mừng + 10 XP đến cùng lúc: chỉ 1 thẻ, có "Còn N" và "Bỏ qua tất cả", toast ≤ 4.
- Hồ sơ mới, dữ liệu trống: 23 trang đều có nội dung / trạng thái trống, không trang nào kẹt loading.
- Micro bị từ chối / không có micro: thông báo rõ ràng, không crash.
- File dữ liệu hỏng khi khởi động: app mở được và giải thích đã khôi phục (`dataRecovery`).

## G3. Lỗi tìm thấy và đã sửa (B39–B55, chi tiết trong `docs/BUGS.md`)

| Mức độ     | Lỗi                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cao        | **B42** Rời trang khi đang nộp bài viết → vài giây sau bị kéo về trang kết quả. **B43** Esc đóng mọi hộp thoại chồng nhau (mở Ctrl+K trong lúc nhập từ mới → mất từ đang nhập). **B46** Ô điền Ngữ pháp > 400 ký tự / chép chính tả > 1 000 → mất cả lượt luyện khi nộp. **B47** Để trang mở vài giờ rồi mới nộp → IPC từ chối thời lượng, mất kết quả (Ngữ pháp, Nghe, Đọc, Phát âm, Nhập vai, Viết).                                |
| Trung bình | **B39** "Sao chép báo cáo" ném lỗi không bắt và không chép được (do monkey seed 404 phát hiện). **B40** Nhiều thao tác async không bắt lỗi. **B41** Lưu API key 2 lần khi Enter + bấm Lưu; `useAction` chưa chống gọi trùng. **B44** Từ rất dài làm thẻ ôn tràn ngang 286 px. **B45** Văn bản dài bị cắt âm thầm, không có bộ đếm. **B53** Thẻ đã bị xóa làm kẹt phiên ôn. **B54** Mục tiêu cũ có ngày dạng timestamp không lưu được. |
| Thấp       | **B48** Chuỗi thẻ chúc mừng không bỏ qua được. **B49** Phóng to 200 % tràn ngang. **B50** Thẻ kế tiếp có thể lộ đáp án 1 khung hình. **B51** Rò rỉ `AudioContext` khi ghi âm, thông báo micro chỉ tiếng Việt. **B52** Chưa có thông báo `dataRecovery`, `db_closed` hiện như lỗi đỏ. **B55** Bấm đúp "Tiếp tục" bỏ qua thẻ chúc mừng kế tiếp.                                                                                         |

Đã làm theo mục 6 (đề nghị của agent IPC): 1 (`dataRecovery`), 2 (`db_closed`), 3 (`not_found` khi ôn; các mã khác đã có
thông điệp tiếng Việt và hiện qua toast / `ErrorState`), 4 (đã hiện "đã nhập / gộp / bỏ qua", không hứa XP), 5 (`targetDate`),
6 (khóa nút + single-flight), 7 (đã kiểm tra: không có `dangerouslySetInnerHTML`, Tutor dùng `RichText` dựng phần tử React),
8 (tên hiển thị chỉ sửa ở onboarding: `maxLength={60}`, một dòng, có bộ đếm).

## G4. Kết quả

`npx electron-vite build` rồi `npx playwright test` (toàn bộ): **56/56 đạt** (abuse 28, monkey 5 × 400 bước, journey 10,
routes 5, modules 5, fonts 3; 8,3 phút). `tsc -p tsconfig.web.json`, `tsc -p tsconfig.e2e.json`, `npx eslint . --max-warnings 0`
và Prettier sạch. Hai test cũ bị chập chờn khi máy bận đã được làm chắc lại: `dismissRewards` (thẻ đang biến mất) và
`fonts.spec` (hỏi lại font tối đa 3 s).

## G5. Rủi ro còn lại

- Monkey test chỉ đi trong một hồ sơ đã qua onboarding và bỏ qua các nút khôi phục / xóa dữ liệu / đăng xuất (chúng khởi
  động lại app); các luồng này chỉ được kiểm tra thủ công.
- Electron không có phím phóng to (menu bị tắt), nên test zoom dùng `setZoomFactor`; trên 150 % một số trang vẫn có bảng /
  biểu đồ cuộn ngang bên trong vùng nội dung (cửa sổ không cuộn ngang).
- Mất mạng được giả lập ở lớp IPC (`ai_network`), không phải mạng thật của main; các luồng đám mây (Supabase, Telegram server)
  không được chạy E2E thật.
- Micro chỉ thử các trường hợp bị từ chối / không có thiết bị; chất lượng ghi âm thật cần kiểm tra thủ công.
- Chống bấm đúp ở renderer dựa vào trạng thái `pending` / ref; các nút mới phải dùng `useAction` hoặc khóa tương tự.

## G6. Việc cần làm phía main (agent IPC)

1. `session.setPermissionCheckHandler` / `setPermissionRequestHandler` chỉ cho `media` → Clipboard API bị từ chối
   (`Write permission denied`). Nên cho phép `clipboard-sanitized-write` với URL của app (renderer đã có dự phòng
   `execCommand`, nhưng API chuẩn nên dùng được).
2. Các trường thời lượng (`durationSec`, `seconds`, `minutes`, `durationMs`) nên được **kẹp** về giới hạn thay vì từ chối
   cả request: renderer đã kẹp, nhưng client cũ / bot Telegram vẫn có thể mất kết quả vì một con số.
3. `search:query` (q ≤ 100) và `vocab:dictionary` (query ≤ 80) trả lỗi validate khi chuỗi dài; với ô tìm kiếm nên cắt chuỗi
   thay vì báo lỗi (renderer đã giới hạn độ dài ô nhập).

**Đã xử lý (B56):** cả 3 việc đã làm – cho phép `clipboard-sanitized-write` với URL của app; mọi trường thời lượng dùng
`clampedNumber()` (kẹp về giới hạn, vẫn từ chối NaN / Infinity / sai kiểu); `search:query` và `vocab:dictionary` dùng
`truncatedText()` (cắt theo ký tự Unicode, tối đa 10 000 ký tự đầu vào). Test: `tests/unit/ipc-schemas.test.ts`.
