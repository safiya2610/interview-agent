"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { InterviewGraphState, InterviewPhase, DSAQuestion } from "../lib/graph-state";
import Editor, { useMonaco } from "@monaco-editor/react";

// ─── constants ────────────────────────────────────────────────────────────────

const ACTIVE_SESSION_STORAGE_KEY = "interview_agent_active_session_v1";
const LS_CODE_PREFIX = "ia_code_v1__";
const LS_HISTORY_PREFIX = "ia_history_v1__";

// ─── helpers ──────────────────────────────────────────────────────────────────

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
  } catch { /* ignore */ }
  const id = (globalThis as any)?.crypto?.randomUUID?.() ?? createUuidFallback();
  try {
    window.sessionStorage.setItem(
      ACTIVE_SESSION_STORAGE_KEY,
      JSON.stringify({ id, company, topic, duration, ts: Date.now() })
    );
  } catch { /* ignore */ }
  return id as string;
}

function lsGet(key: string): string | null {
  try { return typeof window !== "undefined" ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { if (typeof window !== "undefined") localStorage.setItem(key, val); } catch { /* ignore */ }
}
function lsGetJson<T>(key: string): T | null {
  const v = lsGet(key);
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

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

function getMonacoLanguage(lang: string) {
  const l = lang.toLowerCase();
  if (l.includes("c++") || l.includes("cpp")) return "cpp";
  if (l.includes("java")) return "java";
  if (l.includes("python")) return "python";
  return "cpp";
}

function getFilename(lang: string) {
  const l = lang.toLowerCase();
  if (l.includes("python")) return "solution.py";
  if (l.includes("java")) return "Solution.java";
  return "solution.cpp";
}

function getBoilerplate(lang: string, qTitle: string, company: string, topic: string) {
  const c = company !== "Generic" ? company : "Any";
  const hdr = `// Company: ${c} | Topic: ${topic} | Problem: ${qTitle}\n\n`;
  const l = lang.toLowerCase();
  if (l.includes("python")) {
    return `# Company: ${c} | Topic: ${topic} | Problem: ${qTitle}\nimport sys\ninput = sys.stdin.readline\n\ndef solve():\n    # Read input and implement your solution here\n    pass\n\nsolve()\n`;
  }
  if (l.includes("java")) {
    return `${hdr}import java.util.*;\nimport java.io.*;\n\npublic class Solution {\n    public static void main(String[] args) throws Exception {\n        Scanner sc = new Scanner(System.in);\n        // Implement your solution here\n    }\n}\n`;
  }
  return `${hdr}#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    \n    // Implement your solution here\n    \n    return 0;\n}\n`;
}

function normalizeOutput(s: string | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

function parseExamplesFromHtml(html: string): { input: string; output?: string; expected?: string }[] {
  if (!html) return [];
  const examples: { input: string; output: string }[] = [];
  const preRegex = /<pre[\s\S]*?>([\s\S]*?)<\/pre>/gi;
  let match;
  while ((match = preRegex.exec(html)) !== null) {
    const preContent = match[1];
    let text = preContent
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ");

    if (!/input:/i.test(text) || !/output:/i.test(text)) {
      continue;
    }

    const inputMatch = text.match(/input:\s*([\s\S]*?)(?=output:|$)/i);
    const outputMatch = text.match(/output:\s*([\s\S]*?)(?=explanation:|$)/i);

    if (inputMatch) {
      examples.push({
        input: inputMatch[1].trim(),
        output: outputMatch ? outputMatch[1].trim() : "",
      });
    }
  }
  return examples;
}

function formatLeetCodeInputToRaw(inputStr: string): string {
  const parts = inputStr.split(/,\s*(?=\w+\s*=)/);
  const resultParts: string[] = [];
  
  for (const part of parts) {
    const cleanPart = part.replace(/^\s*\w+\s*=\s*/, "").trim();
    
    if (cleanPart.startsWith("[[") && cleanPart.endsWith("]]")) {
      try {
        const arr2D = JSON.parse(cleanPart);
        if (Array.isArray(arr2D)) {
          const rows = arr2D.length;
          const cols = rows > 0 ? arr2D[0].length : 0;
          resultParts.push(`${rows} ${cols}`);
          for (const row of arr2D) {
            resultParts.push(row.join(" "));
          }
          continue;
        }
      } catch { /* ignore */ }
    }
    
    if (cleanPart.startsWith("[") && cleanPart.endsWith("]")) {
      try {
        const arr = JSON.parse(cleanPart);
        if (Array.isArray(arr)) {
          resultParts.push(`${arr.length}`);
          resultParts.push(arr.join(" "));
          continue;
        }
      } catch { /* ignore */ }
    }
    
    if ((cleanPart.startsWith('"') && cleanPart.endsWith('"')) || (cleanPart.startsWith("'") && cleanPart.endsWith("'"))) {
      resultParts.push(cleanPart.slice(1, -1));
      continue;
    }
    
    resultParts.push(cleanPart);
  }
  
  return resultParts.join("\n");
}

function formatLeetCodeOutputToRaw(outputStr: string): string {
  let clean = outputStr.trim();
  if (clean.startsWith("[") && clean.endsWith("]")) {
    try {
      const arr = JSON.parse(clean);
      if (Array.isArray(arr) && !arr.some(Array.isArray)) {
        return arr.join(" ");
      }
    } catch { /* ignore */ }
  }
  return clean;
}

function formatTime(sec: string | undefined): string {
  if (!sec) return "";
  const ms = Math.round(parseFloat(sec) * 1000);
  return `${ms} ms`;
}
function formatMemory(kb: number | undefined): string {
  if (!kb) return "";
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// ─── types ────────────────────────────────────────────────────────────────────

type Verdict = "accepted" | "wrong" | "compile_error" | "runtime_error" | "tle" | "mle" | "internal_error";

interface TestCase {
  input: string;
  expected: string;
  label?: string;
  custom?: boolean;
}

interface TestResult {
  input: string;
  expected: string;
  output?: string;
  passed: boolean;
  error?: string;
  verdict?: Verdict;
  time?: string;
  memory?: number;
}

interface SubmissionRecord {
  id: string;
  timestamp: number;
  language: string;
  verdict: Verdict | null;
  passedCount: number;
  totalCount: number;
  time?: string;
  memory?: number;
  code: string;
}

type BottomTab = "testcase" | "result" | "custom_input";
type LeftTab = "problem" | "submissions";

interface Props {
  company: string;
  topic: string;
  duration: number;
  excludeTopics?: string[];
  onEnd?: () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function EditorWorkspace({ company, topic, duration, excludeTopics, onEnd }: Props) {
  // ── AI / interview state ──────────────────────────────────────────────
  const [unlocked, setUnlocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(duration * 60);
  const [graphState, setGraphState] = useState<InterviewGraphState | null>(null);
  const [currentPhase, setCurrentPhase] = useState<InterviewPhase>("introduction");
  const [statusText, setStatusText] = useState("Connecting to session...");
  const [currentQuestion, setCurrentQuestion] = useState<DSAQuestion | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  // ── editor state ──────────────────────────────────────────────────────
  const [language, setLanguage] = useState("C++ 17");
  const [editorValue, setEditorValue] = useState("// Implement your solution here\n");
  const monacoRef = useRef<any>(null);  // monaco instance
  const editorInstanceRef = useRef<any>(null); // editor instance

  // ── test / run state ──────────────────────────────────────────────────
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [currentTestIndex, setCurrentTestIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>("testcase");
  const [consoleVisible, setConsoleVisible] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(260);
  const [submissionStatus, setSubmissionStatus] = useState<Verdict | null>(null);
  const [lastRunTime, setLastRunTime] = useState<string | undefined>();
  const [lastRunMemory, setLastRunMemory] = useState<number | undefined>();

  // ── custom input ──────────────────────────────────────────────────────
  const [customStdin, setCustomStdin] = useState("");

  // ── submission history ────────────────────────────────────────────────
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab>("problem");

  // ── layout ────────────────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(38);
  const horizDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // ── refs ──────────────────────────────────────────────────────────────
  const sessionIdRef = useRef<string | null>(null);
  const startedAtMsRef = useRef<number>(Date.now());
  const endedRef = useRef(false);
  const startedInterviewKeyRef = useRef<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const recognitionRef = useRef<any>(null);
  const accumulatedTranscriptRef = useRef<string>("");
  const pendingSendRef = useRef(false);
  const sendToGraphRef = useRef<(input: string) => void>(() => {});

  const monaco = useMonaco();

  // ── derived ───────────────────────────────────────────────────────────
  const excludeKey = (excludeTopics ?? []).filter(Boolean).join(",");
  const interviewKey = `${company}__${topic}__${duration}__${excludeKey}`;
  const questionKey = currentQuestion?.title ? `${LS_CODE_PREFIX}${currentQuestion.title}__${language}` : null;
  const historyKey = currentQuestion?.title ? `${LS_HISTORY_PREFIX}${currentQuestion.title}` : null;

  // ─────────────────────────────────────────────────────────────────────
  // Monaco diagnostics / markers
  // ─────────────────────────────────────────────────────────────────────

  const setMonacoMarkers = useCallback((diagnostics: { line: number; column?: number; message: string }[]) => {
    if (!monacoRef.current || !editorInstanceRef.current) return;
    const model = editorInstanceRef.current.getModel();
    if (!model) return;
    const markers = diagnostics.map((d) => ({
      severity: monacoRef.current.MarkerSeverity.Error,
      startLineNumber: Math.max(1, d.line),
      endLineNumber: Math.max(1, d.line),
      startColumn: d.column ?? 1,
      endColumn: d.column ? d.column + 1 : 1000,
      message: d.message,
      source: "Judge0",
    }));
    monacoRef.current.editor.setModelMarkers(model, "judge0", markers);
  }, []);

  const clearMonacoMarkers = useCallback(() => {
    if (!monacoRef.current || !editorInstanceRef.current) return;
    const model = editorInstanceRef.current.getModel();
    if (!model) return;
    monacoRef.current.editor.setModelMarkers(model, "judge0", []);
  }, []);

  // Parse GCC/Clang/Python/Java compile errors into Monaco markers
  function parseCompileErrors(stderr: string, lang: string): { line: number; column?: number; message: string }[] {
    const out: { line: number; column?: number; message: string }[] = [];
    const lines = stderr.split(/\r?\n/);
    if (lang.toLowerCase().includes("python")) {
      // Python: "  File "...", line N"
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/File ".*?", line (\d+)/);
        if (m) {
          out.push({ line: Number(m[1]), message: lines[i + 1]?.trim() || lines[lines.length - 1]?.trim() || stderr.trim() });
        }
      }
    } else {
      // GCC/Clang: "file.cpp:line:col: error: message"
      for (const l of lines) {
        const m = l.match(/^.*?:(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/);
        if (m) {
          out.push({ line: Number(m[1]), column: Number(m[2]), message: `${m[3]}: ${m[4]}` });
        }
      }
      // Java: "file.java:line: error: message"
      if (out.length === 0) {
        for (const l of lines) {
          const m = l.match(/^.*?:(\d+):\s+(error|warning):\s+(.*)$/);
          if (m) out.push({ line: Number(m[1]), message: `${m[2]}: ${m[3]}` });
        }
      }
    }
    if (out.length === 0 && stderr.trim()) {
      out.push({ line: 1, message: stderr.trim() });
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────
  // localStorage persistence
  // ─────────────────────────────────────────────────────────────────────

  // Save code whenever editorValue changes
  useEffect(() => {
    if (questionKey) lsSet(questionKey, editorValue);
  }, [editorValue, questionKey]);

  // Load code, history, and test cases when currentQuestion changes
  useEffect(() => {
    if (!currentQuestion) {
      setTestCases([]);
      setTestResults([]);
      setSubmissionStatus(null);
      setLastRunTime(undefined);
      setLastRunMemory(undefined);
      setSubmissions([]);
      return;
    }

    const q = currentQuestion;

    // 1. Populate test cases from examples
    let examples = q.examples ?? [];
    if (examples.length === 0 && q.prompt) {
      examples = parseExamplesFromHtml(q.prompt);
    }

    let cases: TestCase[] = examples.map((ex: any, i: number) => ({
      input: formatLeetCodeInputToRaw(String(ex.input ?? "")),
      expected: formatLeetCodeOutputToRaw(String(ex.output ?? ex.expected ?? "")),
      label: `Example ${i + 1}`,
      custom: false,
    }));

    if (cases.length === 0) {
      cases = [{
        input: "",
        expected: "",
        label: "Case 1",
        custom: true,
      }];
    }

    setTestCases(cases);
    setCurrentTestIndex(0);
    setTestResults([]);
    setSubmissionStatus(null);
    setLastRunTime(undefined);
    setLastRunMemory(undefined);

    // 2. Restore saved code or use fresh boilerplate
    const qKey = `${LS_CODE_PREFIX}${q.title}__${language}`;
    const savedCode = lsGet(qKey);
    setEditorValue(savedCode || getBoilerplate(language, q.title, company, topic));

    // 3. Load submission history
    const hKey = `${LS_HISTORY_PREFIX}${q.title}`;
    const savedHistory = lsGetJson<SubmissionRecord[]>(hKey);
    setSubmissions(savedHistory || []);

    // 4. Switch to testcase tab and open console so user sees them immediately
    setActiveBottomTab("testcase");
    setConsoleVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion]);

  // ─────────────────────────────────────────────────────────────────────
  // Keyboard shortcuts
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        if (unlocked && !isRunning) handleSubmit();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        if (unlocked && !isRunning) handleRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, isRunning, editorValue, testCases, language, customStdin]);

  // ─────────────────────────────────────────────────────────────────────
  // Interview initialisation
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (startedInterviewKeyRef.current === interviewKey) return;
    startedInterviewKeyRef.current = interviewKey;
    setUnlocked(false);
    setGraphState(null);
    setCurrentPhase("introduction");
    setCurrentQuestion(null);
    setTestCases([]);
    setTestResults([]);
    setSubmissionStatus(null);
    setStatusText("Connecting to session...");
    void sendToGraph("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewKey]);

  // ─────────────────────────────────────────────────────────────────────
  // Speech Recognition
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event: any) => {
      let finalT = "";
      let interimT = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalT += event.results[i][0].transcript;
        else interimT += event.results[i][0].transcript;
      }
      if (finalT) accumulatedTranscriptRef.current += " " + finalT;
      setInterimTranscript(interimT);
    };
    recognition.onend = () => {
      setListening(false);
      if (pendingSendRef.current) {
        pendingSendRef.current = false;
        const msg = accumulatedTranscriptRef.current.trim();
        if (msg) sendToGraphRef.current(msg);
        accumulatedTranscriptRef.current = "";
        setInterimTranscript("");
      }
    };
    recognition.onerror = () => {
      setListening(false);
      pendingSendRef.current = false;
    };
    recognitionRef.current = recognition;
  }, []);

  sendToGraphRef.current = sendToGraph;

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported. Please use Chrome or Edge.");
      return;
    }
    if (listening) {
      pendingSendRef.current = true;
      recognitionRef.current.stop();
    } else {
      accumulatedTranscriptRef.current = "";
      setInterimTranscript("");
      pendingSendRef.current = false;
      setListening(true);
      recognitionRef.current.start();
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // TTS
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const speak = (text: string, retry = 0) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsAiSpeaking(false);
    const clean = text.replace(/\*\*/g, "").replace(/#/g, "").replace(/`/g, "").replace(/\[.*?\]/g, "").trim();
    if (!clean) return;
    if (voicesRef.current.length === 0 && retry < 5) { setTimeout(() => speak(text, retry + 1), 200); return; }
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = "en-IN";
    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices();
    utt.voice =
      voices.find((v) => v.lang.startsWith("en-IN") && (v.name.includes("Natural") || v.name.includes("Premium"))) ||
      voices.find((v) => v.lang.startsWith("en-IN") && v.name.includes("Google")) ||
      voices.find((v) => v.lang.startsWith("en-IN")) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      null;
    utt.rate = 0.95; utt.pitch = 1.05; utt.volume = 1.0;
    utt.onstart = () => setIsAiSpeaking(true);
    utt.onend = () => setIsAiSpeaking(false);
    utt.onerror = () => setIsAiSpeaking(false);
    window.speechSynthesis.speak(utt);
  };

  // ─────────────────────────────────────────────────────────────────────
  // Graph API
  // ─────────────────────────────────────────────────────────────────────

  async function sendToGraph(userInput: string) {
    setIsAgentLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          graphState,
          userInput,
          userCode: editorValue,
          timeRemainingSeconds: timerSeconds,
          company, topic, excludeTopics,
          sessionId: sessionIdRef.current || "",
          duration,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const detail = typeof data?.detail === "string" ? ` ${data.detail}` : "";
        const retry = typeof data?.retryAfterSeconds === "number" ? ` Retry in ${data.retryAfterSeconds}s.` : "";
        const msg = typeof data?.error === "string" ? data.error : `Agent error (${res.status})`;
        setStatusText(`${msg}.${detail}${retry}`.trim());
        speak(`${msg}.${detail}${retry}`.trim());
        return;
      }
      if (data.graphState) setGraphState(data.graphState);
      if (data.phase) {
        setCurrentPhase(data.phase);
        setStatusText(getPhaseStatusText(data.phase, data.aiStatusText));
      }
      if (typeof data.editorUnlocked === "boolean") setUnlocked(data.editorUnlocked);

      // ── NEW QUESTION ──────────────────────────────────────────────
      if (data.newQuestion) {
        setCurrentQuestion(data.newQuestion);
        if (data.graphState) data.graphState.newQuestion = null;
      } else if (data.graphState?.currentQuestion && !currentQuestion) {
        setCurrentQuestion(data.graphState.currentQuestion);
      }

      if (data.shouldSpeak && data.aiSpeechText) speak(data.aiSpeechText);
      if (data.phase === "end_interview") setTimeout(() => handleEndSession(), 10000);
    } catch (err) {
      console.error("Agent Error", err);
      setStatusText("Connection error. Please check your API key and try again.");
      speak("Connection error. Please check your API key and try again.");
    } finally {
      setIsAgentLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Session persistence
  // ─────────────────────────────────────────────────────────────────────

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
        sessionIdRef.current = stableId;
        const { data, error } = await supabase
          .from("interview_sessions")
          .upsert({ id: stableId, company, topic, exclude_topics: (excludeTopics ?? []).filter(Boolean), duration_minutes: duration, started_at: new Date().toISOString(), ended_at: null, elapsed_seconds: 0, agent_score: 8 }, { onConflict: "id" })
          .select("id").single();
        if (error) throw error;
        if (!cancelled) sessionIdRef.current = (data as any)?.id ?? stableId;
      } catch (e) { console.warn("Failed to create session row", e); }
    }
    createSessionRow();
    return () => { cancelled = true; void finishSessionRow({ force: false }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, topic, duration, excludeTopics]);

  // Timer
  useEffect(() => {
    const t = setInterval(() => setTimerSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => { clearInterval(t); if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); };
  }, []);

  useEffect(() => { setTimerSeconds(duration * 60); }, [duration]);

  // Drag handlers
  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      const clientX = "clientX" in e ? e.clientX : e.touches[0]?.clientX ?? 0;
      const clientY = "clientY" in e ? e.clientY : e.touches[0]?.clientY ?? 0;
      if (horizDraggingRef.current) {
        const dx = clientX - startXRef.current;
        const newW = Math.max(22, Math.min(78, startWidthRef.current + (dx / window.innerWidth) * 100));
        setLeftWidth(newW);
      }
      if (draggingRef.current) {
        const dy = startYRef.current - clientY;
        const newH = Math.max(80, Math.min(window.innerHeight - 160, startHeightRef.current + dy));
        setConsoleHeight(newH);
      }
    }
    function onUp() { horizDraggingRef.current = false; draggingRef.current = false; }
    window.addEventListener("mousemove", onMove as any);
    window.addEventListener("touchmove", onMove as any, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove as any);
      window.removeEventListener("touchmove", onMove as any);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  async function finishSessionRow(opts?: { force?: boolean }) {
    try {
      if (endedRef.current || !supabase) return;
      const id = sessionIdRef.current;
      if (!id) return;
      const elapsed = Math.min(duration * 60, Math.max(0, Math.floor((Date.now() - startedAtMsRef.current) / 1000)));
      if (!opts?.force && elapsed < 3) return;
      endedRef.current = true;
      await supabase.from("interview_sessions").update({ ended_at: new Date().toISOString(), elapsed_seconds: elapsed, agent_score: 8 }).eq("id", id);
      try { if (typeof window !== "undefined") window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY); } catch { /* ignore */ }
    } catch (e) { console.warn("Failed to finish session row", e); }
  }

  async function handleEndSession() {
    await finishSessionRow({ force: true });
    onEnd?.();
  }

  function formatTimer() {
    const h = Math.floor(timerSeconds / 3600);
    const m = Math.floor((timerSeconds % 3600) / 60);
    const s = timerSeconds % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Code execution helpers
  // ─────────────────────────────────────────────────────────────────────

  async function callJudge(code: string, lang: string, stdin: string): Promise<any> {
    const res = await fetch("/api/judge0", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language: lang, stdin }),
    });
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  }

  function handleJudgeError(data: any, lang: string): { error: string; diagnostics: any[] } {
    // Compile error: surface compile_output / compileStderr
    const compileText = data?.compileStderr ?? data?.error ?? "";
    const diagnostics = compileText ? parseCompileErrors(compileText, lang) : (data?.diagnostics ?? []);
    if (diagnostics.length > 0) setMonacoMarkers(diagnostics);
    const displayErr = compileText || data?.stderr || data?.error || "Execution failed";
    return { error: displayErr, diagnostics };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Run Handlers
  // ─────────────────────────────────────────────────────────────────────

  async function handleRun() {
    if (isRunning) return;
    clearMonacoMarkers();
    setIsRunning(true);
    setTestResults([]);
    setSubmissionStatus(null);
    setActiveBottomTab("result");
    setConsoleVisible(true);

    // If in custom input mode, run only against customStdin
    if (activeBottomTab === "custom_input") {
      try {
        const data = await callJudge(editorValue, language, customStdin);
        if (!data.ok || data.verdict === "compile_error" || data.verdict === "runtime_error") {
          handleJudgeError(data, language);
          setSubmissionStatus(data.verdict ?? "runtime_error");
          setTestResults([{ input: customStdin, expected: "", output: data.stdout ?? "", passed: false, error: data.compileStderr ?? data.stderr ?? data.error, verdict: data.verdict, time: data.time, memory: data.memory }]);
        } else {
          clearMonacoMarkers();
          setTestResults([{ input: customStdin, expected: "", output: data.stdout ?? "", passed: true, verdict: "accepted", time: data.time, memory: data.memory }]);
          setSubmissionStatus("accepted");
        }
      } finally { setIsRunning(false); }
      return;
    }

    // Run all test cases
    if (testCases.length === 0) { setIsRunning(false); return; }

    const results: TestResult[] = [];
    let anyError = false;
    let allPassed = true;
    let worstVerdict: Verdict = "accepted";

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      try {
        const data = await callJudge(editorValue, language, tc.input);
        const verdict: Verdict = data.verdict ?? (data.ok ? "accepted" : "runtime_error");

        if (!data.ok || verdict === "compile_error" || verdict === "runtime_error" || verdict === "tle") {
          anyError = true;
          allPassed = false;
          worstVerdict = verdict;
          const { error } = handleJudgeError(data, language);
          results.push({ input: tc.input, expected: tc.expected, output: data.stdout, passed: false, error, verdict, time: data.time, memory: data.memory });
          // If compile error, no point running more cases
          if (verdict === "compile_error") {
            // Fill remaining as compile errors too
            for (let j = i + 1; j < testCases.length; j++) {
              results.push({ input: testCases[j].input, expected: testCases[j].expected, output: undefined, passed: false, error: "Compilation Error", verdict: "compile_error" });
            }
            break;
          }
        } else {
          const out = normalizeOutput(data.stdout ?? "");
          const expected = normalizeOutput(tc.expected);
          const passed = out === expected || tc.expected === ""; // if no expected, don't fail
          if (!passed) { allPassed = false; if (worstVerdict === "accepted") worstVerdict = "wrong"; }
          results.push({ input: tc.input, expected: tc.expected, output: out, passed, verdict: passed ? "accepted" : "wrong", time: data.time, memory: data.memory });
        }
        setTestResults([...results]);
      } catch (e) {
        anyError = true; allPassed = false; worstVerdict = "runtime_error";
        results.push({ input: tc.input, expected: tc.expected, output: undefined, passed: false, error: String(e), verdict: "runtime_error" });
        setTestResults([...results]);
      }
    }

    // Summary verdict
    const finalVerdict: Verdict = anyError ? worstVerdict : (allPassed ? "accepted" : "wrong");
    setSubmissionStatus(finalVerdict);
    if (!anyError) clearMonacoMarkers();

    // Time/memory from first result
    setLastRunTime(results[0]?.time);
    setLastRunMemory(results[0]?.memory);
    setIsRunning(false);
  }

  async function handleRunSingleCase(idx: number) {
    if (isRunning || idx < 0 || idx >= testCases.length) return;
    clearMonacoMarkers();
    setIsRunning(true);
    setActiveBottomTab("result");
    setConsoleVisible(true);
    const tc = testCases[idx];
    try {
      const data = await callJudge(editorValue, language, tc.input);
      const verdict: Verdict = data.verdict ?? (data.ok ? "accepted" : "runtime_error");
      if (!data.ok || verdict === "compile_error" || verdict === "runtime_error") {
        const { error } = handleJudgeError(data, language);
        const next = [...testResults];
        while (next.length <= idx) next.push({ input: "", expected: "", passed: false });
        next[idx] = { input: tc.input, expected: tc.expected, output: data.stdout, passed: false, error, verdict, time: data.time, memory: data.memory };
        setTestResults(next);
        setSubmissionStatus(verdict);
      } else {
        const out = normalizeOutput(data.stdout ?? "");
        const expected = normalizeOutput(tc.expected);
        const passed = out === expected || tc.expected === "";
        const next = [...testResults];
        while (next.length <= idx) next.push({ input: "", expected: "", passed: false });
        next[idx] = { input: tc.input, expected: tc.expected, output: out, passed, verdict: passed ? "accepted" : "wrong", time: data.time, memory: data.memory };
        setTestResults(next);
        setSubmissionStatus(passed ? "accepted" : "wrong");
        if (passed) clearMonacoMarkers();
      }
    } catch (e) {
      const next = [...testResults];
      while (next.length <= idx) next.push({ input: "", expected: "", passed: false });
      next[idx] = { input: tc.input, expected: tc.expected, passed: false, error: String(e), verdict: "runtime_error" };
      setTestResults(next);
      setSubmissionStatus("runtime_error");
    } finally { setIsRunning(false); }
  }

  async function handleSubmit() {
    if (isRunning) return;
    if (testCases.length === 0) {
      alert("No test cases available to submit.");
      return;
    }
    clearMonacoMarkers();
    setIsRunning(true);
    setTestResults([]);
    setSubmissionStatus(null);
    setActiveBottomTab("result");
    setConsoleVisible(true);
    const results: TestResult[] = [];
    let allPassed = true;
    let worstVerdict: Verdict = "accepted";

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      try {
        const data = await callJudge(editorValue, language, tc.input);
        const verdict: Verdict = data.verdict ?? (data.ok ? "accepted" : "runtime_error");
        if (!data.ok || verdict === "compile_error" || verdict === "runtime_error" || verdict === "tle") {
          allPassed = false; worstVerdict = verdict;
          const { error } = handleJudgeError(data, language);
          results.push({ input: tc.input, expected: tc.expected, output: data.stdout, passed: false, error, verdict, time: data.time, memory: data.memory });
          if (verdict === "compile_error") {
            for (let j = i + 1; j < testCases.length; j++) results.push({ input: testCases[j].input, expected: testCases[j].expected, passed: false, error: "Compilation Error", verdict: "compile_error" });
            break;
          }
        } else {
          const out = normalizeOutput(data.stdout ?? "");
          const expected = normalizeOutput(tc.expected);
          const passed = out === expected || tc.expected === "";
          if (!passed) { allPassed = false; if (worstVerdict === "accepted") worstVerdict = "wrong"; }
          results.push({ input: tc.input, expected: tc.expected, output: out, passed, verdict: passed ? "accepted" : "wrong", time: data.time, memory: data.memory });
        }
        setTestResults([...results]);
      } catch (e) {
        allPassed = false; worstVerdict = "runtime_error";
        results.push({ input: tc.input, expected: tc.expected, passed: false, error: String(e), verdict: "runtime_error" });
        setTestResults([...results]);
      }
    }

    const finalVerdict: Verdict = allPassed ? "accepted" : worstVerdict;
    setSubmissionStatus(finalVerdict);
    if (allPassed) clearMonacoMarkers();

    const passedCount = results.filter((r) => r.passed).length;
    const avgTime = results[0]?.time;
    const avgMem = results[0]?.memory;
    setLastRunTime(avgTime);
    setLastRunMemory(avgMem);

    // Save submission
    const record: SubmissionRecord = {
      id: createUuidFallback(),
      timestamp: Date.now(),
      language,
      verdict: finalVerdict,
      passedCount,
      totalCount: results.length,
      time: avgTime,
      memory: avgMem,
      code: editorValue,
    };
    const newHistory = [record, ...submissions].slice(0, 20);
    setSubmissions(newHistory);
    if (historyKey) lsSet(historyKey, JSON.stringify(newHistory));

    // Notify agent
    try {
      if (allPassed) {
        await sendToGraph("I have submitted my solution. All test cases passed successfully!");
      } else {
        await sendToGraph(`I have submitted my solution, but some test cases failed with verdict: ${verdictLabel(finalVerdict)}.`);
      }
    } catch { /* ignore */ }
    setIsRunning(false);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Verdict display helpers
  // ─────────────────────────────────────────────────────────────────────

  function verdictLabel(v: Verdict | null): string {
    switch (v) {
      case "accepted": return "Accepted";
      case "wrong": return "Wrong Answer";
      case "compile_error": return "Compilation Error";
      case "runtime_error": return "Runtime Error";
      case "tle": return "Time Limit Exceeded";
      case "mle": return "Memory Limit Exceeded";
      case "internal_error": return "Internal Error";
      default: return "";
    }
  }

  function verdictColor(v: Verdict | null): string {
    switch (v) {
      case "accepted": return "text-[#00b8a3]";
      case "wrong": return "text-[#ef4743]";
      case "compile_error": return "text-[#ff9500]";
      case "runtime_error": return "text-[#ef4743]";
      case "tle": return "text-[#ef4743]";
      case "mle": return "text-[#ef4743]";
      case "internal_error": return "text-slate-400";
      default: return "text-slate-400";
    }
  }

  function verdictBg(v: Verdict | null): string {
    switch (v) {
      case "accepted": return "bg-[#00b8a3]/8 border-[#00b8a3]/25";
      case "compile_error": return "bg-[#ff9500]/8 border-[#ff9500]/25";
      default: return "bg-[#ef4743]/8 border-[#ef4743]/25";
    }
  }

  function verdictIcon(v: Verdict | null) {
    if (v === "accepted") return (
      <svg className="w-5 h-5 text-[#00b8a3] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
    if (v === "compile_error") return (
      <svg className="w-5 h-5 text-[#ff9500] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    );
    return (
      <svg className="w-5 h-5 text-[#ef4743] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Language change
  // ─────────────────────────────────────────────────────────────────────

  function handleLanguageChange(newLang: string) {
    setLanguage(newLang);
    clearMonacoMarkers();
    if (currentQuestion) {
      const saved = lsGet(`${LS_CODE_PREFIX}${currentQuestion.title}__${newLang}`);
      setEditorValue(saved || getBoilerplate(newLang, currentQuestion.title, company, topic));
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Approach eval
  // ─────────────────────────────────────────────────────────────────────

  const approachEval = graphState?.approachEval;

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div
      className="h-screen w-screen flex flex-col bg-[#1a1a1a] text-slate-200 overflow-hidden select-none"
      style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
    >
      {/* ── TOP HEADER ────────────────────────────────────────────────── */}
      <header className="h-11 bg-[#1a1a1a] border-b border-[#2d2d2d] flex items-center justify-between px-4 shrink-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-[#FFA116] rounded-md flex items-center justify-center font-bold text-black text-sm">C</div>
          <span className="text-sm font-semibold text-white tracking-tight">
            Codent<span className="text-[#FFA116]">AI</span>
            {currentQuestion && <span className="ml-2 text-slate-400 font-normal">— {currentQuestion.title}</span>}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* timer */}
          <div className="flex items-center gap-2 bg-[#252525] px-3 py-1.5 rounded-full border border-[#3a3a3a]">
            <div className={`w-1.5 h-1.5 rounded-full ${listening ? "bg-green-400 animate-pulse" : timerSeconds < 300 ? "bg-red-400 animate-pulse" : "bg-slate-500"}`} />
            <span className={`text-xs font-mono font-semibold ${timerSeconds < 300 ? "text-red-400" : "text-slate-200"}`}>{formatTimer()}</span>
          </div>

          {/* keyboard hints */}
          <div className="hidden lg:flex items-center gap-1 text-[10px] text-slate-600">
            <kbd className="bg-[#2a2a2a] border border-[#3a3a3a] px-1.5 py-0.5 rounded text-slate-500">Ctrl+Enter</kbd>
            <span>Run</span>
            <span className="mx-1">·</span>
            <kbd className="bg-[#2a2a2a] border border-[#3a3a3a] px-1.5 py-0.5 rounded text-slate-500">Ctrl+⇧+Enter</kbd>
            <span>Submit</span>
          </div>

          <button
            className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-500/20 transition cursor-pointer"
            onClick={handleEndSession}
          >
            End Session
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── LEFT PANEL: AI + Problem ────────────────────────────────── */}
        <aside
          className="flex flex-col border-r border-[#2d2d2d] bg-[#1a1a1a] min-w-[280px] shrink-0"
          style={{ width: `${leftWidth}%` }}
        >
          {/* AI Widget */}
          <div className="p-4 border-b border-[#2d2d2d] bg-[#1e1e1e] flex flex-col relative overflow-hidden shrink-0">
            <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

            <div className="flex items-center justify-between mb-3 z-10">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                </span>
                <span className="text-[10px] font-bold text-blue-400 tracking-widest">AI INTERVIEWER</span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono bg-[#2d2d2d] px-1.5 py-0.5 rounded">
                {currentPhase === "end_interview" ? "ENDED" : listening ? "LISTENING" : isAiSpeaking ? "SPEAKING" : isAgentLoading ? "THINKING" : "READY"}
              </span>
            </div>

            {/* Wave visualizer */}
            <div id="voice-viz" className={`flex items-center justify-center gap-1 h-9 mb-2.5 z-10 ${listening || isAiSpeaking ? "speaking" : ""}`}>
              {[0, 0.1, 0.2, 0.3, 0.15].map((delay, i) => (
                <div key={i} className="wave-bar" style={{ animationDelay: `${delay}s` }} />
              ))}
            </div>

            <p className="text-center text-xs text-slate-300 leading-relaxed z-10">
              {isAgentLoading ? "Interviewer is thinking..." : statusText}
            </p>

            {approachEval && currentPhase === "evaluate_approach" && (
              <div className={`mt-2 mx-auto px-3 py-1 rounded-full text-[10px] font-semibold border z-10 ${approachEval.correct && approachEval.optimal ? "bg-green-500/10 border-green-500/20 text-green-400" : approachEval.correct ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                {approachEval.correct && approachEval.optimal ? "✓ Optimal" : approachEval.correct ? "~ Correct, not optimal" : "✗ Think again"}
              </div>
            )}

            {interimTranscript && (
              <p className="mt-2 text-[10px] text-slate-500 italic font-mono text-center z-10 truncate">"{interimTranscript}"</p>
            )}

            <div className="mt-3 flex justify-center z-10">
              <button
                id="mic-btn"
                onClick={toggleListening}
                disabled={currentPhase === "end_interview"}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${listening ? "bg-red-600 animate-pulse shadow-red-500/20" : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20"}`}
              >
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Left panel tabs: Problem / Submissions */}
          <div className="flex border-b border-[#2d2d2d] bg-[#1a1a1a] shrink-0">
            {(["problem", "submissions"] as LeftTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`flex-1 py-2.5 text-xs font-semibold capitalize transition cursor-pointer relative ${leftTab === tab ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {tab}
                {tab === "submissions" && submissions.length > 0 && (
                  <span className="ml-1 bg-[#3a3a3a] text-slate-400 rounded-full px-1.5 text-[9px]">{submissions.length}</span>
                )}
                {leftTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FFA116]" />}
              </button>
            ))}
          </div>

          {/* Problem Tab */}
          {leftTab === "problem" && (
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar select-text">
              {currentPhase === "introduction" ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-600 text-center mt-8">
                  <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-400">Preparing your interview...</p>
                  <p className="text-xs mt-1 text-slate-600 max-w-[200px]">Introduce yourself to the AI to get your first question.</p>
                </div>
              ) : currentQuestion ? (
                <div>
                  {/* Title + badges */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                      currentQuestion.difficulty === "Easy" ? "bg-[#00b8a3]/12 text-[#00b8a3]" :
                      currentQuestion.difficulty === "Hard" ? "bg-[#ef4743]/12 text-[#ef4743]" :
                      "bg-[#FFA116]/12 text-[#FFA116]"
                    }`}>{currentQuestion.difficulty ?? "Medium"}</span>
                    {company && company !== "Generic" && <span className="text-[11px] text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-md font-semibold">{company}</span>}
                    <span className="text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md">{topic}</span>
                  </div>

                  <h2 className="text-base font-bold text-white mb-4">{currentQuestion.title}</h2>

                  <div className="prose prose-invert prose-sm text-slate-300 leading-relaxed">
                    <div className="leetcode-html-content" dangerouslySetInnerHTML={{ __html: currentQuestion.prompt || currentQuestion.description || "" }} />

                    {currentQuestion.examples && currentQuestion.examples.length > 0 && (
                      <div className="mt-5 space-y-3">
                        {currentQuestion.examples.map((ex: any, i: number) => (
                          <div key={i} className="bg-[#212121] border border-[#2d2d2d] rounded-xl p-4 font-mono text-xs">
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Example {i + 1}</p>
                            <p className="mb-1"><span className="text-slate-400 font-semibold">Input:</span> <span className="text-slate-200">{String(ex.input)}</span></p>
                            <p><span className="text-slate-400 font-semibold">Output:</span> <span className="text-slate-200">{String(ex.output ?? ex.expected ?? "")}</span></p>
                            {ex.explanation && <p className="mt-1 text-slate-500 not-italic">{ex.explanation}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {currentQuestion.constraints && (
                      <div className="mt-5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Constraints</p>
                        <div className="text-[11px] font-mono text-slate-400 bg-[#212121] border border-[#2d2d2d] rounded-xl p-4 whitespace-pre-wrap">{currentQuestion.constraints}</div>
                      </div>
                    )}

                    {currentQuestion.hints && currentQuestion.hints.length > 0 && (
                      <details className="mt-4 group">
                        <summary className="text-[11px] font-semibold text-slate-500 hover:text-slate-300 cursor-pointer list-none flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                          Hints
                        </summary>
                        <ul className="mt-2 space-y-1.5 pl-5">
                          {currentQuestion.hints.map((h: string, i: number) => (
                            <li key={i} className="text-xs text-slate-500 list-disc">{h}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-slate-600 text-center">
                  <p className="text-xs">Waiting for interviewer to assign a question...</p>
                </div>
              )}
            </div>
          )}

          {/* Submissions Tab */}
          {leftTab === "submissions" && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {submissions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-600 text-center p-6">
                  <svg className="w-8 h-8 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  <p className="text-xs">No submissions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[#2d2d2d]">
                  {submissions.map((s) => (
                    <div key={s.id} className="px-4 py-3 hover:bg-[#212121] transition group">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold ${verdictColor(s.verdict)}`}>{verdictLabel(s.verdict)}</span>
                        <span className="text-[10px] text-slate-600">{new Date(s.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-600">
                        <span>{s.language}</span>
                        <span>·</span>
                        <span>{s.passedCount}/{s.totalCount} cases</span>
                        {s.time && <><span>·</span><span>{formatTime(s.time)}</span></>}
                        {s.memory && <><span>·</span><span>{formatMemory(s.memory)}</span></>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── HORIZONTAL RESIZER ──────────────────────────────────────── */}
        <div
          onMouseDown={(e) => { horizDraggingRef.current = true; startXRef.current = e.clientX; startWidthRef.current = leftWidth; e.preventDefault(); }}
          onTouchStart={(e) => { horizDraggingRef.current = true; startXRef.current = e.touches[0].clientX; startWidthRef.current = leftWidth; }}
          className="w-1 bg-[#2d2d2d] hover:bg-[#3b82f6] cursor-col-resize transition-colors duration-150 z-30 shrink-0"
        />

        {/* ── RIGHT PANEL: Editor ──────────────────────────────────────── */}
        <main className="flex-1 flex flex-col bg-[#1e1e1e] min-w-[320px] overflow-hidden">

          {/* Editor toolbar */}
          <div className="h-10 bg-[#1a1a1a] border-b border-[#2d2d2d] flex items-center justify-between px-3 shrink-0 select-none">
            {/* File tab */}
            <div className="flex items-center">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200 bg-[#1e1e1e] border-t-2 border-[#FFA116] px-3.5 py-2.5 h-10">
                <svg className="w-3.5 h-3.5 text-[#FFA116]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                </svg>
                <span>{getFilename(language)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* Language selector */}
              <select
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="bg-[#2a2a2a] text-xs text-slate-200 border border-[#3d3d3d] px-2.5 py-1 rounded-lg focus:outline-none focus:border-[#FFA116]/50 cursor-pointer hover:bg-[#333] transition"
              >
                <option value="C++ 17">C++ 17</option>
                <option value="C++ 20">C++ 20</option>
                <option value="Java">Java</option>
                <option value="Python 3">Python 3</option>
              </select>

              {/* Reset */}
              <button
                onClick={() => {
                  if (!window.confirm("Reset code to boilerplate? Your edits will be lost.")) return;
                  const bp = getBoilerplate(language, currentQuestion?.title ?? "Problem", company, topic);
                  setEditorValue(bp);
                  clearMonacoMarkers();
                }}
                title="Reset to boilerplate"
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-[#2a2a2a] transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>

          {/* Monaco editor area */}
          <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
            <Editor
              height="100%"
              language={getMonacoLanguage(language)}
              theme="vs-dark"
              value={editorValue}
              onChange={(val) => setEditorValue(val || "")}
              onMount={(editor, monacoInstance) => {
                editorInstanceRef.current = editor;
                monacoRef.current = monacoInstance;
                // Add keyboard shortcuts inside Monaco
                editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
                  if (unlocked && !isRunning) handleRun();
                });
                editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter, () => {
                  if (unlocked && !isRunning) handleSubmit();
                });
              }}
              options={{
                readOnly: !unlocked,
                minimap: { enabled: false },
                fontSize: 13.5,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                cursorBlinking: "smooth",
                fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
                fontLigatures: true,
                padding: { top: 14, bottom: 14 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                renderLineHighlight: "gutter",
                bracketPairColorization: { enabled: true },
                smoothScrolling: true,
                mouseWheelZoom: true,
              }}
            />

            {/* Locked overlay */}
            {!unlocked && (
              <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center text-center select-none">
                <div className="w-14 h-14 rounded-full bg-[#2a2a2a]/90 border border-slate-700 flex items-center justify-center mb-4 shadow-xl">
                  <svg className="w-5 h-5 text-[#FFA116]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Editor Locked</h3>
                <p className="text-xs text-slate-400 max-w-[220px] leading-relaxed">
                  {currentPhase === "introduction" ? "Introduce yourself to the interviewer first." : "Explain your approach to unlock the editor."}
                </p>
              </div>
            )}
          </div>

          {/* ── VERTICAL RESIZER (for bottom panel) ─────────────────── */}
          <div
            onMouseDown={(e) => { draggingRef.current = true; startYRef.current = e.clientY; startHeightRef.current = consoleHeight; e.preventDefault(); }}
            onTouchStart={(e) => { draggingRef.current = true; startYRef.current = e.touches[0].clientY; startHeightRef.current = consoleHeight; }}
            className="h-1 bg-[#2d2d2d] hover:bg-[#3b82f6] cursor-ns-resize transition-colors duration-150 z-30 shrink-0"
          />

          {/* ── BOTTOM PANEL ─────────────────────────────────────────── */}
          <div
            style={{ height: consoleVisible ? `${consoleHeight}px` : "44px" }}
            className="bg-[#1a1a1a] border-t border-[#2d2d2d] flex flex-col overflow-hidden shrink-0"
          >
            {/* Tab bar */}
            <div className="h-11 border-b border-[#2d2d2d] flex items-center justify-between px-3 select-none bg-[#1e1e1e] shrink-0">
              <div className="flex">
                {([
                  { id: "testcase" as BottomTab, label: "Test Cases" },
                  { id: "result" as BottomTab, label: "Results" },
                  { id: "custom_input" as BottomTab, label: "Custom Input" },
                ]).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setConsoleVisible(true); setActiveBottomTab(tab.id); }}
                    className={`relative px-4 py-2 text-xs font-semibold transition cursor-pointer ${activeBottomTab === tab.id && consoleVisible ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
                  >
                    {tab.label}
                    {activeBottomTab === tab.id && consoleVisible && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FFA116] rounded-t-sm" />
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setConsoleVisible((v) => !v)}
                className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-[#2d2d2d] transition cursor-pointer"
              >
                <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${consoleVisible ? "rotate-0" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Panel content */}
            {consoleVisible && (
              <div className="flex-1 overflow-y-auto custom-scrollbar">

                {/* ── TEST CASES TAB ──────────────────────────────────── */}
                {activeBottomTab === "testcase" && (
                  <div className="p-4">
                    {testCases.length > 0 ? (
                      <>
                        {/* Case pills */}
                        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                          {testCases.map((tc, i) => {
                            const res = testResults[i];
                            const dot = res !== undefined ? (res.passed ? "bg-[#00b8a3]" : "bg-[#ef4743]") : null;
                            const active = currentTestIndex === i;
                            return (
                              <button
                                key={i}
                                onClick={() => setCurrentTestIndex(i)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition cursor-pointer ${
                                  active
                                    ? dot
                                      ? res?.passed ? "bg-[#00b8a3]/10 border-[#00b8a3]/30 text-[#00b8a3]" : "bg-[#ef4743]/10 border-[#ef4743]/30 text-[#ef4743]"
                                      : "bg-[#2a2a2a] border-[#4a4a4a] text-white"
                                    : dot
                                      ? res?.passed ? "border-transparent text-[#00b8a3]/60 hover:border-[#00b8a3]/20" : "border-transparent text-[#ef4743]/60 hover:border-[#ef4743]/20"
                                      : "border-transparent text-slate-500 hover:text-slate-200 hover:bg-[#252525]"
                                }`}
                              >
                                {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0`} />}
                                {tc.label ?? `Case ${i + 1}`}
                                {tc.custom && <span className="text-[9px] text-slate-600 ml-0.5">(custom)</span>}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => {
                              const next = [...testCases, { input: "", expected: "", label: `Custom ${testCases.filter(t => t.custom).length + 1}`, custom: true }];
                              setTestCases(next);
                              setCurrentTestIndex(next.length - 1);
                            }}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-dashed border-[#3a3a3a] text-slate-600 hover:text-slate-300 hover:border-[#555] transition cursor-pointer"
                          >
                            + Add Case
                          </button>
                        </div>

                        {/* Selected test case inputs */}
                        {testCases[currentTestIndex] && (
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Input</div>
                              <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
                                <textarea
                                  value={testCases[currentTestIndex].input}
                                  onChange={(e) => {
                                    const next = [...testCases];
                                    next[currentTestIndex] = { ...next[currentTestIndex], input: e.target.value };
                                    setTestCases(next);
                                  }}
                                  spellCheck={false}
                                  className="w-full bg-transparent px-4 py-3 text-xs text-slate-200 font-mono resize-none focus:outline-none leading-relaxed"
                                  rows={3}
                                />
                              </div>
                            </div>
                            {!testCases[currentTestIndex].custom && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Expected Output</div>
                                <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
                                  <textarea
                                    value={testCases[currentTestIndex].expected}
                                    onChange={(e) => {
                                      const next = [...testCases];
                                      next[currentTestIndex] = { ...next[currentTestIndex], expected: e.target.value };
                                      setTestCases(next);
                                    }}
                                    spellCheck={false}
                                    className="w-full bg-transparent px-4 py-3 text-xs text-slate-200 font-mono resize-none focus:outline-none leading-relaxed"
                                    rows={2}
                                  />
                                </div>
                              </div>
                            )}
                            {/* Run this specific case */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleRunSingleCase(currentTestIndex)}
                                disabled={isRunning || !unlocked}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#252525] hover:bg-[#2e2e2e] border border-[#3a3a3a] text-slate-300 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Run This Case
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-600 text-center">
                        <svg className="w-9 h-9 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-xs font-medium text-slate-500">Test cases will appear when the interviewer assigns a question</p>
                        <p className="text-[10px] mt-1 text-slate-700">Explain your approach to the AI to proceed</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── RESULTS TAB ──────────────────────────────────────── */}
                {activeBottomTab === "result" && (
                  <div className="p-4">
                    {isRunning ? (
                      <div className="flex items-center gap-3 py-6">
                        <div className="w-4 h-4 rounded-full border-2 border-[#FFA116] border-t-transparent animate-spin shrink-0" />
                        <span className="text-xs text-slate-400">Submitting to Judge0...</span>
                      </div>
                    ) : testResults.length > 0 ? (
                      <div className="space-y-3">
                        {/* Summary banner */}
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${verdictBg(submissionStatus)}`}>
                          {verdictIcon(submissionStatus)}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-bold ${verdictColor(submissionStatus)}`}>{verdictLabel(submissionStatus)}</p>
                            <p className={`text-[10px] ${verdictColor(submissionStatus)} opacity-70`}>
                              {testResults.filter(r => r.passed).length}/{testResults.length} test cases passed
                            </p>
                          </div>
                          {(lastRunTime || lastRunMemory) && (
                            <div className="text-right text-[10px] text-slate-500 shrink-0">
                              {lastRunTime && <div>{formatTime(lastRunTime)}</div>}
                              {lastRunMemory && <div>{formatMemory(lastRunMemory)}</div>}
                            </div>
                          )}
                        </div>

                        {/* Per-case cards */}
                        {testResults.map((result, idx) => (
                          <div key={idx} className={`rounded-xl border overflow-hidden ${result.passed ? "border-[#00b8a3]/20 bg-[#00b8a3]/4" : "border-[#ef4743]/20 bg-[#ef4743]/4"}`}>
                            {/* Card header */}
                            <div className={`flex items-center justify-between gap-2 px-4 py-2.5 border-b ${result.passed ? "border-[#00b8a3]/15 bg-[#00b8a3]/6" : "border-[#ef4743]/15 bg-[#ef4743]/6"}`}>
                              <div className="flex items-center gap-2">
                                {result.passed ? (
                                  <svg className="w-3.5 h-3.5 text-[#00b8a3]" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5 text-[#ef4743]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                                )}
                                <span className={`text-xs font-bold ${result.passed ? "text-[#00b8a3]" : "text-[#ef4743]"}`}>
                                  {testCases[idx]?.label ?? `Case ${idx + 1}`} — {verdictLabel(result.verdict ?? (result.passed ? "accepted" : "wrong"))}
                                </span>
                              </div>
                              {(result.time || result.memory) && (
                                <div className="text-[9px] text-slate-600 flex gap-2">
                                  {result.time && <span>{formatTime(result.time)}</span>}
                                  {result.memory && <span>{formatMemory(result.memory)}</span>}
                                </div>
                              )}
                            </div>

                            {/* Card body */}
                            <div className="px-4 py-3 grid grid-cols-2 gap-4 text-[11px] font-mono">
                              <div>
                                <div className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Input</div>
                                <pre className="text-slate-300 whitespace-pre-wrap break-all leading-relaxed">{result.input || "(empty)"}</pre>
                              </div>

                              {result.error ? (
                                <div className="col-span-2">
                                  <div className="text-[9px] font-bold text-[#ff9500] uppercase tracking-wider mb-1.5">
                                    {result.verdict === "compile_error" ? "Compilation Error" : result.verdict === "tle" ? "Time Limit Exceeded" : "Runtime Error / Stderr"}
                                  </div>
                                  <pre className="text-[#ff9500]/80 whitespace-pre-wrap break-all leading-relaxed">{result.error}</pre>
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <div className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Expected Output</div>
                                    <pre className="text-slate-300 whitespace-pre-wrap break-all leading-relaxed">{result.expected || "(not checked)"}</pre>
                                  </div>
                                  {result.output !== undefined && (
                                    <div className="col-span-2">
                                      <div className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 ${result.passed ? "text-[#00b8a3]" : "text-[#ef4743]"}`}>
                                        Your Output
                                      </div>
                                      <pre className={`whitespace-pre-wrap break-all leading-relaxed ${result.passed ? "text-[#00b8a3]/80" : "text-[#ef4743]/80"}`}>
                                        {result.output || "(empty)"}
                                      </pre>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-600 text-center">
                        <svg className="w-9 h-9 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs font-medium text-slate-500">Run your code to see results here</p>
                        <p className="text-[10px] mt-1 text-slate-700">Ctrl+Enter to run · Ctrl+Shift+Enter to submit</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── CUSTOM INPUT TAB ─────────────────────────────────── */}
                {activeBottomTab === "custom_input" && (
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Custom stdin</div>
                      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl overflow-hidden">
                        <textarea
                          value={customStdin}
                          onChange={(e) => setCustomStdin(e.target.value)}
                          spellCheck={false}
                          placeholder="Enter custom input here..."
                          className="w-full bg-transparent px-4 py-3 text-xs text-slate-200 font-mono resize-none focus:outline-none leading-relaxed placeholder-slate-700"
                          rows={6}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-600">Click <strong className="text-slate-500">Run</strong> to execute your code against this custom input.</p>
                  </div>
                )}

              </div>
            )}

            {/* Bottom action bar */}
            <div className="h-12 px-4 border-t border-[#2d2d2d] bg-[#1a1a1a] flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                {submissionStatus && !isRunning && (
                  <span className={`font-semibold ${verdictColor(submissionStatus)}`}>{verdictLabel(submissionStatus)}</span>
                )}
                {isRunning && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <div className="w-3 h-3 rounded-full border-2 border-[#FFA116]/60 border-t-transparent animate-spin" />
                    <span>Running...</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {/* Run button */}
                <button
                  onClick={handleRun}
                  disabled={isRunning || !unlocked}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#252525] hover:bg-[#2e2e2e] text-slate-200 border border-[#3a3a3a] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isRunning ? (
                    <div className="w-3 h-3 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  )}
                  <span>Run</span>
                  <span className="text-[9px] text-slate-600 ml-0.5">⌘↵</span>
                </button>

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  disabled={isRunning || !unlocked}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-[#00b8a3] hover:bg-[#00cfb8] text-white transition shadow-lg shadow-[#00b8a3]/15 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Submit</span>
                  <span className="text-[9px] text-white/60 ml-0.5">⌘⇧↵</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── GLOBAL STYLES ─────────────────────────────────────────────── */}
      <style jsx>{`
        .wave-bar {
          animation: none !important;
          height: 6px !important;
          background-color: #3b82f6 !important;
          width: 3px !important;
          border-radius: 4px !important;
          transition: height 0.1s;
        }
        :global(#voice-viz.speaking) .wave-bar {
          animation: wave 1.0s ease-in-out infinite !important;
        }
        @keyframes wave {
          0%, 100% { height: 6px; }
          50% { height: 28px; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4a4a4a; }
      `}</style>
    </div>
  );
}
