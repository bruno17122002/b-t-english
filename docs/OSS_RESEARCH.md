# Nghiên cứu mã nguồn mở cho Lingua Quest

Ngày: 2026-11-05. Phạm vi: chỉ nghiên cứu, phân tích, lập kế hoạch. Không code nào bị xóa hay viết lại.
Phương pháp: clone chỉ-đọc vào `D:\lq-oss` (ngoài thư mục dự án), đọc LICENSE, `package.json`/`pyproject`, mã nguồn và lịch sử git. **Không chạy, build hay cài** bất kỳ thứ gì từ các repo này. Các con số dung lượng model là ước lượng.

## 1. Hiện trạng Lingua Quest tại thời điểm tạm dừng

| Thành phần                                                                                                                    | Trạng thái                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Tài liệu PLAN / ARCHITECTURE / TASKS / TEST_PLAN / CHANGELOG                                                                  | Có                                               |
| Khung dự án (package.json, tsconfig strict, electron-vite, vitest, prettier)                                                  | Có, dependencies đã cài (Node 20.20 cục bộ)      |
| `src/shared` – schema nội dung (zod), kiểu domain                                                                             | Có                                               |
| `src/core` – FSRS‑5, XP/level, streak, quest, achievement, CEFR, assessment thích ứng, text/speaking metrics, roadmap offline | Có                                               |
| `src/main/db` – sql.js, ghi atomic, migrations v1/v2 (32 bảng)                                                                | Có                                               |
| AI adapters, services, IPC, preload, renderer UI, test                                                                        | **Chưa viết**                                    |
| Nội dung nguyên bản (subagent)                                                                                                | `dictionary.json` đã có, các file khác đang viết |

Khoảng 2.700 dòng TypeScript, `tsc --noEmit` không lỗi. Đây là thời điểm rẻ nhất để điều chỉnh kiến trúc: chưa có UI và service nào phải sửa.

## 2. Repo được xác định

Tên dự án trên GitHub bị trùng nhiều. Bảng dưới là repo khớp chủ đề học ngôn ngữ nhất.

| Tên yêu cầu  | Repo                                                                | Mảng                                                          | License                              | Công nghệ                                                                                                     | Hoạt động                                                    |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Sprigo       | [ozerozdas/sprigo](https://github.com/ozerozdas/sprigo)             | Vocabulary, Speaking, Listening, Writing, Tutor, Gamification | **MIT**                              | Tauri 2 (Rust) + React 19 + TS, Vercel AI SDK, ts-fsrs, whisper.cpp                                           | Rất tích cực (266 commit, cập nhật 2026‑11‑04), có test + CI |
| EchoType     | [bill-gx114/echotype](https://github.com/bill-gx114/echotype)       | Listening (nghe chép chính tả)                                | **Không có license**                 | JS thuần, localStorage, `speechSynthesis`                                                                     | 5 commit trong 1 ngày (2026‑07‑06), không test               |
| Cadence      | [pstepanovum/Cadence](https://github.com/pstepanovum/Cadence)       | Speaking (phát âm theo âm vị)                                 | **MIT**                              | Next.js 16 + Supabase + Stripe; engine Python FastAPI (torch, wav2vec2, Whisper, Qwen‑3B); Electron bọc ngoài | 27 commit, test ít, chỉ build macOS                          |
| ThirtyTutors | [wiss84/thirtytutors](https://github.com/wiss84/thirtytutors)       | Speaking, AI Tutor (speech‑to‑speech, avatar 3D)              | **PolyForm Noncommercial 1.0.0**     | Python FastAPI + pywebview, chỉ Gemini Live                                                                   | 27 commit, có pytest + CI                                    |
| VocabReader  | [highsunday/VocabReader](https://github.com/highsunday/VocabReader) | Reading, Vocabulary, Writing                                  | **MIT**                              | Electron 43 + React 19 + TS, `node:sqlite`, ts-fsrs, AI qua Codex CLI                                         | 50+ commit, test rất nhiều, "Early Preview"                  |
| Babblr       | [pkuppens/babblr](https://github.com/pkuppens/babblr)               | AI Tutor hội thoại, CEFR                                      | **AGPL‑3.0** hoặc license thương mại | Electron 45 + React (frontend) + Python FastAPI/LangChain/Whisper (backend)                                   | Tích cực, CI + CodeQL                                        |

## 3. Đánh giá từng dự án

### 3.1 Sprigo – nguồn tham khảo phong phú nhất (MIT)

- **Đáng lấy:**
  - `courses/en.yml` (3.264 dòng): giáo trình tiếng Anh A1→C2 với từ vựng và mẫu ngữ pháp cho từng bước. Dùng làm xương sống cho roadmap và Grammar Kingdom.
  - `src/activities.ts` (307 dòng): registry các dạng bài tập, mỗi dạng có schema zod và hướng dẫn prompt riêng, kèm kiểm tra "lộ đáp án" (`givesAway`).
  - `tutor.ts`, `memory.ts`, `writing.ts`, `rehearsal.ts`, `drills.ts`: prompt kèm schema zod cho gia sư, trí nhớ người học, chữa bài viết, debrief sau role‑play và drill chống né nói.
  - `speech.ts`: chỉ số nói (thời gian phản hồi, ngắt nghỉ, chuyển sang tiếng mẹ đẻ).
- **Không hợp:**
  - Lớp Rust (whisper‑rs, keychain, server companion, updater).
  - AI chạy trong renderer qua Vercel AI SDK, trái nguyên tắc "key chỉ ở Main".
- **Cảnh báo bảo mật trong repo gốc:** `csp: null`, HTTP capability `*`, key được đưa vào webview. Không mang những điểm này sang.
- **Kết luận:** chuyển (port) có chọn lọc **prompt, schema, giáo trình**, giữ ghi chú MIT. Chi phí bảo trì thấp vì đều là TS thuần.

### 3.2 VocabReader – mạnh về Reading và từ vựng theo ngữ cảnh (MIT)

- **Đáng lấy:**
  - 8 đặc tả prompt trong `.agents/skills/*/SKILL.md` (~1.270 dòng, có chống prompt injection):
    - tạo learning item "mỗi nghĩa một thẻ"
    - ôn ngắt quãng bằng câu ngữ cảnh mới do AI viết rồi AI chấm
    - integrated sentences, retelling, đọc hiểu, listen & repeat
  - Bộ nhập EPUB kèm sanitizer HTML theo allowlist, phát hiện DRM (`library-service.ts`).
- **Không hợp:**
  - Lớp AI phụ thuộc Codex CLI và tài khoản ChatGPT, không hỗ trợ Gemini.
  - `node:sqlite` và `sharp` (native).
- **Kết luận:** chuyển các prompt và thêm tính năng "Nhập EPUB của bạn" cho Reading Adventure (giai đoạn sau). Stack Electron + React gần như trùng với Lingua Quest.

### 3.3 Cadence – nội dung phát âm tốt, engine không phù hợp (MIT)

- **Đáng lấy:**
  - `phoneme_catalog.json` (857 dòng): cách phát âm từng âm vị, mẹo, lỗi thường gặp.
  - `practice_targets.json`: khoảng 120 từ kèm IPA và âm vị trọng tâm.
  - `supabase/modules.sql`: 10 module âm vị với khoảng 40 bài.
  - `conversation.ts`: 10 kịch bản hội thoại có gợi ý chấm.
  - Thuật toán căn chỉnh âm vị theo Levenshtein (~200 dòng Python, dễ chuyển sang TS).
- **Không hợp:**
  - Engine Python cần torch + wav2vec2 + Whisper + Qwen‑3B, ước tính **2–8 GB**.
  - Cài pip lúc chạy, không ghim phiên bản.
  - espeak‑ng/phonemizer là **GPL‑3.0**.
  - Chỉ build macOS.
  - Bản thân cách chấm còn thô: mỗi âm vị chỉ được 96 hoặc 48 điểm, thời gian từng từ là ước lượng.
- **Kết luận:** lấy **dữ liệu và thuật toán căn chỉnh**. Bỏ runtime Python, Supabase, Stripe.

### 3.4 EchoType – chỉ lấy ý tưởng (không có license)

- Không có file LICENSE, nên mặc định giữ mọi quyền: **không được dùng code hay dữ liệu**. Từ điển IELTS 3.575 từ cũng không rõ nguồn và chú nghĩa bằng tiếng Trung.
- **Ý tưởng UX đáng làm lại (tự viết):**
  - Nghe 3 tầng: nghe "mù" → nghe chậm 0,6× → bật phụ đề.
  - Làm lại câu sai ngay cuối vòng.
  - Chế độ chấm dễ (bỏ qua hoa thường, dấu câu) và combo.
  - Âm gõ phím tổng hợp bằng Web Audio.
- Diff của EchoType so ký tự theo vị trí; Lingua Quest đã có diff mức từ bằng Levenshtein (`core/text.ts`), tốt hơn.

### 3.5 ThirtyTutors – chỉ lấy ý tưởng (PolyForm Noncommercial)

- License cấm mọi mục đích thương mại và buộc kèm "Required Notice". Lingua Quest chỉ được dùng nếu cam kết phi thương mại vĩnh viễn, nên **không chép code**. Avatar, giọng mẫu và ảnh (~455 MB) không có license.
- **Ý tưởng đáng làm lại:**
  - Gia sư thời gian thực qua **Gemini Live API** (WebSocket, âm thanh vào/ra) có nối lại phiên.
  - Tool‑calling `set_mood` / `start_quiz`.
  - Trí nhớ cuộn: tóm tắt, từ đã dạy, lỗi đã gặp.
  - Vòng drill "sửa rồi nhắc lại".
- **Avatar 3D (tùy chọn):** dùng thẳng thư viện gốc TalkingHead (MIT, npm `@met4citizen/talkinghead`), không lấy từ repo này.
- **Cảnh báo trong repo gốc:**
  - Key Gemini lưu plaintext và bị trả về qua API.
  - Server local không xác thực, không kiểm Origin.
  - `pip install --upgrade` từ xa.

### 3.6 Babblr – chỉ lấy ý tưởng (AGPL‑3.0)

- Nếu chép code hoặc văn bản JSON, toàn bộ Lingua Quest phải phát hành theo AGPL, trừ khi mua license thương mại. Tên "Babblr" có ràng buộc thương hiệu.
- **Ý tưởng đáng làm lại (tự viết):**
  - Ràng buộc theo cấp CEFR: số lượng từ, độ dài câu, độ phức tạp ngữ pháp, chiến lược sửa lỗi theo từng cấp.
  - Prompt ghép theo module (danh tính, cấp độ, role‑play, người quan sát lỗi, cá nhân hóa).
  - Schema JSON cho lỗi: `original` / `corrected` / `explanation` / `type`.
  - Sửa lỗi STT dựa trên ngữ cảnh (đồng âm).
- **Không hợp:**
  - Backend Python + Whisper large‑v3 (~3 GB) + torch CUDA.
  - Không hỗ trợ OpenAI.
  - Edge TTS cần mạng.
  - Bài placement test chỉ có tiếng Tây Ban Nha.

## 4. So sánh 3 phương án tích hợp

| Tiêu chí             | A. Tích hợp trực tiếp source (port module)                         | B. Dùng thư viện / API                                                                                                                                                  | C. Chạy module như service riêng (sidecar)                |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Áp dụng được cho     | Sprigo, VocabReader, Cadence (MIT)                                 | Thư viện npm thật: `ts-fsrs` (MIT), `fast-xml-parser` (MIT), `jszip` (MIT/GPL, chọn MIT), `kokoro-js` (Apache‑2.0), `@met4citizen/talkinghead` (MIT); API Gemini/OpenAI | Cadence, ThirtyTutors, Babblr (đều là backend Python)     |
| Trải nghiệm desktop  | Thống nhất 100%                                                    | Thống nhất                                                                                                                                                              | Nhiều tiến trình, cài đặt lâu, dễ lỗi trên Windows        |
| Dung lượng installer | Không đổi                                                          | Nhỏ (trừ model TTS offline: 80–330 MB, tải khi cần)                                                                                                                     | +2–8 GB (Python, torch, model)                            |
| Bảo mật              | Kiểm soát hoàn toàn trong mô hình Main/Preload/Renderer            | Tốt                                                                                                                                                                     | Thêm server localhost cần xác thực/kiểm Origin; pip từ xa |
| License              | MIT: giữ ghi chú. AGPL/PolyForm/không license: **không dùng được** | Rõ ràng                                                                                                                                                                 | AGPL vẫn áp dụng khi phân phối; PolyForm cấm thương mại   |
| Bảo trì              | Thấp: code nằm trong repo, có test của mình                        | Thấp (cập nhật theo semver)                                                                                                                                             | Cao: 2 hệ sinh thái, 2 bộ test, đồng bộ phiên bản         |
| **Kết luận**         | **Chọn** cho prompt, schema, giáo trình, dữ liệu phát âm           | **Chọn** cho FSRS (ts-fsrs), EPUB, TTS offline (tùy chọn), avatar (tùy chọn)                                                                                            | **Loại**                                                  |

## 5. Danh sách đề xuất sử dụng

| #   | Nguồn                                         | Thành phần                                                                                      | Cách dùng                                                                                           | Module đích                          | Công sức | Ưu tiên         |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ | -------- | --------------- |
| 1   | npm `ts-fsrs` (MIT)                           | Thuật toán FSRS chính thức                                                                      | Thư viện; `core/srs.ts` thành adapter mỏng, giữ nguyên API                                          | Vocabulary                           | S        | Cao             |
| 2   | Sprigo (MIT)                                  | Giáo trình `courses/en.yml` A1→C2                                                               | Chuyển đổi sang schema nội dung (script convert + validate)                                         | Journey / Grammar                    | M        | Cao             |
| 3   | Sprigo (MIT)                                  | Registry dạng bài + kiểm tra lộ đáp án; prompt + schema tutor/memory/writing/rehearsal/drills   | Port sang Prompt Library (Main)                                                                     | AI Gateway, Tutor, Writing, Speaking | M        | Cao             |
| 4   | VocabReader (MIT)                             | 8 đặc tả prompt (ôn bằng câu ngữ cảnh mới, learning item, retelling, đọc hiểu, listen & repeat) | Port sang Prompt Library                                                                            | Vocabulary, Reading, Speaking        | S–M      | Cao             |
| 5   | Cadence (MIT)                                 | `phoneme_catalog.json`, `practice_targets.json`, 10 module âm vị, 10 kịch bản hội thoại         | Chuyển thành content pack "Pronunciation Path"                                                      | Speaking Studio                      | S–M      | Trung bình      |
| 6   | Cadence (MIT)                                 | Căn chỉnh âm vị (Levenshtein)                                                                   | Viết lại bằng TS, có unit test; âm vị nghe được do Gemini/OpenAI trả về (gắn nhãn **AI ước lượng**) | Speaking Studio                      | S        | Trung bình      |
| 7   | VocabReader (MIT) + `fast-xml-parser`/`jszip` | Nhập EPUB + sanitizer allowlist                                                                 | Port + thư viện                                                                                     | Reading Adventure                    | M        | Thấp (sau v1)   |
| 8   | Ý tưởng EchoType                              | Nghe 3 tầng, retry ngay, chấm dễ, combo                                                         | Tự viết                                                                                             | Listening Lab                        | S        | Cao             |
| 9   | Ý tưởng ThirtyTutors                          | Gemini Live realtime voice tutor, tool mood/quiz, trí nhớ cuộn                                  | Tự viết (WebSocket ở Main)                                                                          | AI Tutor, Speaking                   | M–L      | Trung bình      |
| 10  | Ý tưởng Babblr                                | Ràng buộc CEFR theo cấp, prompt ghép module, JSON lỗi, sửa STT theo ngữ cảnh                    | Tự viết                                                                                             | AI Gateway                           | S        | Cao             |
| 11  | npm `kokoro-js` (Apache‑2.0)                  | Giọng đọc tự nhiên offline                                                                      | Thư viện, model tải khi người dùng bật                                                              | Audio service                        | M        | Thấp (tùy chọn) |
| 12  | npm `@met4citizen/talkinghead` (MIT)          | Avatar 3D nhép môi                                                                              | Thư viện, cần avatar có license                                                                     | Tutor / Cinema                       | M–L      | Thấp (tùy chọn) |

**Loại bỏ:**

- Mọi runtime Python (Cadence engine, ThirtyTutors, Babblr backend).
- Lớp Rust/Tauri của Sprigo.
- Lớp Codex của VocabReader.
- Supabase, Stripe.
- Code và dữ liệu của EchoType, ThirtyTutors, Babblr.

**Quy tắc pháp lý khi làm:**

- Mỗi file chuyển từ repo MIT mang header `Derived from <repo>@<commit> (MIT, © <tác giả>)`.
- Gom các ghi chú vào `THIRD_PARTY_NOTICES.md` và đóng gói kèm installer.
- Với nguồn AGPL, PolyForm hoặc không license: chỉ ghi lại ý tưởng bằng lời của mình, không mở file nguồn khi viết code tương ứng.
