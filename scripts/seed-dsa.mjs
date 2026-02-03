import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function normalizeStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  // allow comma-separated strings
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) die("Missing env var NEXT_PUBLIC_SUPABASE_URL");
if (!supabaseAnonKey) die("Missing env var NEXT_PUBLIC_SUPABASE_ANON_KEY");

const fileArg = process.argv[2];
if (!fileArg) {
  die(
    "Usage: node scripts/seed-dsa.mjs <path-to-dsa.json>\n" +
      "Example: node scripts/seed-dsa.mjs data/dsa.json"
  );
}

const inputPath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(inputPath)) die(`File not found: ${inputPath}`);

let raw;
try {
  raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (e) {
  die(`Failed to read/parse JSON: ${String(e?.message ?? e)}`);
}

const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : null;
if (!rows) die("JSON must be an array of question objects, or { data: [...] }");

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const mapped = rows.map((r) => {
  const title = r.title ?? r.name ?? r.question ?? r.problem;
  if (!title) return null;

  return {
    slug: r.slug ?? null,
    source: r.source ?? null,
    source_id: r.source_id ?? r.leetcode_id ?? r.id ?? null,
    source_url: r.source_url ?? r.url ?? null,

    title: String(title),
    difficulty: r.difficulty ?? null,
    topics: normalizeStringArray(r.topics ?? r.topic_tags ?? r.tags),
    companies: normalizeStringArray(r.companies ?? r.company_tags ?? r.company),

    prompt: r.prompt ?? r.description ?? null,
    constraints: r.constraints ?? null,

    examples: normalizeJson(r.examples, []),
    hints: normalizeJson(r.hints, []),
    metadata: normalizeJson(r.metadata ?? r.meta, {}),
  };
}).filter(Boolean);

if (mapped.length === 0) die("No valid rows found (each row needs at least a title)");

// Chunk inserts to avoid payload limits
const CHUNK_SIZE = 500;
let inserted = 0;

for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
  const chunk = mapped.slice(i, i + CHUNK_SIZE);
  const { error } = await supabase
    .from("dsa_questions")
    .upsert(chunk, { onConflict: "slug" });

  if (error) {
    die(
      `Insert failed at chunk starting ${i}: ${error.message}\n` +
        "Tip: if you don't have unique slugs, add slugs or change onConflict to source_id."
    );
  }

  inserted += chunk.length;
  console.log(`Seeded ${inserted}/${mapped.length}`);
}

console.log("Done.");
