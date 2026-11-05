// Tutor modes (one per TutorStyle): bilingual names, descriptions and starter prompts.
import type { TutorStyle } from '@shared/types'
import { TUTOR_STYLES } from '@shared/types'

export interface ModeInfo {
  en: string
  vi: string
  descEn: string
  descVi: string
  bestFor: { en: string; vi: string }
  /** English prompts the learner can send to start, with a Vietnamese gloss. */
  starters: { text: string; vi: string }[]
}

export const MODES: Record<TutorStyle, ModeInfo> = {
  friendly: {
    en: 'Friendly tutor',
    vi: 'Gia sư thân thiện',
    descEn: 'Warm and encouraging. Fixes only the mistakes that matter and keeps the chat flowing.',
    descVi: 'Ấm áp, hay động viên. Chỉ sửa những lỗi quan trọng để bạn tự tin nói tiếp.',
    bestFor: { en: 'Beginners, building confidence', vi: 'Người mới, xây dựng sự tự tin' },
    starters: [
      { text: 'Hi! Can you help me practise English every day?', vi: 'Chào! Bạn giúp mình luyện tiếng Anh mỗi ngày nhé?' },
      { text: 'Let me tell you about my family.', vi: 'Để mình kể về gia đình mình.' },
      { text: 'What should I say when I meet someone new?', vi: 'Khi gặp người mới thì nên nói gì?' },
    ],
  },
  strict: {
    en: 'Strict coach',
    vi: 'Huấn luyện viên nghiêm khắc',
    descEn: 'Points out every meaningful mistake and asks you to try again until it is right.',
    descVi: 'Chỉ ra mọi lỗi đáng kể và yêu cầu bạn viết lại cho đến khi đúng.',
    bestFor: { en: 'Accuracy before exams', vi: 'Rèn độ chính xác trước kỳ thi' },
    starters: [
      { text: 'Check my sentence: Yesterday I have went to the cinema with my friends.', vi: 'Kiểm tra câu của mình…' },
      { text: 'Give me 5 sentences to correct, one by one.', vi: 'Cho mình 5 câu để sửa, từng câu một.' },
      { text: 'I want to describe my job. Correct every mistake, please.', vi: 'Mình muốn tả công việc. Sửa mọi lỗi nhé.' },
    ],
  },
  grammar: {
    en: 'Grammar coach',
    vi: 'Huấn luyện ngữ pháp',
    descEn: 'Every reply comes with a mini-rule and an example for the grammar point you just used.',
    descVi: 'Mỗi câu trả lời kèm một quy tắc ngắn và ví dụ cho điểm ngữ pháp bạn vừa dùng.',
    bestFor: { en: 'Tenses, articles, conditionals', vi: 'Thì, mạo từ, câu điều kiện' },
    starters: [
      { text: 'When do I use present perfect instead of past simple?', vi: 'Khi nào dùng hiện tại hoàn thành thay vì quá khứ đơn?' },
      { text: 'Can you explain "a", "an" and "the" with examples?', vi: 'Giải thích a/an/the kèm ví dụ được không?' },
      { text: 'If I had more time, I will learn the guitar. Is this correct?', vi: 'Câu này đúng không?' },
    ],
  },
  pronunciation: {
    en: 'Pronunciation coach',
    vi: 'Huấn luyện phát âm',
    descEn: 'Focuses on sounds Vietnamese speakers find hard: final consonants, /θ/ /ð/, word stress, with IPA tips.',
    descVi: 'Tập trung vào âm khó với người Việt: phụ âm cuối, /θ/ /ð/, trọng âm, kèm mẹo và IPA.',
    bestFor: { en: 'Clear speaking, Speaking test', vi: 'Nói rõ ràng, phần thi Nói' },
    starters: [
      { text: 'How do I pronounce "three" and "tree" differently?', vi: 'Phát âm "three" và "tree" khác nhau thế nào?' },
      { text: 'Which words do Vietnamese speakers often say wrong?', vi: 'Người Việt hay phát âm sai từ nào?' },
      { text: 'Help me with word stress in "photograph" and "photography".', vi: 'Giúp mình trọng âm của hai từ này.' },
    ],
  },
  professional: {
    en: 'Business English',
    vi: 'Tiếng Anh công sở',
    descEn: 'Emails, meetings and interviews in a polite, professional register.',
    descVi: 'Email, cuộc họp, phỏng vấn với văn phong lịch sự, chuyên nghiệp.',
    bestFor: { en: 'Work, interviews', vi: 'Công việc, phỏng vấn' },
    starters: [
      { text: 'Can we practise a job interview for a marketing position?', vi: 'Luyện phỏng vấn vị trí marketing nhé?' },
      { text: 'How do I politely ask my manager for a day off?', vi: 'Xin sếp nghỉ một ngày thế nào cho lịch sự?' },
      { text: 'Help me start a meeting in English.', vi: 'Giúp mình mở đầu cuộc họp bằng tiếng Anh.' },
    ],
  },
  ielts: {
    en: 'IELTS examiner',
    vi: 'Giám khảo IELTS',
    descEn: 'IELTS Speaking-style questions (Parts 1–3) with band-descriptor tips and strategies.',
    descVi: 'Câu hỏi kiểu IELTS Speaking (Part 1–3), kèm gợi ý theo tiêu chí chấm band.',
    bestFor: { en: 'Target band 6.5', vi: 'Mục tiêu band 6.5' },
    starters: [
      { text: 'Let’s do IELTS Speaking Part 1. Ask me about my hometown.', vi: 'Luyện Part 1: hỏi mình về quê hương.' },
      { text: 'Give me a Part 2 cue card and time me.', vi: 'Cho mình một cue card Part 2.' },
      { text: 'How can I improve my Lexical Resource score?', vi: 'Làm sao tăng điểm Lexical Resource?' },
    ],
  },
  casual: {
    en: 'Casual chat',
    vi: 'Trò chuyện thoải mái',
    descEn: 'Chat like with a native friend and pick up natural everyday expressions.',
    descVi: 'Nói chuyện như với một người bạn bản xứ, học cách diễn đạt tự nhiên hằng ngày.',
    bestFor: { en: 'Fluency, natural phrases', vi: 'Lưu loát, cụm từ tự nhiên' },
    starters: [
      { text: 'What did you do this weekend?', vi: 'Cuối tuần bạn làm gì?' },
      { text: 'Recommend me a good movie to watch tonight.', vi: 'Gợi ý một bộ phim để xem tối nay.' },
      { text: 'What do people say instead of "very good"?', vi: 'Người bản xứ nói gì thay cho "very good"?' },
    ],
  },
}

export const MODE_LIST: TutorStyle[] = [...TUTOR_STYLES]

export const CATEGORY_LABEL: Record<string, { en: string; vi: string }> = {
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  spelling: { en: 'Spelling', vi: 'Chính tả' },
  'word-choice': { en: 'Word choice', vi: 'Dùng từ' },
  punctuation: { en: 'Punctuation', vi: 'Dấu câu' },
  pronunciation: { en: 'Pronunciation', vi: 'Phát âm' },
  style: { en: 'Style', vi: 'Văn phong' },
}
