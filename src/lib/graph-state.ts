/**
 * graph-state.ts
 * ──────────────
 * Defines the interview state that flows through the LangGraph state machine.
 * Every graph node receives this state, may mutate it, and returns it.
 */

/* ── Phase enum ─────────────────────────────────────────────────────── */
export type InterviewPhase =
  | "introduction"
  | "present_question"
  | "evaluate_approach"
  | "coding"
  | "review_solution"
  | "check_continue"
  | "end_interview";

/* ── Question shape (mirrors Supabase `dsa_questions` row) ──────── */
export interface DSAQuestion {
  id?: string;
  title: string;
  slug?: string;
  description?: string;
  prompt?: string;
  difficulty?: string;
  topics?: string[];
  companies?: string[];
  examples?: { input: string; output?: string; expected?: string }[];
  constraints?: string;
  hints?: string[];
}

/* ── Chat message ───────────────────────────────────────────────────── */
export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

/* ── Approach evaluation result from AI ─────────────────────────── */
export interface ApproachEvaluation {
  correct: boolean;
  optimal: boolean;
  timeComplexity?: string;
  spaceComplexity?: string;
  feedback: string;
  hint?: string;
}

/* ── The master state object ────────────────────────────────────── */
export interface InterviewGraphState {
  /** Current graph node / phase */
  phase: InterviewPhase;

  /** Full conversation history (user ↔ model) */
  messages: ChatMessage[];

  /** The question currently being solved */
  currentQuestion: DSAQuestion | null;

  /** Session configuration */
  company: string;
  topic: string;
  excludeTopics: string[];
  sessionId: string;

  /** Candidate's live code from the editor */
  userCode: string;

  /** Seconds remaining in the interview */
  timeRemainingSeconds: number;

  /** How many times the user has attempted the approach for the CURRENT question */
  approachAttempts: number;

  /** Max approach attempts before AI reveals optimal and moves to coding */
  maxApproachAttempts: number;

  /** How many questions have been asked so far in this session */
  questionsAsked: number;

  /* ── Output fields (set by nodes, consumed by frontend) ────── */

  /** The text the AI should speak aloud (short, natural) */
  aiSpeechText: string;

  /** Brief status shown on the UI (replaces old captions) */
  aiStatusText: string;

  /** Whether TTS should fire for the current response */
  shouldSpeak: boolean;

  /** Whether the code editor should be unlocked */
  editorUnlocked: boolean;

  /** Whether a new question should be fetched (consumed by the route) */
  shouldFetchQuestion: boolean;

  /** A newly fetched question (set by the route, consumed by frontend) */
  newQuestion: DSAQuestion | null;

  /** Structured approach evaluation (set by evaluate_approach node) */
  approachEval: ApproachEvaluation | null;

  /** ID of the stored feedback record (set after interview ends + feedback generated) */
  feedbackId: string | null;
}

/* ── Factory: creates a blank initial state ──────────────────── */
export function createInitialState(config: {
  company: string;
  topic: string;
  excludeTopics: string[];
  sessionId: string;
  timeRemainingSeconds: number;
}): InterviewGraphState {
  return {
    phase: "introduction",
    messages: [],
    currentQuestion: null,
    company: config.company,
    topic: config.topic,
    excludeTopics: config.excludeTopics,
    sessionId: config.sessionId,
    userCode: "",
    timeRemainingSeconds: config.timeRemainingSeconds,
    approachAttempts: 0,
    maxApproachAttempts: 3,
    questionsAsked: 0,
    aiSpeechText: "",
    aiStatusText: "Connecting...",
    shouldSpeak: false,
    editorUnlocked: false,
    shouldFetchQuestion: false,
    newQuestion: null,
    approachEval: null,
    feedbackId: null,
  };
}
