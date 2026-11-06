# Hướng dẫn viết module – B&T English (kiến trúc v2)

Tài liệu này là "hợp đồng" chung cho mọi module. Code và comment viết bằng tiếng Anh; nhãn giao diện luôn có cả tiếng Anh và tiếng Việt.

## 1. Cấu trúc một module

Lấy ví dụ module `listening`:

```
src/modules/listening/
  contract.ts        IPC channel của module, tên dạng 'listening:*'. Input là zod schema, output là type.
  types.ts           (tùy chọn) type output dùng chung giữa main và renderer. Chỉ chứa type thuần.
  main/index.ts      export const listeningMain: ModuleMain = { id, migrations?, register(router, kernel) }
  main/service.ts    nghiệp vụ, không import Electron; test được bằng Vitest
  main/prompts.ts    prompt AI (jsonPrompt / textPrompt), bắt buộc có hàm mock
  renderer/index.tsx export const listeningRenderer: ModuleRenderer = { id, routes, nav }
  renderer/pages/*   trang React, nạp lười bằng React.lazy
  renderer/components/*
```

- **Đăng ký:** đã có sẵn trong `src/modules/contract.ts`, `registry.main.ts` và `registry.renderer.tsx`. Không cần sửa các file này.
- **Khai báo channel:**

  ```ts
  'listening:list': channel<TrackSummary[]>()(z.object({ cefr: CefrSchema.optional() }).optional())
  ```

  Không có input thì dùng `NoInput`.

- **Đăng ký handler:**

  ```ts
  router.handle('listening:list', (input) => service.list(input))
  ```

  Input đã được validate, kiểu được suy ra tự động. Muốn trả lỗi cho người dùng thì `throw new UserError(code, messageVi)` (import từ `src/main/ipc/router`).

- **Bảng riêng:** chỉ tạo khi bảng sẵn có không đủ. Khai báo qua `migrations: [{ version: 1, name, sql }]` và đặt tên bảng bắt đầu bằng `<module>_`.
- **Đồng bộ nhiều máy:** bảng riêng mặc định không được đồng bộ. Muốn đồng bộ thì thêm một dòng vào `SYNC_TABLES` (`src/main/kernel/cloud/syncTables.ts`), trigger sẽ được tự cài lúc chạy. Quy tắc khóa xem mục "Hợp đồng dữ liệu đồng bộ" trong `docs/ONLINE_PLAN.md`. Không đồng bộ dữ liệu bí mật, cache hay dữ liệu tính lại được.

## 2. Kernel API (main) – `kernel: Kernel`

| Thành phần                                           | Dùng để                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel.content`                                     | Nội dung gốc đã validate: `reading()`, `listening()`, `grammar()`, `writingPrompts()`, `speakingPrompts()`, `stories()`, `assessment()`, `dictionary()`, `lookup(word)`                                                                             |
| `kernel.learner`                                     | Hồ sơ và trình độ: `profile()`, `skillLevels()`, `setSkillLevel()`, `addSkillProgress(skill, delta)`, `overallCefr()`, `recordMistake({category, pattern, example, correction})`, `mistakes()`, `summary()`                                         |
| `kernel.progress.record(event)`                      | **Cách duy nhất** để cộng XP, tính quest, achievement, streak và thống kê. `event` gồm `{ type: ActivityType, module, skill, minutes, score (0..1), ref, title, speakingSeconds }`. Trả về `Reward`; UI tự hiện hiệu ứng nhận thưởng qua push event |
| `kernel.vocab`                                       | Kho từ chung: `save({...sourceModule})`, `findByWord`, `lookup`                                                                                                                                                                                     |
| `kernel.ai`                                          | `isAvailable()` và `run(prompt, input, { level? })`, trả `{ data, provider, model }`. Lỗi là `AiError`, router tự đổi thành thông báo tiếng Việt kèm nút mở Cài đặt AI. Ngoài ra có `transcribe(...)`                                               |
| `kernel.db`                                          | SQLite: `all`, `get`, `value`, `run`, `transaction(fn)` (fn phải đồng bộ)                                                                                                                                                                           |
| `kernel.settings`                                    | `get()`, `getFlag()`, `setFlag()`                                                                                                                                                                                                                   |
| `kernel.cloud`, `kernel.sync`, `kernel.cloudBackups` | Tài khoản online tùy chọn (Supabase): `cloud.isSignedIn()`, `cloud.rpc/json/invoke`; `sync.syncNow()`, `sync.status()`; `cloudBackups.create/list`                                                                                                  |
| `kernel.now()`                                       | Thời gian hiện tại (dùng hàm này thay vì `new Date()` để test được)                                                                                                                                                                                 |
| `kernel.log`                                         | `info`, `warn`, `error`. Không bao giờ log nội dung API key                                                                                                                                                                                         |

Bảng sẵn có trong `src/main/db/migrations/v1_initial.ts`:

- `listening_history`, `speaking_sessions`, `reading_history`, `reading_highlights`, `writing_submissions`
- `stories`, `story_progress`
- `tutor_conversations`, `tutor_messages`
- `lessons`, `lesson_attempts` (lưu điểm và tiến độ cho grammar, pronunciation…)
- `roadmaps`, `roadmap_weeks`, `assessments`, `assessment_answers`
- `generated_content`: chỉ nhận `kind` là `reading`, `listening` hoặc `lesson`

**ActivityType tương ứng:**

| Module    | ActivityType                                        |
| --------- | --------------------------------------------------- |
| listening | `listening_done`                                    |
| speaking  | `speaking_done` (kèm `speakingSeconds`)             |
| reading   | `reading_done`                                      |
| writing   | `writing_submitted`                                 |
| grammar   | `grammar_done`                                      |
| cinema    | `cinema_scene`; `story_completed` khi kết thúc phim |
| tutor     | `tutor_message`                                     |
| journey   | `lesson_completed`, `assessment_done`               |

Sau mỗi hoạt động có kết quả, gọi `kernel.learner.addSkillProgress(skill, delta)` với `delta` từ 0.5 đến 3 tùy chất lượng.

## 3. Prompt AI

```ts
export const feedbackPrompt = jsonPrompt<Input, Output>({
  id: 'writing.feedback', version: 1, skill: 'writing', schema: OutputSchema,
  build: (input, ctx) => ({ system: [..., ctx.learnerLine, ctx.constraints, ctx.languageInstruction, JSON_ONLY].join('\n'), messages: [...] }),
  check: (input, out) => (leaksAnswer(out.question, input.answer) ? 'The question reveals the answer' : null),
  mock: (input, ctx) => ({ ...output hợp lệ, cố định... }),
})
```

- **`ctx`** cung cấp:
  - `level`: CEFR của kỹ năng tương ứng;
  - `constraints`: giới hạn ngôn ngữ theo cấp;
  - `languageInstruction`: ngôn ngữ dùng để giải thích (en / vi / mixed);
  - `learnerLine`: tóm tắt người học;
  - `learner.mistakes`: các lỗi hay lặp lại;
  - `tutorStyle`.
- **`mock`** bắt buộc. Kết quả phải hợp lệ với schema và cố định (deterministic). Khi chạy E2E (`LQ_E2E=1`), mọi lệnh gọi AI trả về mock.
- **Không có AI key** thì module vẫn phải dùng được: dùng nội dung gốc, chấm offline bằng heuristic (`@core/text`), và hiển thị rõ tính năng nào cần AI.
- **Nhãn kết quả:** điểm do AI chấm phải gắn `<AiBadge />` ("AI ước lượng"). Điểm heuristic ghi "ước lượng thô".
- **Prompt chuyển từ repo MIT** (Sprigo, VocabReader…): dòng đầu file ghi `// Derived from <repo>@<commit> (MIT, © <author>)`. Babblr, ThirtyTutors và EchoType chỉ được lấy ý tưởng, không chép văn bản.

## 4. Renderer

- **Gọi API:**
  - `api('listening:list', input)` có kiểu đầy đủ;
  - `useApi(channel, input, deps)` trả `{ data, error, loading, reload, setData }`;
  - `useAction(fn)` trả `{ run, pending, error }`.
- **Song ngữ:**
  - `const L = useL()` rồi `L('Start', 'Bắt đầu')`;
  - `useTx()` cho object `{ en, vi }`;
  - `useFormat()` cho số và ngày.
- **UI:** `@/components/ui` gồm Button, IconButton, Card, PageHeader, Section, Badge, CefrBadge, ProgressBar, ProgressRing, StatTile, Spinner, Skeleton, LoadingBlock, EmptyState, ErrorState, Input, Textarea, Select, Field, Toggle, Tabs, Kbd, Modal, ConfirmDialog và `cx`.
- **Thành phần học tập:** `@/components/learning` gồm:
  - `SpeakButton`, `AiBadge`;
  - `SaveWordButton`;
  - `InteractiveText` (bấm vào từ để tra và lưu), `WordPopover`;
  - `FavoriteButton`, `RecordButton`, `QuizQuestion`.
- **Âm thanh:** `@/lib/audio` gồm:
  - `speak(text, { accent, rate, gender })` và `speakSequence(lines)`;
  - `stopSpeaking()`;
  - `useRecorder()`;
  - `transcribe(recording, hint)`;
  - `analysePauses()`.
- **Store:** `@/lib/store` cung cấp:
  - `useApp(s => s.profile | settings | game | dueCards)`;
  - `useApp.getState().toast({...})`;
  - `refreshGame()`.
- **Route:**
  - Router dạng hash (`useNavigate`, `useParams`, `useSearchParams`).
  - Mỗi trang có `data-testid="page-<module>"` ở phần tử gốc. Nút quan trọng có `data-testid` rõ nghĩa.
- **Thiết kế:**
  - Giao diện tối cao cấp, dùng token sẵn có (`bg-surface`, `text-muted`, `border-line`, `text-accent`, `bg-accent-gradient`, `font-display`).
  - Không hard-code màu, trừ hình minh họa.
  - Animation dùng framer-motion và phải nhẹ.
  - Icon dùng `lucide-react`.
  - Luôn có trạng thái loading, empty và error.
- **Không cài thêm dependency.** Biểu đồ và minh họa tự vẽ bằng SVG.

**Phân chia route** (không dùng route của module khác):

| Module     | Route                                                |
| ---------- | ---------------------------------------------------- |
| journey    | `/`, `/onboarding`, `/journey/*`, `/assessment`      |
| listening  | `/listening`, `/listening/:id`                       |
| speaking   | `/speaking/*`                                        |
| reading    | `/reading`, `/reading/:id`                           |
| writing    | `/writing/*`                                         |
| grammar    | `/grammar`, `/grammar/:id`                           |
| cinema     | `/cinema`, `/cinema/:id`                             |
| tutor      | `/tutor`, `/tutor/:id`                               |
| vocabulary | `/vocabulary`, `/vocabulary/review`, `/vocabulary/*` |
| game       | `/game`, `/stats`                                    |

**Route mà tìm kiếm toàn cục và quest sẽ mở:**

- `/reading/:id`, `/listening/:id`, `/cinema/:id`, `/grammar/:id`;
- `/writing?prompt=<id>`, `/speaking?prompt=<id>`;
- `/vocabulary?word=<id>`, `/vocabulary?lookup=<word>`, `/vocabulary/review`.

**Thứ tự menu (`nav.order`):**

| Nhóm       | Mục và thứ tự                                                 |
| ---------- | ------------------------------------------------------------- |
| `home`     | Dashboard 0, Journey 1                                        |
| `skills`   | Listening 10, Speaking 11, Reading 12, Writing 13, Grammar 14 |
| `play`     | Vocabulary 20 (`badge: 'dueCards'`), Cinema 21, Tutor 22      |
| `progress` | Game 30, Stats 31                                             |

## 5. Kiểm thử

- **Test tích hợp:** `tests/integration/modules/<module>.test.ts`. Dùng `makeApp()` trong `tests/helpers/kernel.ts` để có router đầy đủ với AI mock, rồi gọi `await call('listening:list')`.
- **Test logic thuần:** `tests/unit/<module>-*.test.ts`.
- **Lệnh chạy:**
  - `npx vitest run tests/integration/modules/<module>.test.ts --reporter=default`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.web.json`

  Khi nhiều người làm song song, chỉ sửa lỗi nằm trong file của mình.

## 6. Quy tắc

- **Phạm vi sửa:** chỉ sửa file trong thư mục module của mình và file test của module. Cần đổi Kernel hoặc component dùng chung thì báo lại, không tự sửa.
- **Nội dung:** 100% tự viết. Không dùng phim, kịch bản hay audio có bản quyền.
- **Bảo mật:**
  - Không đọc hay ghi API key.
  - Không render HTML thô từ dữ liệu ngoài. Nếu bắt buộc, chỉ cho phép thẻ trong allowlist.
  - Không dùng `dangerouslySetInnerHTML` với nội dung AI.
- **Định dạng:** Prettier (không dấu chấm phẩy, nháy đơn, rộng 120), TypeScript strict, tên định danh tiếng Anh.
