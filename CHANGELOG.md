# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), phiên bản theo SemVer.

## [1.0.0] – 2026-11-05
### Thêm mới
- **Platform Kernel:**
  - SQLite (sql.js) với migration v1–v3 và migration theo module; ghi atomic, có `.bak` và tự khôi phục khi file hỏng.
  - AI Gateway cho Gemini, OpenAI và Mock, gồm Prompt Library có version và schema zod, ràng buộc ngôn ngữ theo CEFR, tự sửa JSON 1 vòng, kiểm tra lộ đáp án.
  - Key store mã hóa bằng DPAPI.
  - Learner (hồ sơ, CEFR, bộ nhớ lỗi), Progress (XP, quest, achievement, streak có ngày nghỉ), Vocab Hub dùng ts-fsrs, tìm kiếm không dấu, sao lưu/khôi phục, nhập/xuất CSV/JSON, nhật ký tự che key.
- **10 module:**
  - Journey: onboarding, đánh giá thích ứng, roadmap 12 tuần, giáo trình A1→C2, kế hoạch ngày, dashboard.
  - Listening Lab: nghe 3 tầng, chép chính tả, AI tạo bài.
  - Speaking Studio: shadowing, đóng vai, IELTS, Pronunciation Path.
  - Reading Adventure: tra từ, highlight, WPM, quiz, AI tạo bài.
  - Writing Workshop: AI chấm, diff, vòng tự sửa.
  - Grammar Kingdom.
  - Cinema Mode: 7 phim, 80 cảnh, AI viết phim.
  - Từ vựng: ôn FSRS, luyện tập, từ điển.
  - AI Tutor 7 chế độ.
  - Phiêu lưu và Thống kê: bản đồ 7 vùng, biểu đồ SVG.
- **Shell:**
  - Giao diện tối/sáng, 5 màu nhấn mở khóa theo level, song ngữ Anh/Việt.
  - Ctrl+K, phím tắt F1, toast, hiệu ứng nhận thưởng, nhắc học bằng thông báo Windows.
- **Content pack:** khung giáo trình Sprigo (MIT) và dữ liệu phát âm Cadence (MIT), kèm `THIRD_PARTY_NOTICES.md`.
- **Kiểm thử và đóng gói:**
  - Bộ test Vitest (unit, renderer, integration) và Playwright E2E chạy trên Electron thật.
  - Cấu hình electron-builder: NSIS và portable.

### Sửa lỗi
- Xem `docs/BUGS.md` (B1–B12).
