# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), phiên bản theo SemVer.

## [1.5.0] – 2026-11-06

### Đổi tên thành B&T English

- **Tên mới:** "B&T English" ở cửa sổ, khay hệ thống, thông báo, bộ cài, lối tắt, bot Telegram, app điện thoại (PWA) và các prompt AI.
- **Logo mới (tự vẽ):**
  - Hai chữ B và T dùng chung một nét ngang, bên dưới là một nét bút gạch chân.
  - Màu xanh Windows 11 `#005FB8`, không gradient.
  - Nguồn: `build/logo.svg`. Bộ icon (`.ico`, PNG, PWA) được tạo lại từ file này.
- **Tên file:**
  - Không còn dấu "&": `BTEnglish.exe`, `BT-English-Setup-x.y.z.exe`, `BT-English-Portable-x.y.z.exe`.
  - Tin nhắn Telegram dạng HTML dùng `B&amp;T` để tránh lỗi phân tích.
- **Giữ tương thích:**
  - `appId` không đổi, nên cài đè lên bản cũ như một bản cập nhật.
  - Thư mục dữ liệu vẫn là `%APPDATA%\Lingua Quest`, nên không mất tiến độ học.
  - Tên file sao lưu, xuất dữ liệu và bucket cloud giữ nguyên định dạng cũ.
- **Server Supabase:** mã bot đã đổi tên, nhưng cần deploy lại Edge Functions thì bot trên server mới hiện tên mới.
- **Kiểm thử:**
  - 644 test Vitest và 56 test Playwright đều đạt.
  - Đã chạy thử bản đóng gói: cửa sổ "B&T English", phiên bản 1.5.0, log không có lỗi.
- **Bản phát hành:**

  | File                            | Kích thước       | SHA-256                                                            |
  | ------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `BT-English-Setup-1.5.0.exe`    | 133 199 754 byte | `26f62e36597d1b760a4df43018f7a4bbb19b0c48d97ccf7f2fa5426f46abaf21` |
  | `BT-English-Portable-1.5.0.exe` | 116 340 568 byte | `17341c81b3b688bff51c33d406238c6be67d2e085610e66c96c804b6b93a8eef` |

## [1.4.0] – 2026-11-06

### Đề không còn "tĩnh"

- **Kiểm tra đầu vào:**
  - Mỗi lần làm lại là một đề khác: câu hỏi được rút ngẫu nhiên trong ngân hàng (gấp đôi, 192 câu), đáp án xáo trộn, đề viết / nói chọn ngẫu nhiên trong 6 đề mỗi loại.
  - Tiếp tục bài đang làm dở vẫn giữ nguyên câu và thứ tự.
- **Ngữ pháp:** mỗi lượt (kể cả "Làm lại") xáo trộn thứ tự bài tập và đáp án.
- **Đọc, Nghe, Phim:**
  - Xáo trộn thứ tự câu hỏi và đáp án mỗi lần làm.
  - Lựa chọn hội thoại trong phim không còn luôn để câu hay nhất ở vị trí 1.
- **Phát âm:** thứ tự từ trong bài luyện và bài kiểm tra thay đổi mỗi lần.
- **Giữ nguyên thứ tự có chủ đích:** True / False / Not Given, "All of the above", thứ tự lời thoại khi chép chính tả, hàng đợi ôn thẻ SRS.

### Chống "phá app" trước khi phát hành công khai

Đợt kiểm thử lạm dụng: sửa 39 lỗi (B18–B56), chi tiết trong `docs/QA_ABUSE_REPORT.md` và `docs/BUGS.md`.

- **Dữ liệu và IPC:**
  - Fuzz 168 kênh IPC (hơn 20 000 lần gọi).
  - DB hỏng hoặc 0 byte tự mở bản `.bak` hoặc tạo DB mới, có thông báo; không còn ghi đè bản `.bak` tốt.
  - Khôi phục sao lưu không còn bị ghi đè trước khi khởi động lại.
  - Bấm đúp không còn nhân đôi bản ghi hay XP.
  - Đồng hồ lùi không làm kẹt thẻ ôn.
  - Nhập từ vựng nhanh hơn khoảng 25 lần và không còn cộng XP.
  - CSV xuất ra an toàn với Excel.
  - Lỗi luôn bằng tiếng Việt, không lộ đường dẫn hay key.
- **Giao diện:**
  - Monkey test ngẫu nhiên khoảng 14 000 thao tác, cộng 28 kịch bản phá có chủ đích.
  - Esc chỉ đóng hộp thoại trên cùng.
  - Kết quả về trễ không còn kéo người học về trang cũ.
  - Mọi nút khoá khi đang chờ.
  - Ô nhập có bộ đếm và giới hạn theo contract.
  - Từ rất dài không làm vỡ bố cục; phóng to 200 % vẫn dùng được.
  - Chúc mừng hàng loạt có "Bỏ qua tất cả".
  - Micro bị từ chối báo lỗi rõ ràng.
- **Bền hơn với dữ liệu lạ:**
  - Thời lượng vượt giới hạn (trang để mở qua đêm) được kẹp thay vì làm mất kết quả bài.
  - Câu tìm kiếm quá dài bị cắt thay vì báo lỗi.
  - Nút sao chép dùng được Clipboard API.
- **Kiểm thử:** 644 test Vitest và 56 test Playwright.
- **Bản phát hành:** đã chạy thử bản đóng gói (khởi động, tạo dữ liệu mới, không lỗi trong log).

  | File                              | Kích thước       | SHA-256                                                            |
  | --------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `Lingua-Quest-Setup-1.4.0.exe`    | 133 418 550 byte | `afd47547b9486b28383d92718c2075dc3f7bf31096c1a06214062d43fee4e224` |
  | `Lingua-Quest-Portable-1.4.0.exe` | 116 622 186 byte | `afccb86531796550b70eb28133ecef805738f15e730a77330115452a55e57a04` |

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

  | File                              | Kích thước       | SHA-256                                                            |
  | --------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `Lingua-Quest-Setup-1.3.0.exe`    | 133 392 419 byte | `345bb11b8920a5ffd0e2547d9e83d668ea3a5f3cc50ffc4d1a4acfdc034bcbb9` |
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

  | File                              | Kích thước       | SHA-256                                                            |
  | --------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `Lingua-Quest-Setup-1.2.0.exe`    | 133 185 588 byte | `4bac32b1c6961f2dcfb9bff9be231ddbf32e3efce2dcc712763246beb50d1054` |
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

  | File                              | Kích thước       | SHA-256                                                            |
  | --------------------------------- | ---------------- | ------------------------------------------------------------------ |
  | `Lingua-Quest-Setup-1.1.0.exe`    | 133 163 493 byte | `47f74093b906c47a947711ccbf9aaebbf3bd0ce1819dcd8eb18daecb77556217` |
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

| File                              | Kích thước       | SHA-256                                                            |
| --------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `Lingua-Quest-Setup-1.0.0.exe`    | 133 274 042 byte | `49e94c98d9ad1e9997a68f51887c7a5ff84f14dd3ecc0a36c43c71c6b651e333` |
| `Lingua-Quest-Portable-1.0.0.exe` | 116 419 559 byte | `6492f7c9a590dca56bc97d134cf077b28c51598610c526d4a40af299e445ab09` |

Bản build chưa được ký số (không có chứng chỉ code signing), nên Windows SmartScreen có thể cảnh báo khi chạy lần đầu.
