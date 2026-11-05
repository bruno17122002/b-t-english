# Nhật ký lỗi – Lingua Quest

Mỗi lỗi ghi theo các mục: triệu chứng → nguyên nhân gốc → cách sửa → test hồi quy.

| # | Phát hiện bởi | Triệu chứng | Nguyên nhân gốc | Cách sửa | Test hồi quy |
|---|---|---|---|---|---|
| B1 | `tsc` (agent content pack) | `src/core/srs.ts` không biên dịch: không có `model.forgetting_curve` | ts-fsrs 6.0 không công khai hàm forgetting curve trên `model` | Tự tính đường quên FSRS-6 từ `default_w[20]`: R(S,S) = 0.9 | `engine.test.ts` › retrievability is 0.9… |
| B2 | Integration test | Tìm "hai dang" không thấy từ "ngọn hải đăng" trong kho từ | Tìm từ vựng dùng SQL `LIKE`, không bỏ dấu tiếng Việt | Lọc bằng JS sau khi chuẩn hóa NFD, bỏ dấu, đổi đ → d | `kernel.test.ts` › searches … without diacritics |
| B3 | Unit test | Quest "kỹ năng yếu" chọn Listening dù Speaking yếu hơn | Hàm `generateDailyQuests` lấy quest theo thứ tự khai báo, bỏ qua thứ tự độ yếu | Duyệt `weakestSkills` theo thứ tự yếu nhất trước | `engine.test.ts` › generates stable, personalised quests |
| B4 | Rà soát route | Quest ngữ pháp mở `/journey` thay vì Grammar Kingdom | Route trong template quest bị cũ | Đổi thành `/grammar` | E2E điều hướng quest |
| B6 | Agent Speaking | Bản ghi âm bị mất khi chạm giới hạn thời gian và tự dừng | `useRecorder` chỉ trả kết quả cho lời gọi `stop()` thủ công | Thêm callback `onAutoStop`; `RecordButton` nhận được bản ghi trong cả hai trường hợp | Kiểm tra thủ công + E2E route Speaking |
| B7 | E2E | App thoát ngay khi được khởi chạy bằng `electron out/main/index.js` | `app.getAppPath()` trỏ vào `out/main` nên không tìm thấy `sql-wasm.wasm` | Thêm dự phòng: tìm bằng `require.resolve('sql.js')`; E2E khởi chạy từ thư mục gốc dự án | Mọi test E2E |
| B8 | Review ảnh chụp | Rạp phim mất poster và tiêu đề, khiên level chồng chữ, lưới bị vỡ | Tailwind v4 chỉ quét `src/renderer` (root của Vite), bỏ sót class trong `src/modules` | Thêm `@source '../../modules'` (CSS tăng từ 47 KB lên 105 KB) | E2E quét route + so sánh ảnh |
| B9 | Review ảnh chụp | Ô lọc ở Phòng nghe và Rạp phim chiếm cả dòng | `Select`/`Input` luôn có `w-full`, đè lên `w-28` / `w-auto` của module | Chỉ thêm `w-full` khi caller không tự đặt độ rộng | E2E quét route |
| B10 | E2E bàn phím | Bấm Esc ngay sau Ctrl+K không đóng hộp tìm kiếm | Esc chỉ được bắt khi ô nhập đã có focus | Bắt Esc ở `window` khi palette đang mở | `routes.spec.ts` › keyboard |
| B11 | E2E | Hộp chúc mừng thành tích chỉ đóng được bằng chuột | Thiếu phím tắt | Esc đóng hộp, nút "Tiếp tục" tự nhận focus | `journey.spec.ts` |
| B12 | Agent Cinema | Số "kết thúc tốt" giảm khi xem lại phim | Thống kê đếm theo `story_progress` (bị ghi đè khi xem lại) | Đếm từ `activity_log` (`story_completed` với score 1) | `cinema.test.ts` |
| B13 | Đo font bằng CDP | Phiên âm IPA (/ˈhʌŋɡri/, /ɜː/, /ɡ/) bị vẽ lẫn hai font Cascadia Mono và Consolas | Cascadia Mono thiếu các ký tự IPA ˈ ɒ ɜ ɹ ɡ ɾ nên Chromium phải mượn font khác | `font-mono` dùng Segoe UI Variable với số đều cột | `fonts.spec.ts`: 100% glyph vẽ bằng Segoe UI Variable, ngoại trừ emoji |
| B14 | Người dùng | Bấm phát nhiều lần thì âm thanh phát chồng lên nhau | `speak()` chỉ dừng âm đang phát, không hủy yêu cầu giọng AI còn đang tải; chuỗi hội thoại không bị lệnh phát mới hủy | Bộ điều khiển phát theo "thế hệ": lệnh mới hủy mọi thứ cũ, kể cả bản đang tải; promise cũ kết thúc ngay | `audio-controller.test.ts` (7) |
| B15 | Người dùng | Âm thanh phát chậm | Mặc định chọn giọng Windows "Online (Natural)", mỗi câu phải gọi mạng; giọng AI không có cache đĩa và không tải trước | Ưu tiên giọng offline (`localService`), tải sẵn danh sách giọng, cache giọng AI trên đĩa (LRU 150 MB), tải trước câu kế tiếp, chia câu dài | `audio-controller.test.ts`, `tts-cache.test.ts` |
| B16 | Người dùng | Nhãn trạng thái và ô nhìn xấu | Nhãn CEFR dùng màu neon, chữ HOA giãn rộng, nút tắt bị làm mờ, ô chọn dùng mũi tên mặc định và bị cắt chữ | Màu CEFR theo chủ đề, chữ thường kiểu Fluent, nút tắt màu xám trung tính, `.lq-select` có chevron riêng, biến thể `dark:` theo chủ đề app | E2E quét route + ảnh chụp |
| B5 | ESLint | Ký tự BOM thật nằm trong mã nguồn | Ký tự U+FEFF được dán trực tiếp vào regex | Dùng hằng `BOM = String.fromCharCode(0xfeff)` | `kernel-storage.test.ts` › CSV parser |
