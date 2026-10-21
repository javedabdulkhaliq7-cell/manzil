// printProofCases.ts: sample papers for the Phase 1 print-engine proof (File 1 Section 6).
// Used by the hidden /dev/print-proof screen. Not shipped to students.
import type { TestDoc, Q } from './testPdfLayout'

export type ProofCase = { id: string; label: string; urdu: boolean; doc: TestDoc }

export function proofCases(png: Uint8Array): ProofCase[] {
  const mcq = (n: number, t: string, o: string[]): Q => ({ num: String(n), text: t, options: o })
  const para = (n: number, t: string): Q => ({ num: String(n), text: t })

  // ---- English / maths (cases 6, 7, 8)
  const mathQs: Q[] = [
    mcq(1, 'Solve: x² − 5x + 6 = 0. The roots are', ['2, 3', '−2, −3', '1, 6', '−1, 6']),
    mcq(2, 'The value of √(a² + b²) when a = 3 and b = 4 is', ['5', '7', '25', '12']),
    mcq(3, 'If 3/4 of a number is 18, the number is', ['24', '27', '13.5', '30']),
    mcq(4, 'The inequality x ≤ 4 and x ≥ −2 means x ∈ [−2, 4]. Which is true?', ['x = 5', 'x = 0', 'x = −3', 'x = 4.5']),
    para(5, 'Simplify (a + b)/(a − b) × (a² − b²)/(a + b)² and state the result in lowest terms. Take π ≈ 22/7, θ = 30°, and write 10⁻³ and x₂ correctly.'),
  ]
  function eng(counts: { mcq: number; b: number; short: number; long: number }, longLen = 1): TestDoc {
    const sc = 'Explain, with a diagram where useful, how the process described in this chapter works and why it matters in daily life. '.repeat(longLen)
    return {
      title: 'Mock Test', subtitle: 'Physics   |   Chapters 1, 2, 3   |   20 Oct 2026', meta: 'Marks: 30        Time: 40 minutes        Name: ____________   Score: ____',
      rtl: false,
      sections: [
        { heading: 'Section A: MCQs', instruction: 'Choose the correct answer. (10 x 1 = 10)', items: Array.from({ length: counts.mcq }, (_, i) => mcq(i + 1, `Question ${i + 1}: which of these statements about the topic is correct?`, ['First option here', 'Second option here', 'Third option here', 'Fourth option here'])) },
        { heading: 'Section B: One-mark questions', instruction: 'Fill in the blanks or write True/False. (5 x 1 = 5)', items: Array.from({ length: counts.b }, (_, i) => para(11 + i, `The unit of force is the ________ . (statement ${i + 1})`)) },
        { heading: 'Section C: Short questions', instruction: 'Attempt any 5 of 6. (5 x 2 = 10)', items: Array.from({ length: counts.short }, (_, i) => para(16 + i, `Define and explain the term used in part ${i + 1} of this chapter and give one example.`)) },
        { heading: 'Section D: Long questions', instruction: 'Attempt any 1 of 2. (1 x 5 = 5)', items: Array.from({ length: counts.long }, (_, i) => ({ ...para(22 + i, sc), ...(i === 0 ? { image: { png, w: 150, h: 90 } } : {}) })) },
      ],
    }
  }
  const maths: TestDoc = { ...eng({ mcq: 0, b: 0, short: 0, long: 0 }), subtitle: 'Mathematics   |   Chapter 4   |   20 Oct 2026', sections: [{ heading: 'Section A: Algebra', instruction: 'Maths symbols, fractions, powers (case 8)', items: mathQs }] }

  // ---- Urdu (cases 1-5)
  const urdu: TestDoc = {
    title: 'Mock Test', subtitle: 'اردو   |   باب ۱ اور ۲   |   20 Oct 2026', meta: 'کل نمبر: 30        وقت: 40 منٹ        نام: ____________', rtl: true,
    sections: [
      { heading: 'حصہ الف: کثیر الانتخابی سوالات', instruction: 'درست جواب کا انتخاب کریں۔ (10 × 1 = 10)', items: [
        mcq(1, 'علامہ اقبال کا شعری مجموعہ "بانگِ درا" کب شائع ہوا؟', ['1924ء', '1908ء', '1935ء', '1938ء']),
        mcq(2, 'قائداعظم محمد علی جناحؒ کی پیدائش کراچی میں ہوئی (Karachi) درست ہے یا غلط؟', ['درست', 'غلط', 'معلوم نہیں', 'کوئی نہیں']),
        mcq(3, 'اس جملے میں "اسم" کون سا لفظ ہے: لاہور ایک خوبصورت شہر ہے۔', ['لاہور', 'ایک', 'خوبصورت', 'ہے']),
      ] },
      { heading: 'حصہ ب: مختصر سوالات', instruction: 'کوئی سے 5 سوالات کے جوابات لکھیں۔ (5 × 2 = 10)', items: [
        para(4, 'مندرجہ ذیل عبارت کا خلاصہ لکھیں اور بتائیں کہ مصنف نے (Chapter 3) میں کن اہم نکات کی طرف اشارہ کیا ہے، نیز اپنی رائے کا اظہار 100 الفاظ میں کریں۔'),
        para(5, 'اس شعر کی تشریح کریں (دو سے تین جملوں میں): "خودی کو کر بلند اتنا کہ ہر تقدیر سے پہلے"'),
        para(6, 'Pakistan کا قومی ترانہ کس نے لکھا؟ (ابوالاثر حفیظ جالندھری) اور اس کی دھن کس نے بنائی؟'),
      ] },
    ],
  }
  // ---- Islamiat with vowel marks (case 5)
  const islamiat: TestDoc = {
    title: 'Mock Test', subtitle: 'اسلامیات   |   باب ۳   |   20 Oct 2026', meta: 'کل نمبر: 25        وقت: 35 منٹ', rtl: true,
    sections: [{ heading: 'حصہ الف: قرآنی آیات', instruction: 'آیت مکمل کریں۔', items: [
      para(1, 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — اس آیت کا ترجمہ لکھیں۔'),
      para(2, 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ (سورۃ الفاتحہ: 2) کی تفسیر بیان کریں۔'),
      mcq(3, 'نبی کریم ﷺ کی ولادت کس سال ہوئی؟', ['عام الفیل', 'ہجرت', 'فتح مکہ', 'بعثت']),
    ] }],
  }

  return [
    { id: 'urdu', label: 'Urdu paper: joining, mixed English, brackets (cases 1-4)', urdu: true, doc: urdu },
    { id: 'islamiat', label: 'Arabic with vowel marks (case 5)', urdu: true, doc: islamiat },
    { id: 'maths', label: 'Maths symbols, powers, fractions (case 8)', urdu: false, doc: maths },
    { id: 'short', label: 'Short test: expect 1 page (case 6)', urdu: false, doc: eng({ mcq: 6, b: 3, short: 3, long: 1 }) },
    { id: 'normal', label: 'Normal 30-mark test with diagram (cases 6-7)', urdu: false, doc: eng({ mcq: 10, b: 5, short: 6, long: 2 }) },
    { id: 'worst', label: 'Worst case, very long questions (case 6)', urdu: false, doc: eng({ mcq: 10, b: 5, short: 6, long: 2 }, 5) },
  ]
}
