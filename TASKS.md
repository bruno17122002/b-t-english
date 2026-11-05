# TASKS – Lingua Quest

Trạng thái: `TODO` / `IN_PROGRESS` / `COMPLETED` / `BLOCKED`. Một mục chỉ được đánh `COMPLETED` khi có bằng chứng kiểm tra, ghi ở cột "Bằng chứng".

## PHASE 0–1: khảo sát và kiến trúc
| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 0.1 | Khảo sát môi trường | COMPLETED | PLAN.md, mục PHASE 0 |
| 1.1 | Tài liệu PLAN / ARCHITECTURE / TASKS / TEST_PLAN / CHANGELOG | COMPLETED | Các file ở thư mục gốc |
| R.1–R.4 | Nghiên cứu mã nguồn mở, đề xuất kiến trúc All-in-One | COMPLETED | `docs/OSS_RESEARCH.md`, mục "Kiến trúc v2" trong `ARCHITECTURE.md` |
| R.5 | Người dùng duyệt đề xuất | COMPLETED | Người dùng chọn "Duyệt, triển khai" (05/11/2026) |

## PHASE 2: xây dựng
| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 2.1 | Khung Electron + Vite + React + TS strict + Tailwind | COMPLETED | `npm run typecheck` 0 lỗi (3 project); `electron-vite build` thành công |
| 2.2 | Database layer: sql.js, migrations v1–v3, migration theo module, ghi atomic, `.bak` | COMPLETED | `kernel-storage.test.ts`: nâng cấp v2→v3 không mất dữ liệu, khôi phục khi file hỏng, FK sau khi export |
| 2.3 | IPC contract (zod) + router + preload allowlist | COMPLETED | `kernel.test.ts`: mọi channel đều có handler, input sai bị từ chối |
| 2.4 | Key store bằng safeStorage (DPAPI) | COMPLETED | `kernel-storage.test.ts`, `kernel.test.ts`; E2E: key không xuất hiện trong UI hay IPC |
| 2.5 | Learning engine: FSRS (ts-fsrs), XP/level, streak, quest, achievement, CEFR, roadmap | COMPLETED | `engine.test.ts` (23 test) |
| 2.6 | AI Gateway: Gemini + OpenAI + Mock, Prompt Library, ràng buộc CEFR, sửa JSON 1 vòng | COMPLETED | `ai.test.ts` (24 test, gồm định dạng request, phân loại lỗi, retry, redact) |
| 2.7 | Nội dung gốc + content pack Sprigo / Cadence | COMPLETED | `packs.test.ts`; `kernel.test.ts` › content 0 lỗi validate |
| 2.8 | Journey: onboarding, đánh giá thích ứng, roadmap, giáo trình, kế hoạch ngày, dashboard | COMPLETED | `journey.test.ts`, `journey-logic.test.ts`; E2E `journey.spec.ts` |
| 2.9 | Listening Lab (nghe 3 tầng, chép chính tả dễ chấm, AI tạo bài) | COMPLETED | `listening.test.ts`, `listening-dictation.test.ts`; E2E chép chính tả |
| 2.10 | Speaking Studio + Pronunciation Path | COMPLETED | `speaking.test.ts`, `speaking-helpers.test.ts`, `phonemes.test.ts` |
| 2.11 | Reading Adventure | COMPLETED | `reading.test.ts`, `reading-lib.test.ts`; E2E tra từ và lưu từ |
| 2.12 | Writing Workshop | COMPLETED | `writing.test.ts`, `writing-diff.test.ts`, `writing-feedback.test.ts`; E2E nhận xét viết |
| 2.13 | Cinema Mode | COMPLETED | `cinema.test.ts`, `cinema-navigation.test.ts` (đi hết mọi nhánh của 7 phim); E2E xem đến hết phim |
| 2.14 | Game Mode: bản đồ 7 vùng, quest, achievement, phần thưởng | COMPLETED | `game-*.test.ts` (39 test); E2E route `/game` |
| 2.15 | Từ vựng: kho từ, ôn FSRS, luyện tập, từ điển | COMPLETED | `vocabulary-practice.test.ts`, `kernel.test.ts`; E2E ôn thẻ |
| 2.16 | AI Tutor 7 chế độ | COMPLETED | `tutor.test.ts`, `tutor-history.test.ts`, `tutor-markdown.test.ts`; E2E chat |
| 2.17 | Dashboard, thống kê, lịch hoạt động | COMPLETED | E2E quét route; biểu đồ SVG có test thuần |
| 2.18 | Cài đặt, cài đặt AI, sao lưu/khôi phục, nhập/xuất, chẩn đoán | COMPLETED | `kernel.test.ts` (backup, CSV); E2E key AI và tạo bản sao lưu |
| 2.19 | Tìm kiếm toàn cục, yêu thích, đánh dấu, thông báo, phím tắt | COMPLETED | `kernel.test.ts` (tìm không dấu); E2E Ctrl+K / F1 / Ctrl+, |
| K.1–K.4 | Kernel v2: manifest module, event bus, Prompt Library, ts-fsrs, migration theo module | COMPLETED | `src/main/kernel`, `src/modules/*`; các test ở trên |
| C.1–C.4 | Converter Sprigo / Cadence, `THIRD_PARTY_NOTICES.md`, header ghi công | COMPLETED | `scripts/convert_*.py`, `packs.test.ts` |
| M.1–M.2 | Nghe 3 tầng (ý tưởng EchoType), prompt ràng buộc CEFR + sửa lỗi (ý tưởng Babblr), tự viết lại | COMPLETED | `listening`, `tutor`, `cefrConstraints.ts` |

## PHASE 3: kiểm thử
| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 3.1 | Static analysis: tsc, ESLint, Prettier, `npm audit` | COMPLETED | 0 lỗi; ESLint 0 cảnh báo; Prettier sạch; `npm audit --omit=dev`: 0 lỗ hổng |
| 3.2 | Unit | COMPLETED | 161 unit + 58 test helper renderer, tất cả đạt |
| 3.3 | Integration | COMPLETED | 75 test, tất cả đạt |
| 3.4 | E2E (Playwright điều khiển Electron thật) | COMPLETED | 20/20 đạt (`test-results/playwright.json`) |
| 3.5 | UI/UX review + screenshot | COMPLETED | `docs/screenshots/` (giao diện tối và sáng); E2E kiểm tra tràn ngang, nút có tên, Esc |
| 3.6 | Sửa lỗi + hồi quy | COMPLETED | `docs/BUGS.md` (B1–B12); 3 vòng chạy toàn bộ |

## PHASE 4–5: phát hành
| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| 4.1 | Release gate checklist | COMPLETED | `TEST_PLAN.md`, mục Release checklist |
| 4.2 | Electron Builder: NSIS + portable | COMPLETED | `release/Lingua-Quest-Setup-1.0.0.exe` (133,3 MB), `release/Lingua-Quest-Portable-1.0.0.exe` (116,4 MB); SHA-256 ghi trong CHANGELOG |
| 4.3 | Kiểm tra installer sau build | COMPLETED | Gói chỉ chứa `out/`, icon và 4 dependency production. E2E trên bản unpacked: 15/15. Cài đặt im lặng: exit 0, có registry và shortcut. E2E trên bản đã cài: 10/10. Gỡ im lặng: exit 0, không còn file, registry hay shortcut |

## Sau v1 (tùy chọn)
| # | Hạng mục | Trạng thái |
|---|---|---|
| O.1 | Nhập EPUB | TODO |
| O.2 | Gia sư giọng nói realtime (Gemini Live) | TODO |
| O.3 | Giọng đọc offline Kokoro, avatar 3D TalkingHead | TODO |
