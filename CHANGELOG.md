# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), phiên bản theo SemVer.

## [1.1.0] – 2026-11-05
### Thay đổi
- **Giao diện Windows 11 (Fluent):**
  - Màu phẳng, nền Mica, lớp nội dung giống app Settings.
  - Sidebar kiểu NavigationView, accent xanh Windows, bo góc 4–8 px.
  - Bỏ toàn bộ gradient, quầng sáng và hiệu ứng kính mờ.
- **Font:**
  - Dùng font hệ thống Segoe UI Variable thay cho font web.
  - IPA cũng dùng Segoe để không bị lẫn font.
  - Có kiểm tra tự động `scripts/check_text.py` và E2E `fonts.spec.ts`.

### Thêm mới
- **Huấn luyện AI:**
  - Ghi lại thói quen học: phiên học, thời gian thực sự học, giờ và ngày hay học, nhịp độ, hiệu quả nhắc nhở.
  - Thống kê theo ngày, tuần, tháng.
  - AI phân tích và đưa lời khuyên, kế hoạch "Áp dụng" vào lịch học, mục hỏi đáp về thói quen.
- **Lịch thông báo:** brief buổi sáng, nhắc buổi tối, báo cáo ngày/tuần/tháng; gửi qua thông báo Windows và Telegram, có gửi bù khi máy tắt.
- **Bot Telegram trong app:**
  - Gia sư AI hiểu văn bản, ảnh và giọng nói.
  - Lệnh: `/today`, `/review` (ôn thẻ bằng nút bấm), `/word`, `/quiz`, `/anh`, `/report`, `/advice`, `/habits`, `/plan`, `/reset`, `/help`.
  - Liên kết tài khoản bằng mã ghép đôi.
- **Chạy nền:** biểu tượng ở khay hệ thống, tùy chọn khởi động cùng Windows.
- **Bản phát hành 1.1.0:**

  | File | Kích thước | SHA-256 |
  |---|---|---|
  | `Lingua-Quest-Setup-1.1.0.exe` | 133 163 493 byte | `47f74093b906c47a947711ccbf9aaebbf3bd0ce1819dcd8eb18daecb77556217` |
  | `Lingua-Quest-Portable-1.1.0.exe` | 116 313 653 byte | `8b671d3d22594c67981f296c0ef309c156e8b5f18305a4f9fc27735bce3cc7d7` |

- **Kiểm thử:** 366/366 test Vitest, 23/23 E2E trên bản đóng gói (gồm 3 test font).
- **Chuyển từ bot cũ:** tự nhập token, chat_id và key Gemini (mã hóa DPAPI), rồi xóa file cấu hình dạng chữ thường. Bot Python cũ và 2 tác vụ Windows của nó đã được gỡ.

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

### Bản phát hành
| File | Kích thước | SHA-256 |
|---|---|---|
| `Lingua-Quest-Setup-1.0.0.exe` | 133 274 042 byte | `49e94c98d9ad1e9997a68f51887c7a5ff84f14dd3ecc0a36c43c71c6b651e333` |
| `Lingua-Quest-Portable-1.0.0.exe` | 116 419 559 byte | `6492f7c9a590dca56bc97d134cf077b28c51598610c526d4a40af299e445ab09` |

Bản build chưa được ký số (không có chứng chỉ code signing), nên Windows SmartScreen có thể cảnh báo khi chạy lần đầu.
