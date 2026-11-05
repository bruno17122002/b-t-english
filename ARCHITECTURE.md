# Kiến trúc Lingua Quest

## Tầng và trách nhiệm
```
┌─────────────── Renderer (React, sandbox, không có Node API) ───────────────┐
│ UI Components ─ Pages ─ hooks ─ i18n (en/vi) ─ lib/api.ts (typed client)    │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ window.lq.invoke(channel, payload)   (contextBridge, allowlist)
┌──────────────┴──────── Preload (src/preload) ────────────────────────────────┐
│ Chỉ cho phép các channel trong IPC contract; không lộ ipcRenderer             │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ ipcMain.handle(channel)  → kiểm tra sender + zod validate input
┌──────────────┴──────── Main Process (src/main) ──────────────────────────────┐
│ ipc/router.ts      : đăng ký handler, validation, chuẩn hóa lỗi              │
│ services/*         : Application Services (nghiệp vụ, transaction)          │
│ ai/*               : AI Provider Adapters (Gemini, OpenAI, Mock) + AIService │
│ secure/keyStore.ts : API key mã hóa bằng safeStorage (DPAPI trên Windows)    │
│ db/*               : Database Layer (sql.js, migrations, repositories)       │
│ logger.ts          : log xoay vòng, tự che key                               │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ thuần TypeScript, không phụ thuộc Electron
┌──────────────┴──────── Learning Engine (src/core) ───────────────────────────┐
│ srs (FSRS‑5), xp/level, streak, quests, achievements, cefr, assessment,      │
│ roadmap (offline), text utils, writing metrics, speaking metrics             │
└──────────────────────────────────────────────────────────────────────────────┘
src/shared : kiểu dữ liệu, schema nội dung, IPC contract (zod) dùng chung
src/content: nội dung học nguyên bản (JSON) – được validate khi nạp
```

## Cấu trúc thư mục
```
src/
  shared/      content.ts (schema nội dung), types.ts, ipc.ts (contract + zod)
  core/        learning engine thuần (có unit test)
  content/     *.json nội dung nguyên bản
  main/
    index.ts   khởi tạo app, cửa sổ, CSP, quyền mic, menu, thông báo
    db/        database.ts, migrations/, repositories
    ai/        types.ts, errors.ts, http.ts, gemini.ts, openai.ts, mock.ts, registry.ts, aiService.ts, prompts.ts
    services/  profile, assessment, roadmap, vocabulary, gamification, listening, reading,
               writing, speaking, cinema, tutor, stats, search, backup, settings, diagnostics
    ipc/       router.ts, handlers.ts
    secure/    keyStore.ts
  preload/     index.ts, api.d.ts
  renderer/    index.html, src/{App.tsx, pages, components, hooks, i18n, lib, styles.css}
tests/
  unit/ integration/ e2e/
```

## Database (SQLite qua sql.js)
- File: `%APPDATA%/Lingua Quest/data/lingua-quest.sqlite` (+ `.bak` bản trước đó).
- Ghi atomic: export → ghi file tạm → fsync → rename; giữ một bản `.bak`. Sau mỗi `export()` bật lại `PRAGMA foreign_keys=ON` (sql.js đặt lại pragma khi export).
- Migrations có version trong bảng `schema_migrations`, chạy trong transaction; trước khi nâng cấp DB cũ tự tạo bản sao `pre-migration-v{n}`.
- Bảng chính: `user_profile`, `learning_goals`, `skill_levels`, `assessments`, `assessment_answers`, `roadmaps`, `roadmap_weeks`, `lessons`, `lesson_attempts`, `vocabulary`, `review_schedules`, `review_logs`, `writing_submissions`, `speaking_sessions`, `listening_history`, `reading_history`, `reading_highlights`, `stories`, `story_progress`, `xp_events`, `achievements`, `quests`, `daily_stats`, `activity_log`, `tutor_conversations`, `tutor_messages`, `learner_mistakes`, `ai_settings`, `app_settings`, `favorites`, `bookmarks`, `generated_content`.
- Foreign keys + `ON DELETE CASCADE`, indexes cho truy vấn theo ngày/hạn ôn, CHECK constraint cho enum/CEFR.

## IPC
- Một contract duy nhất (`src/shared/ipc.ts`): mỗi channel có schema zod cho input. Preload chỉ chuyển tiếp channel có trong allowlist.
- Main kiểm tra `event.senderFrame.url` thuộc app (file:// hoặc dev server), validate input, trả `{ ok: true, data } | { ok: false, error: { code, message } }`.
- Không channel nào trả về API key; chỉ trả `hasKey` + 4 ký tự cuối đã che.

## AI integration
```
AIService (nghiệp vụ: tutor, roadmap, writing feedback, lesson, story, giải thích, đánh giá nói)
   │ dùng
AIProvider interface
   chat(messages, opts)            → văn bản
   generateJson(prompt, schema)    → JSON đã validate bằng zod (tự sửa 1 lần nếu lỗi)
   transcribe(audio)               → văn bản (OpenAI Transcriptions / Gemini audio)
   synthesize(text, voice)         → audio (OpenAI TTS / Gemini TTS)
   listModels(), testConnection(), capabilities
   ├─ GeminiProvider  (generativelanguage.googleapis.com, header x-goog-api-key)
   ├─ OpenAIProvider  (api.openai.com, Bearer)
   └─ MockProvider    (chỉ bật khi LQ_E2E=1, phục vụ E2E)
```
- HTTP chung: timeout (AbortController), retry có backoff cho 429/5xx (tôn trọng `Retry-After`), phân loại lỗi `no_key | invalid_key | rate_limited | quota | timeout | network | model_not_found | safety_blocked | bad_response | server_error`.
- Thêm provider mới: cài interface `AIProvider` + đăng ký trong `registry.ts`.
- Kiểm soát token: tutor chỉ gửi tóm tắt hồ sơ (CEFR từng kỹ năng, 5 lỗi lặp lại gần nhất, 12 tin nhắn gần nhất).

## Bảo mật
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, CSP chặt, chặn `window.open`/điều hướng ra ngoài (mở link bằng trình duyệt hệ thống).
- Chỉ cấp quyền `media` (micro) cho chính app.
- API key: `safeStorage.encryptString` → file `secure/keys.bin`; không bao giờ ghi vào DB, log, backup hay export. Logger tự che chuỗi giống key (`AIza…`, `sk-…`).

## Learning Engine
- **FSRS‑5** (19 tham số mặc định công bố của thuật toán FSRS) cho lịch ôn từ vựng; retention mục tiêu 0.9.
- **CEFR**: đánh giá thích ứng (bắt đầu A2, lên/xuống theo đúng/sai), chấm từng kỹ năng; Writing/Speaking chấm bằng AI (có nhãn "AI ước lượng"), không có AI thì dùng chỉ số đo được (độ dài câu, đa dạng từ vựng) và gắn nhãn "ước lượng thô".
- **Dự kiến tiến trình**: dựa trên số giờ học có hướng dẫn tham khảo cho từng cấp CEFR (Cambridge guided learning hours) và số phút học/ngày.
- **Gamification**: XP theo hoạt động, level đường cong tăng dần, streak có "ngày nghỉ" (mỗi 7 ngày được nghỉ 1 ngày không mất streak – không phạt), quest ngày/tuần sinh theo điểm yếu, achievement theo mốc thật.

---

## Đề xuất v2: Kiến trúc All-in-One theo module (CHỜ DUYỆT)

> Đề xuất sau khi nghiên cứu mã nguồn mở (`docs/OSS_RESEARCH.md`). Chưa áp dụng vào code; code hiện có (`src/core`, `src/main/db`, `src/shared`) được giữ nguyên và tái sử dụng.

### Ý tưởng
Lingua Quest là **một ứng dụng Electron duy nhất** (modular monolith). Mỗi chức năng là một **module độc lập** với manifest riêng. Mọi thứ dùng chung nằm trong **Platform Kernel** ở Main Process. Không có sidecar hay runtime Python, không có server localhost.

```
┌──────────────────────────── Lingua Quest Shell (Renderer) ────────────────────────────┐
│ Điều hướng, theme, i18n, tìm kiếm toàn cục, phím tắt, thông báo, celebration/toast    │
│ Trang của từng module được nạp lười (lazy) theo route manifest                         │
└───────────────▲────────────────────────────────────────────────────────────────────────┘
                │ IPC contract (zod) – preload allowlist
┌───────────────┴──────────── Platform Kernel (Main) ────────────────────────────────────┐
│ Data        : SQLite (sql.js), migrations có namespace theo module, backup/export       │
│ AI Gateway  : Gemini / OpenAI (+ Gemini Live sau này), Prompt Library có version + zod, │
│               lớp ràng buộc CEFR (độ dài câu, từ vựng, chiến lược sửa lỗi theo cấp),    │
│               kiểm tra lộ đáp án, kiểm soát ngữ cảnh/token                              │
│ Audio       : TTS (hệ thống / OpenAI / Gemini / [Kokoro offline]), STT (OpenAI/Gemini)  │
│ Learner     : hồ sơ, CEFR từng kỹ năng, bộ nhớ lỗi lặp lại, tóm tắt người học cho AI    │
│ Vocab Hub   : kho từ duy nhất + FSRS (ts-fsrs) – mọi module lưu từ vào đây              │
│ Progress    : event bus LearningEvent → XP, quest, achievement, streak, thống kê        │
│ Content     : registry content pack (nội dung gốc, giáo trình chuyển từ Sprigo,         │
│               pack phát âm từ Cadence, nội dung AI tạo, EPUB người dùng nhập)           │
└───────────────▲────────────────────────────────────────────────────────────────────────┘
                │ API kernel (không module nào gọi trực tiếp module khác)
┌───────────────┴──────────── Feature Modules ───────────────────────────────────────────┐
│ journey · listening · speaking (+pronunciation) · reading (+epub) · writing · cinema · │
│ vocabulary · tutor (+live voice) · game                                                 │
│ Mỗi module: manifest.ts, main/service.ts, main/ipc.ts, renderer/pages, prompts/, content/│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Hợp đồng module (dự kiến)
```ts
interface LearningModuleManifest {
  id: ModuleId
  skills: Skill[]
  migrations?: Migration[]            // version có namespace, ví dụ 'speaking:1'
  prompts?: PromptSpec[]              // id, version, system/user template, zod output schema
  contentPacks?: ContentPackSpec[]    // nguồn + schema + license/attribution
  questTemplates?: QuestTemplate[]    // module đóng góp quest/achievement vào Game
  registerIpc(router: IpcRouter, kernel: Kernel): void
}
// Renderer
interface ModuleRoutes { path: string; navKey: string; icon: string; page: () => Promise<ComponentType> }
```
- Module chỉ phát `LearningEvent` (ví dụ `{ type: 'listening_done', skill, minutes, score, ref }`). Kernel/Progress xử lý XP, quest, achievement, thống kê trong cùng transaction.
- Từ vựng từ mọi module đi qua `kernel.vocab.save()`, tự tạo lịch FSRS.
- AI chỉ gọi qua `kernel.ai.run(promptId, input)`: kernel chọn provider, gắn ràng buộc CEFR và tóm tắt người học, validate output bằng zod. Đổi provider không ảnh hưởng module.

### Thư mục dự kiến (bổ sung, không xóa code cũ)
```
src/core/            (giữ) engine thuần: srs → adapter ts-fsrs, game, cefr, text, roadmap
src/main/db/         (giữ) database + migrations kernel
src/main/kernel/     ai/ (providers, prompt-library, cefr-constraints), audio/, learner/, vocab/, progress/, content/
src/modules/<id>/    manifest.ts, main/, renderer/, prompts/, content/
src/content/packs/   own/, sprigo-en-syllabus/ (MIT), cadence-pronunciation/ (MIT)
THIRD_PARTY_NOTICES.md
```

### So sánh với kiến trúc hiện tại
| Khía cạnh | Hiện tại (v1) | Đề xuất (v2) | Ảnh hưởng tới code đã viết |
|---|---|---|---|
| Hình thái | Monolith phân tầng (Main/Preload/Renderer/Core) | Monolith **theo module** + Kernel dùng chung | Không phá: thêm lớp tổ chức |
| Tổ chức nghiệp vụ | `src/main/services/*` chung một chỗ | Mỗi module tự chứa service, IPC, trang, prompt, nội dung | Chưa viết service nào → không phải sửa |
| AI | Interface provider + AIService | Thêm **Prompt Library** có version/schema, lớp ràng buộc CEFR, kiểm tra lộ đáp án | Chưa viết → thiết kế mới từ đầu |
| SRS | FSRS‑5 tự viết (`core/srs.ts`) | `ts-fsrs` (thư viện chính thức, MIT) sau một adapter giữ nguyên API | Sửa ruột 1 file, giữ chữ ký hàm |
| Nội dung | JSON tự viết | Content pack có metadata license + converter từ Sprigo/Cadence | Schema `src/shared/content.ts` giữ nguyên, thêm pack |
| Gamification | Service gọi trực tiếp | Event bus `LearningEvent`, module đóng góp quest | Logic `core/game.ts` dùng lại nguyên vẹn |
| Database | Migrations toàn cục v1/v2 | Kernel giữ v1/v2; module thêm migration có namespace | `runMigrations` mở rộng, không đổi bảng cũ |
| Mở rộng | Thêm màn hình và service thủ công | Thêm module = thêm 1 thư mục + đăng ký manifest | — |
| Sidecar/Python | Không | Không | — |
