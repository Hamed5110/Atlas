export interface HelpTurn {
  question: string;
  answer: string;
}

/** The API accepts at most three earlier turns, each answer at most 2000 characters. */
export const HELP_HISTORY_TURNS = 3;

export function nextHistory(history: HelpTurn[], question: string, answer: string): HelpTurn[] {
  return [...history, { question: question.slice(0, 500), answer: answer.slice(0, 2000) }].slice(
    -HELP_HISTORY_TURNS,
  );
}
