/**
 * feedback-schema.ts
 * ──────────────────
 * Defines the structured schema for AI-generated interview feedback.
 * Gemini will return JSON matching this shape via response_mime_type: "application/json".
 */

export interface InterviewFeedback {
  /** Primary numeric rating from 1 to 5 */
  score: number;

  /** Overall score out of 10 for compatibility with the existing UI */
  overall_score: number;

  /** Sub-dimension scores (each 1–5) */
  introduction_score: number;
  approach_score: number;
  coding_score: number;
  communication_score: number;
  time_complexity_accuracy: number;
  space_complexity_accuracy: number;

  /** Time and space complexity identified from the code */
  time_complexity: string;
  space_complexity: string;

  /** Narrative justification for the overall score */
  justification: string;

  /** List of missing skills, concepts, or patterns */
  gaps_identified: string[];

  /** List of things the candidate did well */
  strengths: string[];

  /** A targeted follow-up question to address the main gap */
  suggested_followup: string;

  /** Per-question breakdown */
  question_breakdown: QuestionBreakdown[];
}

export interface QuestionBreakdown {
  question_title: string;
  approach_correct: boolean;
  approach_optimal: boolean;
  code_submitted: boolean;
  time_complexity: string;
  space_complexity: string;
  notes: string;
}

/** The JSON schema string we pass to Gemini as the response schema instruction */
export const FEEDBACK_SCHEMA_DESCRIPTION = `{
  "score": <integer 1-5>,
  "overall_score": <integer 1-10>,
  "introduction_score": <integer 1-5>,
  "approach_score": <integer 1-5>,
  "coding_score": <integer 1-5>,
  "communication_score": <integer 1-5>,
  "time_complexity_accuracy": <integer 1-5>,
  "space_complexity_accuracy": <integer 1-5>,
  "time_complexity": "<string, e.g. O(n log n)>",
  "space_complexity": "<string, e.g. O(n)>",
  "justification": "<detailed paragraph explaining the overall score>",
  "gaps_identified": ["<gap1>", "<gap2>", ...],
  "strengths": ["<strength1>", "<strength2>", ...],
  "suggested_followup": "<a targeted follow-up question>",
  "question_breakdown": [
    {
      "question_title": "<title>",
      "approach_correct": <boolean>,
      "approach_optimal": <boolean>,
      "code_submitted": <boolean>,
      "time_complexity": "<string>",
      "space_complexity": "<string>",
      "notes": "<brief notes>"
    }
  ]
}`;
