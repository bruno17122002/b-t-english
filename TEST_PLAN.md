# TEST PLAN – Lingua Quest

## 1. Static analysis
| Kiểm tra | Lệnh | Tiêu chí đạt |
|---|---|---|
| TypeScript strict (main+preload+core+shared, renderer) | `npm run typecheck` | 0 lỗi |
| ESLint (typescript-eslint, react-hooks) | `npm run lint` | 0 lỗi, 0 cảnh báo |
| Prettier | `npm run format:check` | Không file lệch format |
| Dependency audit | `npm audit --omit=dev` | 0 lỗ hổng high/critical ở dependency production |
| Security review | Rà soát thủ công: CSP, sandbox, IPC validation, key storage, log redaction | Không phát hiện vấn đề |
| Cấu hình build | `electron-builder.yml`: không chứa devDependencies, file ngoài `out/` | Đúng |

## 2. Unit (Vitest – `tests/unit`)
Database & migrations (FK, cascade, pragma sau export, nâng cấp không mất dữ liệu), FSRS (khởi tạo, đúng hạn, quên, ngày cùng ngày, giới hạn), XP/level, streak có ngày nghỉ, quest generation & progress, achievements, CEFR (đánh giá thích ứng, chấm kỹ năng), roadmap offline, dự kiến tiến trình, text utils, writing/speaking metrics, AI adapters (định dạng request Gemini/OpenAI, parse response, phân loại lỗi 400/401/403/404/429/500, timeout, mất mạng, retry), generateJson tự sửa, log redaction, IPC input validation, content schema (toàn bộ JSON).

## 3. Integration (Vitest – `tests/integration`)
Dùng DB sql.js thật trong thư mục tạm + MockProvider: IPC router (validation, lỗi chuẩn hóa), AI config (lưu model/provider, key store giả lập), onboarding → assessment → roadmap, hoàn thành bài → XP/quest/achievement/stats, thu thập từ vựng → lịch ôn, settings, backup/restore, import/export, persistence qua đóng/mở DB.

## 4. E2E (Playwright `_electron` – `tests/e2e`)
Chạy bản build thật với `LQ_E2E=1` (MockProvider, micro giả lập của Chromium, thư mục dữ liệu riêng):
khởi chạy → onboarding → mục tiêu → assessment → roadmap → Listening → Speaking → Reading → Writing → Cinema → lưu từ → ôn từ → nhận XP → achievement mở khóa → đóng app → mở lại → dữ liệu còn đúng. Thu thập lỗi console nghiêm trọng (fail nếu có).

## 5. UI/UX
Duyệt mọi route bằng Playwright: không màn trắng, không nút chết (mọi button có handler/disabled hợp lệ), không lỗi console, keyboard navigation (Tab/phím tắt), cửa sổ 1024×700 và 1600×1000 không tràn ngang, trạng thái loading/error/empty. Chụp screenshot các màn hình chính vào `docs/screenshots/`.

## 6. Bug fixing
Mỗi lỗi: ghi vào `docs/BUGS.md` (triệu chứng → nguyên nhân gốc → cách sửa → regression test) → chạy lại test liên quan + toàn bộ suite.

## Release checklist (release gate)
- [ ] Source + core features hoàn chỉnh
- [ ] Static analysis đạt
- [ ] Unit đạt
- [ ] Integration đạt
- [ ] E2E đạt
- [ ] UI/UX review + screenshots
- [ ] Không còn bug critical/high
- [ ] Regression đạt
- [ ] Phiên bản, icon, metadata đúng
→ Chỉ khi tất cả được tích mới chạy `npm run dist`.
