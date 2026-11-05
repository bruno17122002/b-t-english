# Nhật ký lỗi – Lingua Quest

Mỗi lỗi ghi theo các mục: triệu chứng → nguyên nhân gốc → cách sửa → test hồi quy.

| # | Phát hiện bởi | Triệu chứng | Nguyên nhân gốc | Cách sửa | Test hồi quy |
|---|---|---|---|---|---|
| B1 | `tsc` (agent content pack) | `src/core/srs.ts` không biên dịch: không có `model.forgetting_curve` | ts-fsrs 6.0 không công khai hàm forgetting curve trên `model` | Tự tính đường quên FSRS-6 từ `default_w[20]`: R(S,S) = 0.9 | `engine.test.ts` › retrievability is 0.9… |
| B2 | Integration test | Tìm "hai dang" không thấy từ "ngọn hải đăng" trong kho từ | Tìm từ vựng dùng SQL `LIKE`, không bỏ dấu tiếng Việt | Lọc bằng JS sau khi chuẩn hóa NFD, bỏ dấu, đổi đ → d | `kernel.test.ts` › searches … without diacritics |
| B3 | Unit test | Quest "kỹ năng yếu" chọn Listening dù Speaking yếu hơn | Hàm `generateDailyQuests` lấy quest theo thứ tự khai báo, bỏ qua thứ tự độ yếu | Duyệt `weakestSkills` theo thứ tự yếu nhất trước | `engine.test.ts` › generates stable, personalised quests |
| B4 | Rà soát route | Quest ngữ pháp mở `/journey` thay vì Grammar Kingdom | Route trong template quest bị cũ | Đổi thành `/grammar` | E2E điều hướng quest |
| B5 | ESLint | Ký tự BOM thật nằm trong mã nguồn | Ký tự U+FEFF được dán trực tiếp vào regex | Dùng hằng `BOM = String.fromCharCode(0xfeff)` | `kernel-storage.test.ts` › CSV parser |
