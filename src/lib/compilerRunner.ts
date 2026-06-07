import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

type Diagnostic = { line: number; column?: number; message: string };

function parseGccDiagnostics(stderr: string): Diagnostic[] {
  const lines = stderr.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const re = /^(.*?):(\d+):(\d+):\s+(error|warning):\s+(.*)$/;
  for (const l of lines) {
    const m = l.match(re);
    if (m) {
      diagnostics.push({ line: Number(m[2]), column: Number(m[3]), message: `${m[4]}: ${m[5]}` });
    }
  }
  return diagnostics;
}

function parseJavacDiagnostics(stderr: string): Diagnostic[] {
  const lines = stderr.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  // javac: MyClass.java:10: error: ';' expected
  const re = /^(.*?):(\d+):\s+(error|warning):\s+(.*)$/;
  for (const l of lines) {
    const m = l.match(re);
    if (m) {
      diagnostics.push({ line: Number(m[2]), message: `${m[3]}: ${m[4]}` });
    }
  }
  return diagnostics;
}

function parsePythonTraceback(stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Look for lines like: File "/tmp/xxx/script.py", line 12, in <module>
  const fileLineRe = /File \".*?\/(.*?)\", line (\d+)(?:, in .*?)?/;
  const lines = stderr.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fileLineRe);
    if (m) {
      const lineNum = Number(m[2]);
      // next non-empty line often contains the error message
      let msg = lines[i + 1] ?? "";
      // fallback to last line
      if (!msg || msg.trim() === "") msg = lines[lines.length - 1] ?? "";
      diagnostics.push({ line: lineNum, message: msg.trim() });
    }
  }
  // If no structured entries found, place full stderr as a single diagnostic
  if (diagnostics.length === 0 && stderr.trim()) {
    diagnostics.push({ line: 0, message: stderr.trim() });
  }
  return diagnostics;
}

export async function runCodeInSandbox(opts: { code: string; language: string; stdin?: string; timeoutMs?: number }) {
  const { code, language } = opts;
  const timeoutMs = opts.timeoutMs ?? 7000;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-"));
  try {
    if (/c\+\+/i.test(language)) {
      const source = path.join(tmp, "Main.cpp");
      fs.writeFileSync(source, code, "utf8");
      const exe = process.platform === "win32" ? path.join(tmp, "a.exe") : path.join(tmp, "a.out");

      const compile = spawnSync("g++", ["-std=c++17", "-O2", source, "-o", exe], { encoding: "utf8", timeout: timeoutMs });
      if (compile.error && (compile.error as any).code === "ENOENT") {
        return { ok: false, error: "g++ not found on server. Install g++ or run inside Docker.", compileStderr: String(compile.error), diagnostics: [] };
      }

      const compileStderr = compile.stderr ?? "";
      if (compile.status !== 0) {
        const diagnostics = parseGccDiagnostics(compileStderr);
        return { ok: false, compileStderr, diagnostics };
      }

      const runCmd = process.platform === "win32" ? exe : exe;
      const run = spawnSync(runCmd, { encoding: "utf8", timeout: timeoutMs, input: opts.stdin ?? undefined, cwd: tmp });
      return { ok: true, compileStderr: "", runStdout: run.stdout ?? "", runStderr: run.stderr ?? "" };
    }

    if (/java/i.test(language)) {
      let className = "Solution";
      const match = code.match(/public\s+class\s+(\w+)/);
      if (match) {
        className = match[1];
      }

      const source = path.join(tmp, `${className}.java`);
      fs.writeFileSync(source, code, "utf8");
      const javac = spawnSync("javac", [source], { encoding: "utf8", timeout: timeoutMs });
      if (javac.error && (javac.error as any).code === "ENOENT") {
        return { ok: false, error: "javac not found on server. Install JDK or run inside Docker.", compileStderr: String(javac.error) };
      }
      const compileStderr = javac.stderr ?? "";
      if (javac.status !== 0) {
        const diagnostics = parseJavacDiagnostics(compileStderr);
        return { ok: false, compileStderr, diagnostics };
      }
      const run = spawnSync("java", ["-cp", tmp, className], { encoding: "utf8", timeout: timeoutMs, input: opts.stdin ?? undefined });
      const runStderr = run.stderr ?? "";
      const runStdout = run.stdout ?? "";
      const diagnostics = runStderr ? parseJavacDiagnostics(runStderr) : [];
      return { ok: true, compileStderr: "", runStdout, runStderr, diagnostics };
    }

    if (/python/i.test(language)) {
      const source = path.join(tmp, "script.py");
      fs.writeFileSync(source, code, "utf8");
      // Prefer python3 then python
      const pythonCmds = ["python3", "python"];
      let found: string | null = null;
      for (const cmd of pythonCmds) {
        const which = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 2000 });
        if (!which.error) { found = cmd; break; }
      }
      if (!found) {
        return { ok: false, error: "Python not found on server. Install Python or run inside Docker." };
      }
      const run = spawnSync(found, [source], { encoding: "utf8", timeout: timeoutMs, input: opts.stdin ?? undefined });
      const runStderr = run.stderr ?? "";
      const runStdout = run.stdout ?? "";
      const diagnostics = runStderr ? parsePythonTraceback(runStderr) : [];
      return { ok: true, runStdout, runStderr, diagnostics };
    }

    return { ok: false, error: "Unsupported language", diagnostics: [] };
  } finally {
    // best-effort cleanup
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export type { Diagnostic };
