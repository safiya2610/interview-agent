import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const JSON_PATH = path.join(DATA_DIR, "feedback_cache.json");

type CacheRow = {
  inserted_at: string;
  session_id: string;
  user_id: string | null;
  payload: unknown;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}


export function cacheFeedbackLocally(args: {
  sessionId: string;
  userId: string | null;
  feedback: unknown;
}) {
  ensureDataDir();

  let existing: CacheRow[] = [];
  if (fs.existsSync(JSON_PATH)) {
    try {
      const raw = fs.readFileSync(JSON_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }
  }

  const row: CacheRow = {
    inserted_at: new Date().toISOString(),
    session_id: args.sessionId,
    user_id: args.userId,
    payload: args.feedback,
  };

  existing.push(row);
  fs.writeFileSync(JSON_PATH, JSON.stringify(existing, null, 2), "utf-8");
}


