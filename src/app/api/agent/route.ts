/**
 * /api/agent — LangGraph Interview Agent Endpoint
 * ────────────────────────────────────────────────
 * Receives the current graph state + user input from the client,
 * runs one step of the interview graph, and returns the new state.
 *
 * The route also handles question fetching from Supabase when
 * a node requests it (shouldFetchQuestion).
 */

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createInterviewGraph } from "../../../lib/interview-graph";
import { createInitialState } from "../../../lib/graph-state";
import type { InterviewGraphState } from "../../../lib/graph-state";

/* ── Supabase client (server-side) ─────────────────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

/* ── Helpers ───────────────────────────────────────────────────────── */

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function safeErrorMessage(err: any): string {
  const msg = err?.message ?? err?.toString?.() ?? "Unknown error";
  return typeof msg === "string" ? msg : "Unknown error";
}

function getUpstreamStatus(err: any): number | undefined {
  const status = err?.status ?? err?.response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Fetch a random DSA question from Supabase, avoiding previously asked
 * questions in this session.
 */
async function fetchQuestion(
  company: string,
  excludeTopics: string[],
  sessionId?: string
) {
  const { data, error } = await supabase.rpc("pick_random_dsa_question", {
    p_company: company === "Generic" ? null : company,
    p_exclude_topics:
      excludeTopics && excludeTopics.length > 0 ? excludeTopics : null,
    p_session_id: sessionId || null,
  });

  if (error) {
    console.warn("Question fetch error:", error);
    return null;
  }

  // Handle array or single-object return
  const q = Array.isArray(data) ? data[0] : data;
  return q ?? null;
}

/* ── POST handler ──────────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    /* ── Validate API key ─────────────────────────────────────────── */
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error: "Server misconfigured",
          detail: "GEMINI_API_KEY is missing",
          hint: "Add GEMINI_API_KEY to .env and restart the dev server.",
        },
        { status: 500 }
      );
    }

    /* ── Parse body ────────────────────────────────────────────────── */
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const {
      graphState: clientState,
      userInput,
      userCode,
      timeRemainingSeconds,
      // Legacy / initial-call fields
      company,
      topic,
      excludeTopics,
      sessionId,
      duration,
    } = body ?? {};

    /* ── Build or restore the graph state ──────────────────────────── */
    let state: InterviewGraphState;

    if (clientState && typeof clientState === "object" && clientState.phase) {
      // Existing session — restore state from client
      state = clientState as InterviewGraphState;
      // Always update live fields from the client
      if (typeof userCode === "string") state.userCode = userCode;
      if (typeof timeRemainingSeconds === "number")
        state.timeRemainingSeconds = timeRemainingSeconds;
    } else {
      // First call — create initial state
      state = createInitialState({
        company: company || "Generic",
        topic: topic || "DSA",
        excludeTopics: excludeTopics || [],
        sessionId: sessionId || "",
        timeRemainingSeconds:
          typeof timeRemainingSeconds === "number"
            ? timeRemainingSeconds
            : (duration || 45) * 60,
      });
    }

    /* ── Run one step of the graph ─────────────────────────────────── */
    const graph = createInterviewGraph();
    let newState = await graph.step(state, userInput || "");

    /* ── Handle question fetching ──────────────────────────────────── */
    if (newState.shouldFetchQuestion) {
      const question = await fetchQuestion(
        newState.company,
        newState.excludeTopics,
        newState.sessionId
      );

      if (question) {
        newState.currentQuestion = question;
        newState.newQuestion = question;
        newState.shouldFetchQuestion = false;

        // Now auto-run the present_question node since we have the question
        if (newState.phase === "present_question") {
          const previousSpeech = newState.aiSpeechText; // Save intro acknowledgment
          newState = await graph.step(newState, "");
          // Combine speech: intro acknowledgment + question presentation
          if (previousSpeech && newState.aiSpeechText) {
            newState.aiSpeechText = previousSpeech + " " + newState.aiSpeechText;
          }
        }
      } else {
        // Fallback question
        newState.currentQuestion = {
          title: "3Sum",
          description:
            'Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0. The solution set must not contain duplicate triplets.',
          examples: [
            { input: "6\n-1 0 1 2 -1 -4", output: "-1 -1 2\n-1 0 1" },
            { input: "3\n0 1 1", output: "[]" },
            { input: "5\n0 0 0 0 0", output: "0 0 0" },
          ],
          difficulty: "Medium",
          prompt:
            "Given an integer array nums, return all unique triplets whose sum is 0.",
        };
        newState.newQuestion = newState.currentQuestion;
        newState.shouldFetchQuestion = false;

        if (newState.phase === "present_question") {
          const previousSpeech = newState.aiSpeechText;
          newState = await graph.step(newState, "");
          if (previousSpeech && newState.aiSpeechText) {
            newState.aiSpeechText = previousSpeech + " " + newState.aiSpeechText;
          }
        }
      }
    }

    /* ── Return the new state to the client ────────────────────────── */
    return NextResponse.json({
      graphState: newState,
      // Convenience fields for the frontend
      aiSpeechText: newState.aiSpeechText,
      aiStatusText: newState.aiStatusText,
      shouldSpeak: newState.shouldSpeak,
      phase: newState.phase,
      editorUnlocked: newState.editorUnlocked,
      newQuestion: newState.newQuestion,
      approachEval: newState.approachEval,
    });
  } catch (error: any) {
    console.error("Agent API Error:", error);

    const status = getUpstreamStatus(error);
    const msg = safeErrorMessage(error);

    if (status === 429) {
      return NextResponse.json(
        {
          error: "Gemini quota exceeded",
          detail: msg,
          retryAfterSeconds: 60,
          hint: "Check your Gemini API quota.",
        },
        { status: 429 }
      );
    }

    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          error: "Gemini auth failed",
          detail: msg,
          hint: "Check that the API key is valid.",
        },
        { status: status }
      );
    }

    return NextResponse.json(
      {
        error: "Internal Server Error",
        ...(isDev() ? { detail: msg } : null),
      },
      { status: typeof status === "number" ? status : 500 }
    );
  }
}
