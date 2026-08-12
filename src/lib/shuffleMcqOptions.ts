// src/lib/shuffleMcqOptions.ts
//
// Fixes answer-position skew from AI-generated MCQs (e.g. NotebookLM output
// where "B" ends up correct 60% of the time). Call this once per question,
// per render, in QuizScreen and MockTestScreen — never store the shuffled
// order in the DB, just shuffle in memory each time the question is shown.

export interface RawMcq {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  difficulty: string;
  mcq_type: string;
  // Optional — null/undefined for the vast majority of MCQs. Only set for
  // questions that reference a diagram (e.g. "look at the diagram below").
  diagram_type?: string | null;
  diagram_data?: any;
}

export interface ShuffledMcq {
  id: string;
  question: string;
  options: { label: string; text: string; isCorrect: boolean }[];
  explanation: string;
  difficulty: string;
  mcq_type: string;
  diagram_type?: string | null;
  diagram_data?: any;
}

// Simple Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function shuffleMcqOptions(mcq: RawMcq): ShuffledMcq {
  const raw = [
    { label: 'A', text: mcq.option_a, isCorrect: mcq.correct_option === 'A' },
    { label: 'B', text: mcq.option_b, isCorrect: mcq.correct_option === 'B' },
    { label: 'C', text: mcq.option_c, isCorrect: mcq.correct_option === 'C' },
    { label: 'D', text: mcq.option_d, isCorrect: mcq.correct_option === 'D' },
  ];

  const shuffled = shuffle(raw);

  // Re-letter A-D in the new order so the UI still shows clean labels
  const relabeled = shuffled.map((opt, idx) => ({
    label: ['A', 'B', 'C', 'D'][idx],
    text: opt.text,
    isCorrect: opt.isCorrect,
  }));

  return {
    id: mcq.id,
    question: mcq.question,
    options: relabeled,
    explanation: mcq.explanation,
    difficulty: mcq.difficulty,
    mcq_type: mcq.mcq_type,
    diagram_type: mcq.diagram_type,
    diagram_data: mcq.diagram_data,
  };
}

// Usage in QuizScreen / MockTestScreen:
//
//   import { shuffleMcqOptions } from '@/lib/shuffleMcqOptions';
//
//   const displayMcq = useMemo(() => shuffleMcqOptions(rawMcqFromDb), [rawMcqFromDb.id]);
//
// useMemo keyed on mcq.id ensures the shuffle happens once per question
// shown (not on every re-render), but reshuffles fresh next time the
// student sees that question in a different quiz attempt.
