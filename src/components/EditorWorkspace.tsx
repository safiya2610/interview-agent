"use client";

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { InterviewGraphState, InterviewPhase, DSAQuestion } from "../lib/graph-state";
import type { InterviewFeedback } from "../lib/feedback-schema";
import FeedbackModal from "./FeedbackModal";
import EyeTracker from "./EyeTracker";

const ACTIVE_SESSION_STORAGE_KEY = "interview_agent_active_session_v1";

function createUuidFallback() {
  return `id_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

function getOrCreateStableSessionId(company: string, topic: string, duration: number) {
  if (typeof window === "undefined") return createUuidFallback();

  try {
    const raw = window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      const isFresh = typeof parsed?.ts === "number" && Date.now() - parsed.ts < 10_000;
      const matches = parsed?.company === company && parsed?.topic === topic && parsed?.duration === duration;
      if (isFresh && matches && typeof parsed?.id === "string" && parsed.id.length > 0) {
        return parsed.id as string;
      }
    }
  } catch {
    // ignore
  }

  const id = (globalThis as any)?.crypto?.randomUUID?.() ?? createUuidFallback();
  try {
    window.sessionStorage.setItem(
      ACTIVE_SESSION_STORAGE_KEY,
      JSON.stringify({ id, company, topic, duration, ts: Date.now() })
    );
  } catch {
    // ignore
  }
  return id as string;
}

type Props = {
  company: string;
  topic: string;
  duration: number;
  excludeTopics?: string[];
  onEnd?: () => void;
};

const FIXED_THREE_SUM_QUESTION: DSAQuestion = {
  title: "3Sum",
  description:
    'Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0. The solution set must not contain duplicate triplets.\n\nInput format for this editor:\n- First line: integer n\n- Second line: n space-separated integers\n\nOutput format for deterministic judging:\n- Print each unique triplet as "a b c" (values inside each triplet in nondecreasing order)\n- Print triplets in lexicographic order, one triplet per line\n- If no triplet exists, print []',
  examples: [
    { input: "6\n-1 0 1 2 -1 -4", output: "-1 -1 2\n-1 0 1" },
    { input: "3\n0 1 1", output: "[]" },
    { input: "5\n0 0 0 0 0", output: "0 0 0" },
  ],
  difficulty: "Medium",
  prompt:
    "Given an integer array nums, return all unique triplets whose sum is 0. Do not return duplicate triplets.",
};

function getDefaultThreeSumTestCases() {
  return (FIXED_THREE_SUM_QUESTION.examples || []).slice(0, 3).map((e: any) => ({
    input: String(e.input ?? ""),
    expected: String(e.output ?? e.expected ?? ""),
    custom: false,
  }));
}

/* ── Phase status labels shown in the AI panel ──────────────────────── */
function getPhaseStatusText(phase: InterviewPhase, customStatus?: string): string {
  if (customStatus) return customStatus;
  switch (phase) {
    case "introduction": return "Introduce yourself to begin...";
    case "present_question": return "Read the question below";
    case "evaluate_approach": return "Listening to your approach...";
    case "coding": return "Code your solution — ask if you need help";
    case "review_solution": return "Reviewing your solution...";
    case "check_continue": return "Preparing...";
    case "end_interview": return "Interview complete";
    default: return "Connecting...";
  }
}

export default function EditorWorkspace({ company, topic, duration, excludeTopics, onEnd }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [editorValue, setEditorValue] = useState(`// Implement your solution here\n`);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(duration * 60);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtMsRef = useRef<number>(Date.now());
  const endedRef = useRef(false);
  const startedInterviewKeyRef = useRef<string | null>(null);
  const [activeBottomTab, setActiveBottomTab] = useState<"testcase" | "result">("testcase");
  const [submissionStatus, setSubmissionStatus] = useState<"accepted" | "wrong" | "compile" | null>(null);

  // Graph state (the full state object sent to/from the API)
  const [graphState, setGraphState] = useState<InterviewGraphState | null>(null);
  const [currentPhase, setCurrentPhase] = useState<InterviewPhase>("introduction");
  const [statusText, setStatusText] = useState("Connecting to session...");
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedbackRequestedRef = useRef(false);

  const [language, setLanguage] = useState("C++ 17");
  const [consoleVisible, setConsoleVisible] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [testCases, setTestCases] = useState<{ input: string; expected: string; custom?: boolean }[]>([]);
  const [testResults, setTestResults] = useState<{ input: string; expected: string; output?: string; passed: boolean; error?: string }[]>([]);
  const [currentTestIndex, setCurrentTestIndex] = useState<number>(0);
  const [consoleHeight, setConsoleHeight] = useState<number>(160);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const [customInput, setCustomInput] = useState<string>("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ line: number; column?: number; message: string }[]>([]);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const recognitionRef = useRef<any>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const accumulatedTranscriptRef = useRef<string>("");
  const pendingSendRef = useRef(false);
  const sendToGraphRef = useRef<(input: string) => void>(() => {});
  const preRef = useRef<HTMLElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const GUTTER_WIDTH = 56;
  const [showEyeWarning, setShowEyeWarning] = useState(false);

  const excludeKey = (excludeTopics ?? []).filter(Boolean).join(",");
  const interviewKey = `${company}__${topic}__${duration}__${excludeKey}`;

  /* ── Initialize interview ──────────────────────────────────────── */
  useEffect(() => {
    if (startedInterviewKeyRef.current === interviewKey) return;
    startedInterviewKeyRef.current = interviewKey;

    setUnlocked(false);
    setGraphState(null);
    setCurrentPhase("introduction");
    setCurrentQuestion(null);
    setTestCases([]);
    setCurrentTestIndex(0);
    setTestResults([]);
    setSubmissionStatus(null);
    setStatusText("Connecting to session...");
    setFeedback(null);
    setFeedbackId(null);
    setFeedbackLoading(false);
    setShowFeedbackModal(false);
    setFeedbackError(null);
    feedbackRequestedRef.current = false;

    void startInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewKey]);

  async function startInterview() {
    // Send initial call to the graph — no user input, triggers introduction node
    await sendToGraph("");
  }

  /* ── Speech Recognition (STT) ──────────────────────────────────── */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let currentInterim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        accumulatedTranscriptRef.current += " " + finalTranscript;
      }
      setInterimTranscript(currentInterim);
    };

    recognition.onend = () => {
      setListening(false);
      // When we stopped intentionally (pendingSend), send the accumulated transcript now
      // — this fires AFTER all final onresult events, so the transcript is complete.
      if (pendingSendRef.current) {
        pendingSendRef.current = false;
        const finalMsg = accumulatedTranscriptRef.current.trim();
        if (finalMsg) {
          sendToGraphRef.current(finalMsg);
        }
        accumulatedTranscriptRef.current = "";
        setInterimTranscript("");
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech Recognition Error", event.error);
      setListening(false);
      pendingSendRef.current = false;
    };

    recognitionRef.current = recognition;
  }, []);

  // Keep sendToGraphRef always pointing to the latest sendToGraph
  // so the onend handler (set up once) can call the current version.
  sendToGraphRef.current = sendToGraph;

  async function getAuthToken() {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getSession();
      if (error || !data?.session) return null;
      return data.session.access_token ?? null;
    } catch {
      return null;
    }
  }

  async function requestInterviewFeedback(state: InterviewGraphState) {
    if (feedbackRequestedRef.current) return;
    feedbackRequestedRef.current = true;
    setFeedbackLoading(true);
    setFeedbackError(null);
    setStatusText("Generating final interview evaluation...");

    try {
      if (!sessionIdRef.current) {
        throw new Error("No session ID available when attempting to save feedback.");
      }

      const token = await getAuthToken();
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          messages: state.messages,
          userCode: state.userCode,
          questionsAsked: state.questionsAsked,
          company,
          topic,
          approachEval: state.approachEval,
          currentQuestion: state.currentQuestion,
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(data?.error || data?.detail || data?.dbError || `Unable to generate feedback (${res.status})`);
      }

      if (!data.feedback) {
        throw new Error("Feedback API returned no feedback.");
      }

      // Even if there was a DB error, show the feedback on the modal
      if (data?.dbError) {
        console.warn("Feedback API warning:", data.dbError);
      }

      setFeedback(data.feedback as InterviewFeedback);
      setFeedbackId(data.feedbackId ?? null);
      setShowFeedbackModal(true);
      setStatusText("Final evaluation ready.");
    } catch (error: any) {
      console.error("Feedback generation failed", error);
      setFeedbackError(typeof error === "string" ? error : error?.message ?? "Unable to generate feedback");
      setStatusText("Final evaluation could not be generated.");
    } finally {
      setFeedbackLoading(false);
    }
  }

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in your browser. Please use Chrome or Edge.");
      return;
    }

    if (listening) {
      // Mark that we want to send the transcript once recognition fully ends.
      // recognition.onend fires AFTER the final onresult, so the transcript is complete.
      pendingSendRef.current = true;
      recognitionRef.current.stop();
      // Don't read transcript here — onend will handle it.
    } else {
      accumulatedTranscriptRef.current = "";
      setInterimTranscript("");
      pendingSendRef.current = false;
      setListening(true);
      recognitionRef.current.start();
    }
  };

  /* ── Voice Output (TTS) ────────────────────────────────────────── */
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        voicesRef.current = v;
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = (text: string, retryCount = 0) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    setIsAiSpeaking(false);

    // Clean markdown or special chars for better speech
    const cleanText = text
      .replace(/\*\*/g, "")
      .replace(/#/g, "")
      .replace(/`/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/\[Question presented:.*?\]/g, "")
      .trim();
    if (!cleanText) return;

    if (voicesRef.current.length === 0 && retryCount < 5) {
      setTimeout(() => speak(text, retryCount + 1), 200);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-IN";

    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices();

    const preferredVoice =
      voices.find(v => v.lang.startsWith("en-IN") && (v.name.includes("Natural") || v.name.includes("Premium"))) ||
      voices.find(v => v.lang.startsWith("en-IN") && v.name.includes("Google")) ||
      voices.find(v => v.lang.startsWith("en-IN")) ||
      voices.find(v => v.lang.startsWith("en-GB") && (v.name.includes("Natural") || v.name.includes("Premium"))) ||
      voices.find(v => v.lang.startsWith("en"));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;

    utterance.onstart = () => setIsAiSpeaking(true);
    utterance.onend = () => setIsAiSpeaking(false);
    utterance.onerror = () => setIsAiSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  /* ── Send message to graph API ─────────────────────────────────── */
  async function sendToGraph(userInput: string) {
    setIsAgentLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphState: graphState,
          userInput: userInput,
          userCode: editorValue,
          timeRemainingSeconds: timerSeconds,
          // Initial-call fields (used when graphState is null)
          company,
          topic,
          excludeTopics,
          sessionId: sessionIdRef.current || "",
          duration,
        })
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const detail = typeof data?.detail === "string" ? ` ${data.detail}` : "";
        const retry = typeof data?.retryAfterSeconds === "number" ? ` Retry in ${data.retryAfterSeconds}s.` : "";
        const msg = typeof data?.error === "string" ? data.error : `Agent API error (${res.status})`;
        const combined = `${msg}.${detail}${retry}`.trim();
        setStatusText(combined);
        speak(combined);
        return;
      }

      // Update graph state
      if (data.graphState) {
        setGraphState(data.graphState);
      }

      // Update phase
      if (data.phase) {
        setCurrentPhase(data.phase);
        setStatusText(getPhaseStatusText(data.phase, data.aiStatusText));
      }

      // Update editor lock state
      if (typeof data.editorUnlocked === "boolean") {
        setUnlocked(data.editorUnlocked);
      }

      // Handle new question — only reset editor if it's genuinely a new question
      if (data.newQuestion) {
        const q = data.newQuestion;
        const isNewQuestion = !currentQuestion || q.title !== currentQuestion.title;
        setCurrentQuestion(q);

        if (isNewQuestion) {
          // Set up test cases from question examples
          if (q.examples && Array.isArray(q.examples)) {
            setTestCases(q.examples.map((ex: any) => ({
              input: String(ex.input ?? ""),
              expected: String(ex.output ?? ex.expected ?? ""),
              custom: false,
            })));
          } else {
            setTestCases([]);
          }

          // Setup editor value with header
          const header = `// -----------------------------------------------------\n// Company: ${company !== 'Generic' ? company : 'Any'}\n// Topic: ${topic}\n// Problem: ${q.title}\n// -----------------------------------------------------\n\n`;
          setEditorValue(`${header}class Solution {\npublic:\n    // Implement your solution here\n    \n};\n`);

          setCurrentTestIndex(0);
          setTestResults([]);
          setSubmissionStatus(null);
        }

        // Clear newQuestion from graphState so it doesn't re-trigger on next call
        if (data.graphState) {
          data.graphState.newQuestion = null;
        }
      }

      // Speak AI response (but NOT the question text)
      if (data.shouldSpeak && data.aiSpeechText) {
        speak(data.aiSpeechText);
      }

      // If interview ended
      if (data.phase === "end_interview" && data.graphState) {
        void requestInterviewFeedback(data.graphState as InterviewGraphState);
      }

    } catch (err) {
      console.error("Agent Error", err);
      setStatusText("Connection error. Please check your API key and try again.");
      speak("Connection error. Please check your API key and try again.");
    } finally {
      setIsAgentLoading(false);
    }
  }

  /* ── Session persistence ────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    endedRef.current = false;
    sessionIdRef.current = null;
    startedAtMsRef.current = Date.now();

    async function createSessionRow() {
      try {
        if (!supabase) return;

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!userRes.user) return;

        const stableId = getOrCreateStableSessionId(company, topic, duration);
        const startedAtIso = new Date().toISOString();
        sessionIdRef.current = stableId;

        const { data, error } = await supabase
          .from("interview_sessions")
          .upsert(
            {
              id: stableId,
              company,
              topic,
              exclude_topics: (excludeTopics ?? []).filter(Boolean),
              duration_minutes: duration,
              started_at: startedAtIso,
              ended_at: null,
              elapsed_seconds: 0,
              agent_score: 8,
            },
            { onConflict: "id" }
          )
          .select("id")
          .single();

        if (error) throw error;
        if (!cancelled) sessionIdRef.current = (data as any)?.id ?? stableId;
      } catch (e) {
        console.warn("Failed to create interview session row", e);
      }
    }

    createSessionRow();

    return () => {
      cancelled = true;
      void finishSessionRow({ force: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, topic, duration, excludeTopics]);

  /* ── Timer ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setTimerSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(t);
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    function onMove(e: any) {
      if (!draggingRef.current) return;
      const clientY = typeof e.clientY === 'number' ? e.clientY : (e.touches && e.touches[0]?.clientY) || 0;
      const dy = startYRef.current - clientY;
      const maxH = Math.max(120, (window.innerHeight || 800) - 120);
      const minH = 64;
      const newH = Math.max(minH, Math.min(maxH, startHeightRef.current + dy));
      setConsoleHeight(newH);
    }

    function onUp() {
      draggingRef.current = false;
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  useEffect(() => {
    setTimerSeconds(duration * 60);
  }, [duration]);

  async function finishSessionRow(opts?: { force?: boolean }) {
    try {
      if (endedRef.current) return;
      if (!supabase) return;
      const id = sessionIdRef.current;
      if (!id) return;

      const elapsed = Math.min(
        duration * 60,
        Math.max(0, Math.floor((Date.now() - startedAtMsRef.current) / 1000))
      );

      if (!opts?.force && elapsed < 3) return;

      endedRef.current = true;

      await supabase
        .from("interview_sessions")
        .update({
          ended_at: new Date().toISOString(),
          elapsed_seconds: elapsed,
          agent_score: 8,
        })
        .eq("id", id);

      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        }
      } catch {
        // ignore
      }
    } catch (e) {
      console.warn("Failed to finish interview session row", e);
    }
  }

  async function handleEndSession() {
    await finishSessionRow({ force: true });

    if (graphState && !feedbackRequestedRef.current) {
      try {
        await requestInterviewFeedback(graphState);
      } catch (e) {
        console.warn("Feedback generation failed during manual end", e);
      }
    }

    onEnd?.();
  }

  function formatTimer() {
    const hrs = Math.floor(timerSeconds / 3600);
    const mins = Math.floor((timerSeconds % 3600) / 60);
    const secs = timerSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /* ── Code execution ────────────────────────────────────────────── */
  async function runCode() {
    if (testCases && testCases.length > 0) {
      await runTests(false);
      return;
    }

    try {
      setIsRunning(true);
      const res = await fetch("/api/judge0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editorValue, language, stdin: customInput }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) {
        const errs = data?.errors ?? (data?.error ? [{ line: 0, column: 0, message: data.error }] : []);
        const formatted = errs.map((e: any) => `Line ${e.line}${e.column ? `:${e.column}` : ""} - ${e.message}`).join("\n");
        const fallback = data?.compileStderr ?? data?.stderr ?? data?.error ?? `Run failed (${res.status})`;
        setDiagnostics(errs ?? []);
        setConsoleOutput(formatted || fallback);
        setConsoleVisible(true);
        return;
      }

      const out = data.stdout ?? data.compileStderr ?? data.stderr ?? "Run completed.";
      setDiagnostics([]);
      setConsoleOutput(out);
      setConsoleVisible(true);
    } catch (e) {
      console.error(e);
      setConsoleOutput(`Error: ${String(e)}`);
      setConsoleVisible(true);
    } finally {
      setIsRunning(false);
    }
  }

  function normalizeOutput(s: string | undefined) {
    if (s == null) return "";
    return String(s).replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
  }

  async function runTests(useJudge: boolean) {
    setTestResults([]);
    const results: any[] = [];
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      try {
        const res = await fetch('/api/judge0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: editorValue, language, stdin: tc.input }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.ok === false) {
          const err = data?.error ?? data?.compileStderr ?? data?.stderr ?? `Run failed (${res.status})`;
          results.push({ input: tc.input, expected: tc.expected, output: undefined, passed: false, error: String(err) });
          setTestResults([...results]);
          continue;
        }

        const out = normalizeOutput(data.stdout ?? data.runStdout ?? data.compileStderr ?? data.stderr ?? "");
        const expect = normalizeOutput(tc.expected);
        const passed = out === expect;
        results.push({ input: tc.input, expected: tc.expected, output: out, passed, error: undefined });
        setTestResults([...results]);
      } catch (e) {
        results.push({ input: tc.input, expected: tc.expected, output: undefined, passed: false, error: String(e) });
        setTestResults([...results]);
      }
    }

    const passedCount = results.filter(r => r.passed).length;

    if (results.some(r => r.error)) {
      setSubmissionStatus("compile");
    } else if (passedCount === results.length) {
      setSubmissionStatus("accepted");
    } else {
      setSubmissionStatus("wrong");
    }

    setActiveBottomTab("result");

    const summary = `Tests: ${passedCount}/${results.length} passed`;
    const detail = results.map((r, idx) => `#${idx + 1} - ${r.passed ? 'PASS' : 'FAIL'} - expected: ${r.expected} got: ${r.output ?? r.error ?? ''}`).join("\n");
    setConsoleOutput(`${summary}\n\n${detail}`);
    setConsoleVisible(true);
  }

  async function runCase(useJudge: boolean) {
    const idx = currentTestIndex;
    if (idx < 0 || idx >= testCases.length) return;
    const tc = testCases[idx];
    try {
      const res = await fetch('/api/judge0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editorValue, language, stdin: tc.input }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) {
        const err = data?.error ?? data?.compileStderr ?? data?.stderr ?? `Run failed (${res.status})`;
        const r = { input: tc.input, expected: tc.expected, output: undefined, passed: false, error: String(err) };
        const next = [...testResults];
        while (next.length <= idx) next.push(undefined as any); next[idx] = r; setTestResults(next);

        setConsoleOutput(String(err)); setConsoleVisible(true);
        setActiveBottomTab("result");
        return;
      }
      const out = normalizeOutput(data.stdout ?? data.runStdout ?? data.compileStderr ?? data.stderr ?? '');
      const expect = normalizeOutput(tc.expected);
      const passed = out === expect;
      const r = { input: tc.input, expected: tc.expected, output: out, passed, error: undefined };
      const next = [...testResults]; next[idx] = r; setTestResults(next);
      setConsoleOutput(`${passed ? 'PASS' : 'FAIL'}\n\nExpected: ${tc.expected}\nGot: ${out}`);
      setConsoleVisible(true);
      setActiveBottomTab("result");
    } catch (e) {
      const r = { input: tc.input, expected: tc.expected, output: undefined, passed: false, error: String(e) };
      const next = [...testResults];
      while (next.length <= idx) next.push(undefined as any); next[idx] = r;

      setTestResults(next);
      setConsoleOutput(String(e)); setConsoleVisible(true);
      setActiveBottomTab("result");
    }
  }

  async function runWithJudge0() {
    if (testCases && testCases.length > 0) {
      await runTests(true);
      return;
    }

    try {
      setIsRunning(true);
      const res = await fetch('/api/judge0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editorValue, language, stdin: customInput }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) {
        const errs = data?.errors ?? (data?.error ? [{ line: 0, column: 0, message: data.error }] : []);
        const formatted = errs.map((e: any) => `Line ${e.line}${e.column ? `:${e.column}` : ""} - ${e.message}`).join("\n");
        const fallback = data?.compileStderr ?? data?.stderr ?? data?.error ?? `Run failed (${res.status})`;
        setDiagnostics(errs ?? []);
        setConsoleOutput(formatted || fallback);
        setConsoleVisible(true);
        return;
      }

      const out = data.stdout ?? data.compileStderr ?? data.stderr ?? "Run completed.";
      setDiagnostics([]);
      setConsoleOutput(out);
      setConsoleVisible(true);
    } catch (e) {
      console.error(e);
      setConsoleOutput(`Error: ${String(e)}`);
      setConsoleVisible(true);
    } finally {
      setIsRunning(false);
    }
  }

  async function submitSolution() {
    try {
      setIsRunning(true);
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editorValue, language, sessionId: sessionIdRef.current, stdin: customInput }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) {
        const errs = data?.errors ?? (data?.error ? [{ line: 0, column: 0, message: data.error }] : []);
        setDiagnostics(errs ?? []);
        const formatted = errs.map((e: any) => `Line ${e.line}${e.column ? `:${e.column}` : ""} - ${e.message}`).join("\n");
        const fallback = data?.compileStderr ?? data?.stderr ?? data?.error ?? `Submit failed (${res.status})`;
        setConsoleOutput(formatted || fallback);
        setConsoleVisible(true);
        return;
      }

      setDiagnostics([]);
      const success = data.result ?? data.details ?? "Submit successful (mock).";
      const out = data.stdout ?? data.compileStderr ?? data.stderr ?? "";
      setConsoleOutput(success + (out ? `\n${out}` : ""));
      setConsoleVisible(true);

      // After submission, tell the agent we're done
      await sendToGraph("I have submitted my solution. Please review it.");
    } catch (e) {
      console.error(e);
      setConsoleOutput(`Error: ${String(e)}`);
      setConsoleVisible(true);
    } finally {
      setIsRunning(false);
    }
  }

  /* ── Approach hint display ─────────────────────────────────────── */
  const approachEval = graphState?.approachEval;
  const approachAttempts = graphState?.approachAttempts ?? 0;
  const maxAttempts = graphState?.maxApproachAttempts ?? 3;

  return (
    <div className="h-screen flex overflow-hidden relative">
      {/* Eye Tracker & Warning */}
      {!showEyeWarning && (
        <EyeTracker onLookAway={() => setShowEyeWarning(true)} lookAwayThresholdMs={4000} />
      )}

      {showEyeWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 bg-red-900/40 border border-red-500/50 px-6 py-4 rounded-xl shadow-2xl shadow-red-500/20 backdrop-blur-md animate-enter">
          <svg className="w-6 h-6 text-red-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div>
            <h2 className="text-sm font-bold text-white">Attention Required</h2>
            <p className="text-xs text-slate-300">Please keep your eyes on the screen.</p>
          </div>
          <button onClick={() => setShowEyeWarning(false)} className="ml-4 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-full transition shadow-lg shadow-red-600/30">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[35%] flex flex-col border-r border-white/5 bg-slate-900/30">
          {/* AI Agent Panel — NO captions, just status indicator */}
          <div className="h-64 border-b border-white/5 p-6 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span></span>
                <span className="text-xs font-bold text-blue-400 tracking-wider">AI AGENT ACTIVE</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {currentPhase === "end_interview" ? "ENDED" : listening ? 'LISTENING' : isAiSpeaking ? 'SPEAKING' : isAgentLoading ? 'THINKING' : 'READY'}
              </span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
              <div id="voice-viz" className={`flex items-center gap-1 h-12 mb-4 ${listening || isAiSpeaking ? 'speaking' : ''}`}>
                <div className="wave-bar" style={{ animationDelay: '0.0s' }}></div>
                <div className="wave-bar" style={{ animationDelay: '0.1s' }}></div>
                <div className="wave-bar" style={{ animationDelay: '0.2s' }}></div>
                <div className="wave-bar" style={{ animationDelay: '0.3s' }}></div>
                <div className="wave-bar" style={{ animationDelay: '0.1s' }}></div>
              </div>

              {/* Phase status text — replaces old captions */}
              <p id="agent-status" className="text-center text-sm text-slate-300 font-medium leading-relaxed max-w-xs">
                {isAgentLoading ? "Thinking..." : statusText}
              </p>

              {/* Approach feedback indicator */}
              {currentPhase === "evaluate_approach" && approachEval && (
                <div className={`mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  approachEval.correct && approachEval.optimal
                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                    : approachEval.correct
                    ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                    : 'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                  {approachEval.correct && approachEval.optimal
                    ? '✓ Optimal approach!'
                    : approachEval.correct
                    ? '~ Correct but not optimal'
                    : '✗ Think again'
                  }
                </div>
              )}

              {interimTranscript && (
                <p className="mt-2 text-xs text-slate-400 italic font-mono text-center opacity-60">
                   Hearing: {interimTranscript}...
                </p>
              )}
            </div>

            <div className="mt-4 flex gap-2 justify-center">
              <button id="mic-btn" className={`w-10 h-10 rounded-full ${listening ? 'bg-red-600 animate-pulse' : 'bg-blue-600'} hover:bg-blue-500 flex items-center justify-center transition shadow-lg shadow-blue-500/20`} onClick={toggleListening} disabled={currentPhase === "end_interview"}>
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" /><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" /></svg>
              </button>
            </div>
          </div>

          {/* Question display area */}
          <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            <div className="mb-4 flex items-center gap-2">
              {company && company !== "Generic" && (
                <span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded">{company}</span>
              )}
              <span className="text-xs font-bold text-slate-400 ml-1">{topic}</span>
            </div>
            {(excludeTopics ?? []).length > 0 && (
              <div className="mb-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Excluding</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(excludeTopics ?? []).map((t) => (
                    <span key={t} className="px-2 py-1 rounded-md border border-white/10 bg-slate-900/40 text-xs text-slate-300">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {currentPhase === 'introduction' ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 animate-pulse bg-slate-800/20 rounded-xl border border-white/5 p-8 mt-12">
                <svg className="w-12 h-12 mb-4 text-blue-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                <p className="text-sm font-semibold text-slate-300">Preparing Your Interview...</p>
                <p className="text-xs mt-2 text-slate-500 text-center max-w-xs">Introduce yourself and the question will be presented after.</p>
              </div>
            ) : currentQuestion ? (
              <>
                <h2 className="text-xl font-bold mb-4">{currentQuestion.title}</h2>
                <div className="prose prose-invert prose-sm text-slate-300">
                  <div className="leetcode-html-content" dangerouslySetInnerHTML={{ __html: currentQuestion.prompt || currentQuestion.description }} />

                  {currentQuestion.examples && Array.isArray(currentQuestion.examples) && currentQuestion.examples.map((ex: any, i: number) => (
                    <div key={i} className="bg-slate-800/50 p-4 rounded-lg border border-white/5 my-4">
                      <p className="font-mono text-xs text-slate-400 mb-1">Example {i + 1}:</p>
                      <p className="font-mono text-sm mb-2">Input: {ex.input}</p>
                      <p className="font-mono text-sm">Output: {ex.output}</p>
                    </div>
                  ))}

                  {currentQuestion.constraints && (
                    <>
                      <p><strong>Constraints:</strong></p>
                      <div className="pl-4 space-y-1 font-mono text-xs">
                        {currentQuestion.constraints}
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <p>Waiting for interviewer to assign a question...</p>
              </div>
            )}
          </div>

          {/* Removed manual text input form per user request. Communication is now voice-first (STT). */}
        </aside>


        <main className="flex-1 flex flex-col bg-[#1e1e1e] relative">
          <div className="h-10 bg-[#1e1e1e] border-b border-[#333] flex items-center justify-between pl-4 pr-4 select-none">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-white">solution.cpp</div>
            </div>
            <div className="flex items-center gap-3">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-transparent text-xs text-slate-400 focus:outline-none border-none cursor-pointer">
                <option>C++ 17</option>
                <option>C++ 20</option>
                <option>Java</option>
                <option>Python 3</option>
              </select>
              <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1 rounded-full border border-white/5">
                <div className={`w-2 h-2 rounded-full ${listening ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></div>
                <span className="text-xs font-mono text-slate-300">{formatTimer()}</span>
              </div>
              <button
                className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1 rounded text-xs font-bold hover:bg-red-500/20 transition"
                onClick={handleEndSession}
              >
                End Session
              </button>
            </div>
          </div>
          {feedback && !showFeedbackModal && (
            <div className="px-4 py-3 border-t border-white/5 bg-slate-950/70 text-xs text-slate-300 flex items-center justify-between gap-3">
              <span>Final feedback is ready.</span>
              <button
                className="text-blue-300 hover:text-white font-semibold"
                onClick={() => setShowFeedbackModal(true)}
              >
                View feedback
              </button>
            </div>
          )}

          <div className="flex-1 relative pb-[340px]" style={{ minHeight: 0 }}>
            <div className="absolute inset-0 w-full h-full flex">
              <div ref={gutterRef} className="gutter" style={{ width: GUTTER_WIDTH }}>
                {(() => {
                  const lines = (editorValue || '').split('\n').length;
                  return Array.from({ length: lines }).map((_, i) => (
                    <div key={i} className="gutter-line">{i + 1}</div>
                  ));
                })()}
              </div>

              <div style={{ flex: 1, position: 'relative', paddingRight: 0 }}>
                <pre
                  ref={preRef as any}
                  aria-hidden
                  className="pointer-events-none whitespace-pre-wrap text-white font-mono p-6 m-0 h-full overflow-auto"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace', marginLeft: 0 }}
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      const esc = (s: string) => (s || "").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                      const lines = (editorValue || '').split('\n');
                      const diagByLine: Record<number, { column?: number; message: string }[]> = {};
                      for (const d of diagnostics || []) {
                        const ln = Math.max(1, Number(d.line) || 1);
                        diagByLine[ln] = diagByLine[ln] || [];
                        diagByLine[ln].push({ column: d.column, message: d.message });
                      }

                      const keywords = new Set((`abstract as assert break case catch class const continue default delete do else enum export extends false final finally for function goto if implements import in instanceof interface let new null package private protected public return super switch synchronized this throw throws transient true try typeof var void volatile while with yield await def`).split(/\s+/));
                      const builtins = new Set(["cout", "cin", "std", "printf", "println", "System", "out", "err", "len", "range"]);

                      function tokenizeLine(line: string) {
                        const tokens: { type: string; text: string; start: number; end: number }[] = [];
                        let i = 0;
                        const L = line.length;
                        while (i < L) {
                          const ch = line[i];
                          if (ch === '/' && i + 1 < L && line[i + 1] === '/') { tokens.push({ type: 'comment', text: line.slice(i), start: i, end: L }); break; }
                          if (ch === '/' && i + 1 < L && line[i + 1] === '*') { const end = line.indexOf('*/', i + 2); const e = end >= 0 ? end + 2 : L; tokens.push({ type: 'comment', text: line.slice(i, e), start: i, end: e }); i = e; continue; }
                          if (ch === '#') { tokens.push({ type: 'comment', text: line.slice(i), start: i, end: L }); break; }

                          if (ch === '"' || ch === '\'' || ch === '`') {
                            const quote = ch; let j = i + 1; let closed = false;
                            while (j < L) {
                              if (line[j] === '\\') { j += 2; continue; }
                              if (line[j] === quote) { j++; closed = true; break; }
                              j++;
                            }
                            tokens.push({ type: 'string', text: line.slice(i, j), start: i, end: j }); i = j; continue;
                          }

                          if (/[0-9]/.test(ch)) {
                            let j = i + 1; while (j < L && /[0-9\.xXabcdefABCDEF]/.test(line[j])) j++; tokens.push({ type: 'number', text: line.slice(i, j), start: i, end: j }); i = j; continue;
                          }

                          if (/[A-Za-z_]/.test(ch)) {
                            let j = i + 1; while (j < L && /[A-Za-z0-9_]/.test(line[j])) j++; const txt = line.slice(i, j); const t = keywords.has(txt) ? 'keyword' : (builtins.has(txt) ? 'builtin' : 'ident'); tokens.push({ type: t, text: txt, start: i, end: j }); i = j; continue;
                          }

                          if (/\s/.test(ch)) { let j = i + 1; while (j < L && /\s/.test(line[j])) j++; tokens.push({ type: 'whitespace', text: line.slice(i, j), start: i, end: j }); i = j; continue; }

                          tokens.push({ type: 'punct', text: ch, start: i, end: i + 1 }); i++;
                        }
                        return tokens;
                      }

                      return lines.map((lnText, i) => {
                        const ln = i + 1;
                        const diags = diagByLine[ln] || [];
                        const tokens = tokenizeLine(lnText);
                        let html = '';
                        for (let k = 0; k < tokens.length; k++) {
                          const tk = tokens[k];
                          const content = esc(tk.text);
                          let span = content;
                          if (tk.type === 'string') span = `<span class=\"tok-string\">${content}</span>`;
                          else if (tk.type === 'comment') span = `<span class=\"tok-comment\">${content}</span>`;
                          else if (tk.type === 'number') span = `<span class=\"tok-number\">${content}</span>`;
                          else if (tk.type === 'keyword') span = `<span class=\"tok-keyword\">${content}</span>`;
                          else if (tk.type === 'builtin') span = `<span class=\"tok-builtin\">${content}</span>`;
                          else if (tk.type === 'ident') span = `<span class=\"tok-ident\">${content}</span>`;
                          else if (tk.type === 'punct') span = `<span class=\"tok-punct\">${content}</span>`;
                          else span = content;
                          html += span;
                        }

                        if (diags.length === 0) return `<div>${html || ' '}</div>`;

                        let wrapped = html;
                        for (const d of diags) {
                          if (typeof d.column === 'number' && d.column > 0) {
                            const col = Math.max(1, Math.min(d.column, lnText.length + 1));
                            const pos = col - 1;
                            const tk = tokens.find(t => t.start <= pos && pos < t.end) || tokens[tokens.length - 1];
                            if (tk) {
                              const tokenHtml = (() => {
                                const raw = esc(tk.text);
                                if (tk.type === 'string') return `<span class=\"tok-string\">${raw}</span>`;
                                if (tk.type === 'comment') return `<span class=\"tok-comment\">${raw}</span>`;
                                if (tk.type === 'number') return `<span class=\"tok-number\">${raw}</span>`;
                                if (tk.type === 'keyword') return `<span class=\"tok-keyword\">${raw}</span>`;
                                if (tk.type === 'builtin') return `<span class=\"tok-builtin\">${raw}</span>`;
                                if (tk.type === 'ident') return `<span class=\"tok-ident\">${raw}</span>`;
                                if (tk.type === 'punct') return `<span class=\"tok-punct\">${raw}</span>`;
                                return raw;
                              })();
                              const wrappedTok = `<span class=\"error-underline\" title=\"${esc(d.message)}\">${tokenHtml}</span>`;
                              wrapped = `${esc(lnText.slice(0, tk.start))}${wrappedTok}${esc(lnText.slice(tk.end))}`;
                            }
                          } else {
                            wrapped = `<span class=\"error-underline\" title=\"${esc(diags.map(x => x.message).join('; '))}\">${html || ' '}</span>`;
                          }
                        }
                        return `<div>${wrapped}</div>`;
                      }).join('');
                    })()
                  }}
                />

                <textarea
                  ref={editorRef}
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  onScroll={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    if (preRef.current) {
                      (preRef.current as HTMLElement).scrollTop = target.scrollTop;
                      (preRef.current as HTMLElement).scrollLeft = target.scrollLeft;
                    }
                    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop;
                  }}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  className={`absolute inset-0 w-full h-full bg-transparent text-white caret-white font-mono p-6 resize-none ${unlocked ? '' : 'opacity-60 pointer-events-none'}`}
                  style={{ color: 'transparent', caretColor: 'white', whiteSpace: 'pre-wrap', overflow: 'auto' }}
                />
              </div>
            </div>

            <div className={`logic-lock-overlay ${unlocked ? 'hidden' : ''}`}>
              <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Editor Locked</h3>
              <p className="text-sm text-slate-400 max-w-xs text-center">
                {currentPhase === "introduction"
                  ? "Introduce yourself to the interviewer first."
                  : "Explain your approach to unlock the editor."}
              </p>
            </div>
          </div>

          {/* Bottom Panel */}
          <div className="absolute left-0 right-0 bottom-12 bg-[#1e1e1e] border-t border-[#333]">
            <div className="flex items-center gap-6 px-4 py-2 border-b border-[#333] text-sm">
              <button
                onClick={() => setActiveBottomTab("testcase")}
                className={`${activeBottomTab === "testcase" ? "text-green-400" : "text-slate-400"}`}
              >
                Testcase
              </button>
              <button
                onClick={() => setActiveBottomTab("result")}
                className={`${activeBottomTab === "result" ? "text-green-400" : "text-slate-400"}`}
              >
                Test Result
              </button>
            </div>

            <div className="p-4 max-h-[300px] overflow-auto">
              {activeBottomTab === "testcase" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-2">
                      {testCases.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentTestIndex(i)}
                          className={`px-3 py-1 text-xs rounded ${currentTestIndex === i ? "bg-slate-700 text-white" : "bg-slate-800 text-slate-400"}`}
                        >
                          Case {i + 1}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          const next = [...testCases, { input: "", expected: "", custom: true }];
                          setTestCases(next);
                          setCurrentTestIndex(next.length - 1);
                        }}
                        className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => runCase(false)} className="px-3 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600">Run Case</button>
                      <button onClick={() => runTests(false)} className="px-3 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600">Run All</button>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="text-xs text-slate-400 mb-1">Input</div>
                    {testCases[currentTestIndex]?.custom ? (
                      <textarea
                        value={testCases[currentTestIndex]?.input || ""}
                        onChange={(e) => {
                          const next = [...testCases];
                          next[currentTestIndex] = { ...(next[currentTestIndex]), input: e.target.value };
                          setTestCases(next);
                        }}
                        className="w-full bg-slate-800 p-2 text-xs text-white rounded resize-none"
                        rows={3}
                      />
                    ) : (
                      <div className="bg-slate-800 p-3 rounded text-sm">{testCases[currentTestIndex]?.input}</div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1">Expected</div>
                    {testCases[currentTestIndex]?.custom ? (
                      <textarea
                        value={testCases[currentTestIndex]?.expected || ""}
                        onChange={(e) => {
                          const next = [...testCases];
                          next[currentTestIndex] = { ...(next[currentTestIndex]), expected: e.target.value };
                          setTestCases(next);
                        }}
                        className="w-full bg-slate-800 p-2 text-xs text-white rounded resize-none"
                        rows={2}
                      />
                    ) : (
                      <div className="bg-slate-800 p-3 rounded text-sm">{testCases[currentTestIndex]?.expected}</div>
                    )}
                  </div>
                </div>
              )}

              {activeBottomTab === "result" && (
                <div>
                  {submissionStatus === "compile" && (<div className="text-red-400 font-semibold mb-3">Compile Error</div>)}
                  {submissionStatus === "wrong" && (<div className="text-red-400 font-semibold mb-3">Wrong Answer</div>)}
                  {submissionStatus === "accepted" && (<div className="text-green-400 font-semibold mb-3">Accepted</div>)}
                  <pre className="bg-slate-900 p-3 rounded text-xs whitespace-pre-wrap">{consoleOutput}</pre>
                </div>
              )}
            </div>
          </div>

          <style jsx>{`
            :global(.error-underline) {
              text-decoration-line: underline;
              text-decoration-style: solid;
              text-decoration-color: #ff4d4f;
              text-decoration-thickness: 2px;
            }
            :global(.tok-keyword) { color: #c792ea; font-weight: 600; }
            :global(.tok-string) { color: #8fbd5f; }
            :global(.tok-comment) { color: #6b7280; font-style: italic; }
            :global(.tok-number) { color: #f78c6c; }
            :global(.tok-builtin) { color: #4fd1fe; }
            :global(.tok-ident) { color: #e6edf3; }
            :global(.tok-punct) { color: #e2e8f0; }
            :global(.editor-area) pre, :global(.editor-area) textarea { line-height: 1.5; font-size: 13px; box-sizing: border-box; }
            pre { line-height: 1.5; }
            .gutter { background: rgba(2,6,23,0.6); color: #94a3b8; padding-top: 24px; overflow: auto; display: flex; flex-direction: column; align-items: flex-end; padding-right: 8px; }
            .gutter-line { line-height: 1.5; height: 1.5em; padding: 0 6px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace; }
          `}</style>

          {showCustomInput && (
            <div className="px-4 pb-2" style={{ background: '#1e1e1e', borderTop: '1px solid #333' }}>
              <div className="text-xs text-slate-400 mb-1">Custom Input (stdin)</div>
              <textarea
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Enter input passed to your program (stdin)..."
                className="w-full bg-slate-800 border border-white/5 rounded p-2 text-xs text-white resize-none"
                rows={4}
              />
            </div>
          )}

          <div className="h-12 bg-[#1e1e1e] border-t border-[#333] flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
            </div>
            <div className="flex items-center gap-3">
              <button onClick={runWithJudge0} disabled={isRunning} className="px-4 py-1.5 rounded text-xs font-semibold text-slate-300 hover:bg-white/5 border border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed">Run</button>
              <button onClick={submitSolution} disabled={isRunning} className="px-4 py-1.5 rounded text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition shadow-lg shadow-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed">Submit</button>
            </div>
          </div>
        </main>
      </div>
      {(showFeedbackModal || feedbackLoading) && (
        <FeedbackModal
          feedback={feedback}
          feedbackId={feedbackId}
          sessionId={sessionIdRef.current}
          isLoading={feedbackLoading}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}
    </div>
  );
}
