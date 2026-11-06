# Lingua Quest – Kế hoạch dự án

## Mục tiêu

Ứng dụng desktop Windows giúp người Việt học tiếng Anh từ con số 0 đến IELTS 6.5 (≈ CEFR B2): cá nhân hóa bằng AI (Gemini + OpenAI), học theo hành trình (roadmap), trải nghiệm điện ảnh tương tác (Cinema Mode) và trò chơi RPG – một ứng dụng người học _muốn_ mở mỗi ngày.

## Kết quả khảo sát môi trường (PHASE 0)

| Hạng mục          | Kết quả                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS                | Windows 11 Pro 10.0.26300, i5‑13500, 32 GB RAM                                                                                                                                      |
| Ổ đĩa             | C: còn ~14 GB → dự án đặt ở `D:\LinguaQuest` (D: còn ~213 GB)                                                                                                                       |
| Node.js           | Toàn cục 22.11.0 (quá cũ cho Vite 7 / Electron installer – cần ≥ 22.12 hoặc ≥ 20.19). Dùng **Node 20.20.0** có sẵn trong nvm, chỉ cho dự án này (`.nvmrc`), không đổi Node toàn cục |
| npm / pnpm / yarn | 10.8.2 (kèm Node 20.20) / 9.14.4 / 1.22.19                                                                                                                                          |
| Git               | 2.37.3                                                                                                                                                                              |
| Python            | 3.13.5 (dùng cho script tạo icon và kiểm tra nội dung)                                                                                                                              |
| Build Windows     | Electron Builder (NSIS + portable) chạy trực tiếp trên Windows; VS 2022 có sẵn nhưng không cần vì không dùng native module                                                          |
| Test/Debug        | Vitest, Playwright (`_electron`), DevTools của Electron                                                                                                                             |

## Phạm vi (theo yêu cầu người dùng)

Onboarding + đánh giá CEFR từng kỹ năng → roadmap AI chỉnh sửa được → Listening Lab, Speaking Studio, Reading Adventure, Writing Workshop → Cinema Mode → Game Mode (XP, level, quest, achievement, bản đồ 7 vùng) → Smart Vocabulary + FSRS → AI Tutor 7 chế độ → Dashboard, Journey, Statistics, Achievements, Settings → tìm kiếm toàn cục, favorites/bookmarks, lịch học, thông báo desktop, backup/restore, import/export, chẩn đoán, phím tắt, light/dark.

## Các phase

1. **PHASE 0** – Khảo sát môi trường ✅
2. **PHASE 1** – Kiến trúc & kế hoạch (file này, `ARCHITECTURE.md`, `TASKS.md`, `TEST_PLAN.md`, `CHANGELOG.md`)
3. **PHASE 2** – Xây dựng: nền tảng (DB, IPC, bảo mật) → learning engine → AI adapters → services → UI từng module → nội dung nguyên bản
4. **PHASE 3** – Kiểm thử nhiều vòng: static → unit → integration → E2E → UI/UX → sửa lỗi → regression
5. **PHASE 4** – Release gate → Electron Builder (installer NSIS + portable) → kiểm tra installer
6. **PHASE 5** – Báo cáo cuối

## Quyết định chính

- **SQLite qua sql.js (SQLite biên dịch WASM)** thay vì better-sqlite3: không cần biên dịch native module cho từng ABI (Node khi test, Electron khi chạy), đóng gói ổn định. Đánh đổi: DB nằm trong bộ nhớ và được ghi xuống đĩa theo kiểu atomic (tmp → rename, giữ bản `.bak`) sau mỗi giao dịch – phù hợp DB cá nhân vài MB.
- **AI gọi bằng REST (`fetch`) ở Main Process**, không dùng SDK: ít phụ thuộc, dễ mock khi test, key không bao giờ rời Main.
- **Giọng đọc**: mặc định giọng hệ thống Windows (offline, Web Speech `speechSynthesis`); giọng tự nhiên qua OpenAI TTS hoặc Gemini TTS khi có key.
- **Nhận dạng giọng nói**: Electron không hỗ trợ Web Speech Recognition, nên STT dùng OpenAI Transcriptions hoặc Gemini multimodal (audio). Không có key → vẫn ghi âm, nghe lại, đo thời lượng/ngắt nghỉ.
- **Nội dung học nguyên bản 100%** (bài đọc, bài nghe, phim tương tác, đề đánh giá, từ điển offline) – không dùng tài liệu có bản quyền.

## Tiêu chí nghiệm thu

Xem `TEST_PLAN.md` mục "Release checklist".

---

## Điều chỉnh sau nghiên cứu mã nguồn mở (2026-11-05) – ĐÃ DUYỆT, ĐÃ TRIỂN KHAI

Chi tiết: `docs/OSS_RESEARCH.md`. Kiến trúc đề xuất: mục "Đề xuất v2" trong `ARCHITECTURE.md`.

**Trạng thái:** người dùng đã duyệt ngày 05/11/2026. Đã hoàn thành 2A (Kernel), 2B (content pack) và 2C (module), sau đó PHASE 3–4. Phần 2D để lại cho sau v1.

**Đề xuất:** giữ Lingua Quest là một ứng dụng Electron duy nhất, tổ chức thành các module độc lập dùng chung Kernel (dữ liệu, AI, âm thanh, hồ sơ người học, kho từ vựng, tiến độ/gamification).

- **Tận dụng (MIT, chuyển source có ghi công):**
  - Sprigo: giáo trình A1→C2, prompt và schema bài tập/gia sư.
  - VocabReader: prompt ôn từ và đọc hiểu; nhập EPUB ở giai đoạn sau.
  - Cadence: dữ liệu phát âm và thuật toán căn chỉnh âm vị.
- **Dùng thư viện:** `ts-fsrs`. Tùy chọn sau v1: `kokoro-js`, TalkingHead.
- **Chỉ lấy ý tưởng (license không cho phép dùng code):** EchoType, ThirtyTutors, Babblr.
- **Không dùng** sidecar Python hay server riêng.

### Lộ trình sửa đổi (nếu được duyệt)

1. **2A – Kernel:**
   - AI Gateway: Gemini và OpenAI, Prompt Library, ràng buộc CEFR.
   - Audio service.
   - Learner model.
   - Vocab Hub: chuyển sang `ts-fsrs`.
   - Event bus Progress.
   - IPC, preload, bảo mật.
2. **2B – Content packs:**
   - Nội dung gốc.
   - Converter `courses/en.yml` của Sprigo → schema Lingua Quest.
   - Pack "Pronunciation Path" từ Cadence.
   - `THIRD_PARTY_NOTICES.md`.
3. **2C – Module** (mỗi module áp dụng ý tưởng đã chọn):
   - Journey/Onboarding.
   - Listening: thêm nghe 3 tầng.
   - Speaking: thêm Pronunciation Path.
   - Reading.
   - Writing.
   - Cinema.
   - Vocabulary.
   - Tutor.
   - Game.
4. **PHASE 3–5 giữ nguyên:** test nhiều vòng → release gate → đóng gói → báo cáo.
5. **2D – Sau v1, tùy chọn:**
   - Nhập EPUB.
   - Gia sư giọng nói realtime qua Gemini Live.
   - Giọng đọc offline Kokoro.
   - Avatar 3D.

**Khối lượng phát sinh so với kế hoạch cũ:** khoảng +15–20%, chủ yếu ở converter giáo trình và Prompt Library. Đổi lại:

- giáo trình A1→C2 đầy đủ hơn;
- prompt đã được kiểm chứng ở dự án khác;
- dữ liệu phát âm chất lượng.

Installer không tăng đáng kể.
