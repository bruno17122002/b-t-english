# B&T English

Ứng dụng desktop Windows giúp người Việt học tiếng Anh **từ con số 0 đến IELTS 6.5 (CEFR B2)**:

- học theo lộ trình cá nhân hóa;
- dùng AI (Google Gemini và OpenAI);
- có phim tương tác, bản đồ phiêu lưu RPG và ôn từ vựng theo thuật toán FSRS.

Ứng dụng chạy local-first: dữ liệu học tập nằm trên máy bạn, và phần lớn tính năng vẫn dùng được khi không có Internet hay API key.

## Tính năng

| Khu vực           | Nội dung                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hành trình        | Onboarding, bài đánh giá trình độ thích ứng theo từng kỹ năng, lộ trình 12 tuần do AI tạo (hoặc tạo offline), giáo trình A1→C2, kế hoạch học mỗi ngày, mục tiêu                  |
| Listening Lab     | 12 bài hội thoại gốc, nghe 3 tầng (nghe ý chính → chép chính tả có cho thử lại → nhại theo), chỉnh tốc độ và giọng vùng, AI tạo bài mới                                          |
| Speaking Studio   | Shadowing, lặp câu, đóng vai với AI, thẻ đề IELTS; đo thời lượng, khoảng ngắt và WPM; AI nhận xét; lộ trình phát âm theo âm vị                                                   |
| Reading Adventure | 18 bài đọc gốc, bấm vào từ để tra và lưu, highlight kèm ghi chú, đo tốc độ đọc, quiz, AI tạo bài mới và giải thích câu                                                           |
| Writing Workshop  | Nhiều dạng đề (email, đoạn văn, essay IELTS…), chỉ số viết đo trực tiếp, AI sửa lỗi kèm giải thích tiếng Việt, so sánh bản gốc và bản sửa, vòng tự sửa                           |
| Grammar Kingdom   | 20 chủ điểm ngữ pháp và 140 bài tập; AI tạo bài tập thêm và giải thích lỗi sai                                                                                                   |
| Cinema Mode       | 7 phim tương tác gốc (80 cảnh), lời thoại có giọng đọc, phụ đề EN/VI, lựa chọn rẽ nhánh, quiz, nhiều kết thúc; AI viết phim mới                                                  |
| Từ vựng           | Một kho từ chung cho mọi module, lịch ôn FSRS (ts-fsrs), luyện chính tả, nghĩa, điền từ; từ điển offline 472 từ                                                                  |
| Gia sư AI         | 7 phong cách, ghi nhớ lỗi hay lặp lại, sửa lỗi ngay trong câu, nói bằng giọng                                                                                                    |
| Phiêu lưu         | XP, level, chuỗi ngày học (mỗi tuần được nghỉ một ngày), bản đồ 7 vùng, nhiệm vụ ngày/tuần, 27 thành tích, mở khóa màu giao diện                                                 |
| Thống kê          | Biểu đồ phút học, XP, kỹ năng, tốc độ đọc, độ chính xác khi nghe, điểm viết, lịch hoạt động                                                                                      |
| Huấn luyện AI     | Ghi lại thói quen học, thống kê ngày/tuần/tháng, AI phân tích và khuyên cách học, kế hoạch áp dụng được, lịch nhắc và báo cáo qua Windows và Telegram                            |
| Bot Telegram      | Gia sư AI (chữ, ảnh, giọng nói), ôn thẻ bằng nút bấm, từ của ngày, quiz, tạo ảnh, báo cáo; nằm ngay trong app (Cài đặt → Telegram)                                               |
| Tiện ích          | Tìm kiếm toàn cục (Ctrl+K), yêu thích và đánh dấu, nhắc học, sao lưu/khôi phục, nhập/xuất CSV/JSON, chẩn đoán, phím tắt (F1), giao diện sáng/tối, giao diện tiếng Anh/tiếng Việt |

## Cài đặt (người dùng)

1. Chạy `Lingua-Quest-Setup-<phiên bản>.exe`. Không cần quyền admin, và bạn có thể chọn thư mục cài đặt. Nếu không muốn cài, dùng bản `Lingua-Quest-Portable-<phiên bản>.exe`.
2. Lần đầu mở, Windows SmartScreen có thể cảnh báo vì bản build chưa được ký số. Chọn **More info → Run anyway**.
3. Làm theo phần onboarding, rồi vào **Cài đặt → Nhà cung cấp AI** để dán API key (không bắt buộc). Có thể lấy key tại:
   - Gemini: <https://aistudio.google.com/apikey>
   - OpenAI: <https://platform.openai.com/api-keys>

**Về API key:**

- Key được mã hóa bằng Windows DPAPI và lưu trong `%APPDATA%\B&T English\secure\keys.bin`.
- Key chỉ được dùng ở tiến trình nền của ứng dụng, không bao giờ hiển thị lại, không ghi vào log, file sao lưu hay file xuất.

**Dữ liệu ứng dụng:**

| Loại            | Vị trí                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| Cơ sở dữ liệu   | `%APPDATA%\B&T English\data\lingua-quest.sqlite`                         |
| Sao lưu tự động | `%APPDATA%\B&T English\backups\` (mỗi ngày một bản, giữ 10 bản gần nhất) |
| Nhật ký         | `%APPDATA%\B&T English\logs\`                                            |

Gỡ cài đặt **không** xóa dữ liệu học tập.

## Phát triển

Yêu cầu: Windows 10/11, Node.js 20.19+ hoặc 22.12+ (dự án dùng Node 20.20, xem `.nvmrc`), Python 3 kèm Pillow (chỉ cần khi tạo lại icon).

```bash
npm install
npm run dev          # chạy app với hot reload
npm run typecheck    # TypeScript strict cho main/preload/core và renderer
npm run lint         # ESLint
npm test             # unit + integration (Vitest)
npm run test:e2e     # build + E2E (Playwright điều khiển Electron thật, AI giả lập)
npm run dist         # build installer NSIS + bản portable vào thư mục release/
```

Biến môi trường dùng khi kiểm thử:

| Biến                     | Tác dụng                   |
| ------------------------ | -------------------------- |
| `LQ_E2E=1`               | Dùng AI giả lập cố định    |
| `LQ_USER_DATA=<thư mục>` | Dùng thư mục dữ liệu riêng |

## Kiến trúc

Xem `ARCHITECTURE.md` (kiến trúc module v2) và `docs/MODULE_GUIDE.md` (cách viết module). Tóm tắt:

- **Một ứng dụng Electron duy nhất** chia module. `src/main/kernel` là Platform Kernel, gồm:
  - SQLite (sql.js) và migrations;
  - AI Gateway: Gemini/OpenAI, Prompt Library có version và schema zod, ràng buộc ngôn ngữ theo CEFR;
  - Learner, Vocab Hub (FSRS), Progress (XP/quest/achievement), Content, Search, Data.
- **Mỗi module** nằm trong `src/modules/<id>/`, gồm `contract.ts` (IPC + zod), `main/` (service, prompt) và `renderer/` (trang React).
- **Bảo mật:**
  - `contextIsolation`, `sandbox`, CSP chặt;
  - preload chỉ cho phép các channel có trong contract, mọi input đều được validate bằng zod;
  - chỉ cấp quyền micro cho chính ứng dụng.

## Nội dung và giấy phép

- Toàn bộ bài đọc, bài nghe, phim tương tác, đề đánh giá và từ điển là **nội dung gốc** viết cho B&T English.
- Ứng dụng tái sử dụng có ghi công một số dự án MIT:
  - Sprigo: khung giáo trình;
  - Cadence: dữ liệu phát âm và thuật toán căn chỉnh âm vị;
  - ts-fsrs: thuật toán ôn tập;
  - VocabReader: ý tưởng prompt.

  Chi tiết và toàn văn giấy phép nằm trong `THIRD_PARTY_NOTICES.md`.

- Báo cáo nghiên cứu mã nguồn mở: `docs/OSS_RESEARCH.md`.
