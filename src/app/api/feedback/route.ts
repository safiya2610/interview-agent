

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { InterviewFeedback } from "../../../lib/feedback-schema";
import { FEEDBACK_SCHEMA_DESCRIPTION } from "../../../lib/feedback-schema";
import type { ChatMessage } from "../../../lib/graph-state";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);


function getGenAI(): GoogleGenerativeAI {
  // आपके कोड की Line 21
  const key = process.env.GEMINI_FEEDBACK_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_FEEDBACK_API_KEY or GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

async function resolveUserIdAndEnsureAuth(req: Request): Promise<{ userId: string | null; token: string | null }> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user?.id) {
      return { userId: data.user.id, token };
    }
  }

  // Fallback: unauthenticated
  return { userId: null, token: null };
}

function createAuthedSupabaseClient(token: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // Create client that forwards the caller JWT so RLS can evaluate auth.uid().
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}






export async function POST(req: Request) {
  try {
    if (!process.env.GEMINI_FEEDBACK_API_KEY && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_FEEDBACK_API_KEY or GEMINI_API_KEY is missing" },
        { status: 500 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const bodyObj = body as any;
    const {
      sessionId,
      messages,
      userCode,
      questionsAsked,
      company,
      topic,
      approachEval,
      currentQuestion,
    } = bodyObj ?? {};

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    /* ── Build the evaluation transcript ───────────────────────────── */
    const conversationTranscript = (messages as ChatMessage[] ?? [])
      .map((m) => `[${m.role === "user" ? "CANDIDATE" : "INTERVIEWER"}]: ${m.content}`)
      .join("\n\n");

    /* ── Build Gemini evaluation prompt ────────────────────────────── */
    const evaluationPrompt = `You are an expert senior engineering interviewer and evaluator at ${company || "a top tech company"}.

You just completed a mock technical interview. Your task is to evaluate the candidate's performance across ALL dimensions of the interview and return a structured JSON report.

═══════════════════════════════════════════
INTERVIEW METADATA
═══════════════════════════════════════════
Company: ${company || "Generic"}
Topic: ${topic || "DSA"}
Questions Attempted: ${questionsAsked || 1}
${currentQuestion ? `Last Question: ${currentQuestion.title}` : ""}

═══════════════════════════════════════════
CANDIDATE'S FINAL CODE
═══════════════════════════════════════════
\`\`\`
${userCode || "// No code submitted"}
\`\`\`

${approachEval ? `
═══════════════════════════════════════════
APPROACH EVALUATION (from interview)
═══════════════════════════════════════════
Approach Correct: ${approachEval.correct}
Approach Optimal: ${approachEval.optimal}
Time Complexity Stated: ${approachEval.timeComplexity || "Not stated"}
Space Complexity Stated: ${approachEval.spaceComplexity || "Not stated"}
` : ""}

═══════════════════════════════════════════
FULL INTERVIEW TRANSCRIPT
═══════════════════════════════════════════
${conversationTranscript || "No conversation recorded."}

═══════════════════════════════════════════
EVALUATION RUBRIC
═══════════════════════════════════════════

INTRODUCTION (score 1–5):
- 5: Clear, confident, relevant background, excellent communication
- 3: Adequate introduction, some details missing
- 1: Unclear, irrelevant, or very brief

APPROACH EXPLANATION (score 1–5):
- 5: Identified optimal approach immediately, correct time/space complexity
- 3: Correct approach but not optimal, or correct with some hints
- 1: Wrong approach or unable to explain

CODING QUALITY (score 1–5):
- 5: Clean, correct, handles edge cases, good variable names
- 3: Mostly correct, minor bugs or missing edge cases
- 1: Significant bugs, incomplete, or no code submitted

COMMUNICATION DURING CODING (score 1–5):
- 5: Thinks aloud clearly, asks smart clarifying questions, handles hints well
- 3: Some communication, occasionally quiet or off-track
- 1: Silent, confused by hints, or unable to clarify

TIME COMPLEXITY ACCURACY (score 1–5):
- 5: Correctly identifies time complexity of their solution
- 3: Partially correct (e.g., off by log factor)
- 1: Incorrect or unable to state

SPACE COMPLEXITY ACCURACY (score 1–5):
- 5: Correctly identifies space complexity
- 3: Partially correct
- 1: Incorrect or unable to state

OVERALL SCORE (1–10): Holistic assessment combining all dimensions.
PRIMARY RATING (1–5): Use this as the main interview rating for candidate performance.

═══════════════════════════════════════════
REQUIRED JSON OUTPUT FORMAT
═══════════════════════════════════════════
Return ONLY valid JSON matching this exact schema. Do not include markdown formatting or extra text:
${FEEDBACK_SCHEMA_DESCRIPTION}

PER-QUESTION BREAKDOWN REQUIREMENTS (MOST IMPORTANT)
═══════════════════════════════════════════
- Populate question_breakdown with one item for EACH main interview question (and/or each follow-up question) that appears in the transcript.
- For each item, use the transcript to extract:
  1) The question title (or best available label) as question_title.
  2) Whether the candidate's answer to that question was logically correct as approach_correct.
  3) Whether it was optimal (best time/space) as approach_optimal.
  4) Candidate code submission status as code_submitted (true if candidate provided code at that stage; otherwise false).
  5) The time/space complexity they stated/indicated as time_complexity / space_complexity.
  6) Put FOLLOW-UP Q&A into notes by referencing the transcript verbatim-ish:
     - Include the agent's follow-up question text (or a short quote)
     - Include the candidate's answer text (or a short quote)
     - Then add 1-3 sentences of evaluation notes that explain what was good, what was missing, and what should be improved.

Be specific, constructive, and honest in your evaluation. Reference actual moments from the transcript.
`;


    /* ── Call Gemini ────────────────────────────────────────────────── */
    const rawResponse = await (async () => {
      const genAI = getGenAI();

      const modelNames = (
        process.env.GEMINI_MODEL
          ? process.env.GEMINI_MODEL.split(",").map((s) => s.trim()).filter(Boolean)
          : ["gemini-3.1-flash-lite", "gemini-3.1-flash", "gemini-2.0-flash", "gemini-1.5-flash-latest"]



      );

      let lastErr: any = null;
      for (const modelName of modelNames) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          const result = await model.generateContent(evaluationPrompt);
          return result.response.text();
        } catch (e: any) {
          lastErr = e;
        }
      }

      throw lastErr;
    })();





    let feedback: InterviewFeedback;
    try {
      // Strip markdown code fences if present
      const cleaned = rawResponse
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      feedback = JSON.parse(cleaned);

      if (typeof feedback.score !== "number") {
        feedback.score = Math.max(1, Math.min(5, Math.round((feedback.overall_score ?? 0) / 2)));
      }
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Gemini response as JSON", raw: rawResponse },
        { status: 500 }
      );
    }

   
    const { userId, token } = await resolveUserIdAndEnsureAuth(req);

    // Use an authenticated client for the insert so RLS sees the correct auth.uid().
    const supabaseAuthed = token ? createAuthedSupabaseClient(token) : null;


    // Insert feedback record
    // Important: RLS requires the DB request to be authenticated.
    if (!userId || !supabaseAuthed) {

      // Fallback: let UI still show feedback without saving.
      console.warn(
        "No authenticated user_id/token resolved; returning generated feedback without saving."
      );
      return NextResponse.json({
        feedback,
        feedbackId: null,
        warning: "Feedback generated but not saved (missing authenticated user).",
      });
    }

    const insertResp = await supabaseAuthed
      .from("interview_feedback")
      .insert({
        session_id: sessionId,
        user_id: userId,
        overall_score: feedback.overall_score,
        score: feedback.score,
        introduction_score: feedback.introduction_score,
        approach_score: feedback.approach_score,
        coding_score: feedback.coding_score,
        communication_score: feedback.communication_score,
        time_complexity_accuracy: feedback.time_complexity_accuracy,
        space_complexity_accuracy: feedback.space_complexity_accuracy,
        time_complexity: feedback.time_complexity,
        space_complexity: feedback.space_complexity,
        justification: feedback.justification,
        gaps_identified: feedback.gaps_identified,
        strengths: feedback.strengths,
        suggested_followup: feedback.suggested_followup,
        full_feedback: feedback,
      })
      .select("id")
      .single();

    const feedbackRow = (insertResp as any)?.data;
    const insertError = (insertResp as any)?.error;





    if (insertError) {
      console.error("Failed to insert feedback row:", insertError);
    }

    if (insertError || !feedbackRow) {
      console.error("Failed to insert feedback row:", insertError);

      return NextResponse.json({
        feedback,
        feedbackId: null, 
        dbError: insertError?.message ?? "No feedback row returned.",
        warning:
          "Feedback was generated but could not be saved to database (RLS). Cached locally instead.",
      });
    }


    await (supabaseAuthed ?? supabase)
      .from("interview_sessions")
      .update({ agent_score: feedback.overall_score })
      .eq("id", sessionId);


    return NextResponse.json({
      feedback,
      feedbackId: (feedbackRow as any)?.id ?? null,
    });
  } catch (error: any) {
    console.error("Feedback API Error:", error);
    // Even on total failure, try to return the best feedback we have
    // This ensures users don't get a blank screen
    return NextResponse.json(
      {
        error: "Internal Server Error",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
