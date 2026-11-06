# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), phiên bản theo SemVer.

## [1.3.0] – 2026-11-06
### Bảo vệ mã nguồn
- **Tiến trình chính:**
  - Biên dịch sang V8 bytecode (`out/main/index.jsc`), không còn mã JavaScript đọc được.
  - Tên hàm và class bị loại bỏ.
- **Preload và giao diện:** nén (minify), không kèm source map.
- **Electron Fuses:**
  - Tắt `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` và `--inspect`.
  - Chỉ nạp code từ `app.asar`, có kiểm tra toàn vẹn ASAR.
  - Mã hóa cookie.
- **Bản phát hành:**
  - Từ chối các cờ gỡ lỗi (`--inspect`, `--remote-debugging-port`…).
  - Không còn cách bật DevTools.
  - Bỏ qua chế độ kiểm thử `LQ_E2E`.
- **Installer:** có trang Thỏa thuận cấp phép người dùng (EULA) song ngữ, cấm dịch ngược và phân phối lại.
- **Đã kiểm chứng trên bản đóng gói:**
  - Bản gốc chạy bình thường.
  - Gói bị sửa mục lục hoặc bị đóng gói lại với code đã chỉnh đều bị từ chối khởi động.
- **Giới hạn còn lại:** các chuỗi văn bản (gồm prompt AI) vẫn nằm trong bytecode dưới dạng UTF-16, công cụ chuyên dụng vẫn trích ra được. Muốn giấu hoàn toàn phải chuyển prompt lên server.
- **Hệ quả cho kiểm thử:** Playwright không gắn được vào bản phát hành (fuse `--inspect`). E2E chạy trên bản build từ cùng mã nguồn (`out/`, cũng là bytecode); bản đóng gói được kiểm bằng phép chạy thử và phép thử chống sửa đổi.
- **Bản phát hành:**

  | File | Kích thước | SHA-256 |
  |---|---|---|
  | `Lingua-Quest-Setup-1.3.0.exe` | 133 392 419 byte | `345bb11b8920a5ffd0e2547d9e83d668ea3a5f3cc50ffc4d1a4acfdc034bcbb9` |
  | `Lingua-Quest-Portable-1.3.0.exe` | 116 597 845 byte | `d222d55db96b9a09b94c07073c949ca29079d9244e1921463c897f32a396d7cd` |

### Sửa lỗi
- App giải thích rõ lỗi gửi email mã đăng nhập từ Supabase (SMTP, mẫu email).
- Test nhiệm vụ "nói" phụ thuộc ngày chạy (B17).

## [1.2.0] – 2026-11-05
### Sửa lỗi
- **Âm thanh bị phát chồng khi bấm nhiều lần:** trình phát mới theo "thế hệ"; mỗi lệnh phát mới hủy mọi lệnh cũ, kể cả bản đang tải (B14).
- **Âm thanh phát chậm (B15):**
  - Ưu tiên giọng Windows offline.
  - Lưu giọng AI trên đĩa (tối đa 150 MB).
  - Tải trước câu kế tiếp và chia câu dài.
- **Nhãn trạng thái và ô (B16):**
  - Màu nhãn CEFR theo chủ đề sáng/tối.
  - Tiêu đề viết chữ thường kiểu Fluent.
  - Nút tắt màu xám trung tính.
  - Ô chọn có mũi tên riêng.

### Thêm mới – Lingua Quest Online (tùy chọn)
- **GĐ1 – Tài khoản:**
  - Đăng nhập bằng mã email; phiên đăng nhập mã hóa DPAPI.
  - Sao lưu, khôi phục cloud; tự sao lưu hằng ngày.
  - Xóa toàn bộ dữ liệu cloud.
- **GĐ2 – Server:**
  - Bot Telegram chạy trên Supabase, vẫn hoạt động khi máy tắt.
  - Lịch gửi brief, nhắc học và báo cáo theo múi giờ.
  - Function gia sư cho điện thoại.
  - App có công tắc "Bot chạy trên máy này / trên server".
- **GĐ3 – Đồng bộ nhiều máy:**
  - Ghi nhận thay đổi bằng trigger, push/pull theo `seq`.
  - Bản sửa sau cùng được giữ; log chỉ được ghi thêm nên không trùng; thống kê được tính lại.
- **GĐ4 – App điện thoại (PWA, thư mục `web/`):** Hôm nay, ôn thẻ FSRS (ôn được cả khi offline), thống kê, báo cáo AI, gia sư.
- **Tài liệu:**
  - `docs/ONLINE_PLAN.md`: thiết kế và hợp đồng dữ liệu đồng bộ.
  - `supabase/README.md`: hướng dẫn triển khai.
  - `web/README.md`.
- **Kiểm thử:** 522/522 Vitest, 23/23 E2E trên bản đóng gói.
- **Bản phát hành:**

  | File | Kích thước | SHA-256 |
  |---|---|---|
  | `Lingua-Quest-Setup-1.2.0.exe` | 133 185 588 byte | `4bac32b1c6961f2dcfb9bff9be231ddbf32e3efce2dcc712763246beb50d1054` |
  | `Lingua-Quest-Portable-1.2.0.exe` | 116 326 481 byte | `cd72f3278e6c08acd3097f9990c423118991320c9ce5dd0271182e314dbfb882` |

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
