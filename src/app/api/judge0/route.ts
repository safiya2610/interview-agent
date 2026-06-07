import { NextResponse } from "next/server";
import { runCodeInSandbox } from "../../../lib/compilerRunner";

// Judge0 language IDs — https://ce.judge0.com/languages
const LANGUAGE_MAP: Record<string, number> = {
  "C++ 17": 54,
  "C++ 20": 54, // CE only has GCC 9.2; best we can do
  "Python 3": 71,
  "Java": 62,
};

// Public Judge0 Community Edition (free, rate-limited)
const PUBLIC_JUDGE0_URL = "https://ce.judge0.com";

// Judge0 status IDs
const J0_STATUS = {
  IN_QUEUE: 1,
  PROCESSING: 2,
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TLE: 5,
  COMPILE_ERROR: 6,
  RUNTIME_SIGSEGV: 7,
  RUNTIME_SIGFPE: 8,
  RUNTIME_SIGABRT: 9,
  RUNTIME_NZEC: 11,
  RUNTIME_OTHER: 12,
  INTERNAL_ERROR: 13,
  EXEC_FORMAT_ERROR: 14,
} as const;

export interface Judge0Response {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  compileStderr?: string;
  error?: string;
  statusId?: number;
  statusDesc?: string;
  time?: string;   // seconds as string e.g. "0.042"
  memory?: number; // KB
  verdict?: "accepted" | "wrong" | "compile_error" | "runtime_error" | "tle" | "mle" | "internal_error";
}

async function callJudge0(
  baseUrl: string,
  apiKey: string | undefined,
  code: string,
  language: string,
  stdin: string | undefined
): Promise<Judge0Response> {
  const url = `${baseUrl.replace(/\/$/, "")}/submissions?base64_encoded=false&wait=true`;

  const langId = LANGUAGE_MAP[language] ?? (/\d+/.test(language) ? Number(language) : 54);

  const payload = {
    source_code: code,
    language_id: langId,
    stdin: stdin ?? "",
    cpu_time_limit: 5,
    memory_limit: 262144, // 256 MB in KB
    wall_time_limit: 10,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (apiKey) {
    headers["X-Auth-Token"] = apiKey;
  }

  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const raw = await r.json().catch(() => ({} as any));

  if (!r.ok) {
    throw new Error(`Judge0 HTTP ${r.status}: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  const statusId: number = raw?.status?.id ?? 0;
  const statusDesc: string = raw?.status?.description ?? "Unknown";

  const resp: Judge0Response = {
    ok: false,
    statusId,
    statusDesc,
    time: raw.time ?? undefined,
    memory: raw.memory ?? undefined,
  };

  if (raw.stdout) resp.stdout = raw.stdout;
  if (raw.stderr) resp.stderr = raw.stderr;
  if (raw.compile_output) resp.compileStderr = raw.compile_output;

  // Map status codes to verdicts
  if (statusId === J0_STATUS.ACCEPTED) {
    resp.ok = true;
    resp.verdict = "accepted";
  } else if (statusId === J0_STATUS.COMPILE_ERROR) {
    resp.ok = false;
    resp.verdict = "compile_error";
    // compile_output is the actual error text
    resp.error = raw.compile_output || "Compilation Error";
  } else if (statusId === J0_STATUS.TLE) {
    resp.ok = false;
    resp.verdict = "tle";
    resp.error = "Time Limit Exceeded";
  } else if (statusId === J0_STATUS.WRONG_ANSWER) {
    // Judge0 itself won't say wrong answer for our use-case (we compare output ourselves)
    // but handle it anyway
    resp.ok = true; // let the frontend compare stdout to expected
    resp.verdict = "accepted";
  } else if (statusId >= J0_STATUS.RUNTIME_SIGSEGV && statusId <= J0_STATUS.EXEC_FORMAT_ERROR) {
    resp.ok = false;
    resp.verdict = "runtime_error";
    resp.error = raw.stderr || raw.message || statusDesc || "Runtime Error";
  } else if (statusId === J0_STATUS.INTERNAL_ERROR) {
    resp.ok = false;
    resp.verdict = "internal_error";
    resp.error = "Judge0 Internal Error. Please try again.";
  } else {
    // In Queue / Processing / unknown — treat as error
    resp.ok = false;
    resp.error = statusDesc;
  }

  return resp;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const code: string = body?.code ?? "";
    const language: string = body?.language ?? "C++ 17";
    const stdin: string | undefined = body?.stdin;

    const judge0Url = process.env.JUDGE0_URL?.trim();
    const judge0Key = process.env.JUDGE0_API_KEY?.trim();

    // 1. Self-hosted Judge0 (if configured)
    if (judge0Url) {
      try {
        const resp = await callJudge0(judge0Url, judge0Key, code, language, stdin);
        return NextResponse.json(resp, { status: 200 });
      } catch (e) {
        console.warn("[judge0] Self-hosted failed, falling back to public CE:", (e as Error).message);
      }
    }

    // 2. Public Judge0 CE
    try {
      const resp = await callJudge0(PUBLIC_JUDGE0_URL, undefined, code, language, stdin);
      return NextResponse.json(resp, { status: 200 });
    } catch (e) {
      console.warn("[judge0] Public CE failed, falling back to local runner:", (e as Error).message);
    }

    // 3. Local system compiler (requires g++/python3/java installed)
    const result = await runCodeInSandbox({ code, language, stdin, timeoutMs: 8000 });
    const resp: Judge0Response = { ok: !!result.ok };
    if (result.compileStderr) {
      resp.compileStderr = result.compileStderr;
      resp.error = result.compileStderr;
      resp.verdict = "compile_error";
      resp.ok = false;
    } else if (result.error) {
      resp.error = result.error;
      resp.verdict = "runtime_error";
      resp.ok = false;
    } else {
      resp.stdout = result.runStdout;
      resp.stderr = result.runStderr;
      resp.verdict = "accepted";
      resp.ok = true;
    }
    // Attach diagnostic info
    if (result.diagnostics && result.diagnostics.length > 0) {
      (resp as any).diagnostics = result.diagnostics;
    }
    return NextResponse.json(resp, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), verdict: "internal_error" }, { status: 500 });
  }
}
