# TASKS – Lingua Quest

Trạng thái: `TODO` / `IN_PROGRESS` / `COMPLETED` / `BLOCKED`. Chỉ `COMPLETED` khi có bằng chứng kiểm tra (cột "Bằng chứng").

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 0.1 | Khảo sát môi trường | COMPLETED | PLAN.md mục PHASE 0 |
| 1.1 | Tài liệu PLAN/ARCHITECTURE/TASKS/TEST_PLAN/CHANGELOG | COMPLETED | Các file ở gốc dự án |
| 2.1 | Khung Electron + Vite + React + TS strict + Tailwind | IN_PROGRESS | Cấu hình + dependencies đã cài; `tsc` sạch cho core/db |
| 2.2 | Database layer (sql.js, migrations, backup atomic) | IN_PROGRESS | Code xong, `tsc` sạch; chưa có unit test |
| 2.3 | IPC contract + validation + preload allowlist | TODO | |
| 2.4 | Secure key store (safeStorage) | TODO | |
| 2.5 | Learning engine: FSRS, XP/level, streak, quests, achievements, CEFR | IN_PROGRESS | Code xong, `tsc` sạch; chưa có unit test |
| 2.6 | AI adapters Gemini + OpenAI + Mock, AIService | TODO | |
| 2.7 | Nội dung nguyên bản (reading, listening, grammar, writing, speaking, cinema, assessment, dictionary) | IN_PROGRESS | |
| 2.8 | Onboarding + đánh giá trình độ + roadmap | TODO | |
| 2.9 | Listening Lab | TODO | |
| 2.10 | Speaking Studio | TODO | |
| 2.11 | Reading Adventure | TODO | |
| 2.12 | Writing Workshop | TODO | |
| 2.13 | Cinema Mode | TODO | |
| 2.14 | Game Mode (map, quests, achievements) | TODO | |
| 2.15 | Vocabulary & Review (FSRS flashcards) | TODO | |
| 2.16 | AI Tutor | TODO | |
| 2.17 | Dashboard, Journey, Statistics, Calendar | TODO | |
| 2.18 | Settings, AI Settings, backup/restore, import/export, diagnostics | TODO | |
| 2.19 | Global search, favorites, bookmarks, notifications, shortcuts | TODO | |
| 3.1 | Static analysis (tsc, ESLint, Prettier, npm audit) | TODO | |
| 3.2 | Unit tests | TODO | |
| 3.3 | Integration tests | TODO | |
| 3.4 | E2E Playwright | TODO | |
| 3.5 | UI/UX review + screenshots | TODO | |
| 3.6 | Bug fixing + regression | TODO | |
| 4.1 | Release gate checklist | TODO | |
| 4.2 | Electron Builder: installer + portable | TODO | |
| 4.3 | Kiểm tra installer sau build | TODO | |

## Nghiên cứu mã nguồn mở & kiến trúc All-in-One (2026-11-05)

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| R.1 | Tạm dừng tính năng mới, đánh giá hiện trạng | COMPLETED | `docs/OSS_RESEARCH.md` mục 1; `tsc --noEmit` sạch |
| R.2 | Xác định và tải 6 repo (chỉ đọc, `D:\lq-oss`) | COMPLETED | `docs/OSS_RESEARCH.md` mục 2 |
| R.3 | Kiểm tra license / công nghệ / dependency / bảo trì / bảo mật | COMPLETED | `docs/OSS_RESEARCH.md` mục 3 |
| R.4 | So sánh phương án tích hợp, đề xuất kiến trúc All-in-One | COMPLETED | `docs/OSS_RESEARCH.md` mục 4–5, `ARCHITECTURE.md` "Đề xuất v2" |
| R.5 | Người dùng duyệt đề xuất | BLOCKED | Chờ người dùng |

### Việc dự kiến nếu đề xuất được duyệt
| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| K.1 | Kernel: module manifest + route manifest + event bus LearningEvent | TODO | |
| K.2 | AI Gateway: Prompt Library (version + zod), ràng buộc CEFR, kiểm tra lộ đáp án | TODO | |
| K.3 | Vocab Hub chuyển `core/srs.ts` thành adapter `ts-fsrs` (giữ API, giữ test) | TODO | |
| K.4 | Migrations có namespace theo module | TODO | |
| C.1 | Converter giáo trình Sprigo `courses/en.yml` → content pack (MIT, có ghi công) | TODO | |
| C.2 | Port prompt/schema từ Sprigo + VocabReader (MIT) vào Prompt Library | TODO | |
| C.3 | Content pack "Pronunciation Path" từ dữ liệu Cadence (MIT) + căn chỉnh âm vị bằng TS | TODO | |
| C.4 | `THIRD_PARTY_NOTICES.md` + header ghi công trong file chuyển đổi | TODO | |
| M.1 | Listening: nghe 3 tầng, retry ngay, chấm dễ (ý tưởng EchoType, tự viết) | TODO | |
| M.2 | Prompt ràng buộc CEFR + JSON sửa lỗi + sửa STT theo ngữ cảnh (ý tưởng Babblr, tự viết) | TODO | |
| O.1 | (Sau v1) Nhập EPUB | TODO | |
| O.2 | (Sau v1) Gia sư giọng nói realtime Gemini Live | TODO | |
| O.3 | (Sau v1) Giọng đọc offline Kokoro, avatar 3D TalkingHead | TODO | |
