"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Props = {
  open: boolean;
  onClose: () => void;
  onStart: (opts: { company: string; topic: string; duration: number; excludeTopics: string[] }) => void;
};

const DEFAULT_COMPANIES = [
  "Adobe",
  "Airbnb",
  "Amazon",
  "Apple",
  "Atlassian",
  "Bloomberg",
  "ByteDance",
  "Capital One",
  "Cisco",
  "Coinbase",
  "Databricks",
  "DoorDash",
  "Dropbox",
  "eBay",
  "Epic Systems",
  "Goldman Sachs",
  "Google",
  "HackerRank",
  "IBM",
  "Intuit",
  "Jane Street",
  "LinkedIn",
  "Lyft",
  "Meta",
  "Microsoft",
  "Netflix",
  "NVIDIA",
  "Oracle",
  "Palantir",
  "PayPal",
  "Pinterest",
  "Qualcomm",
  "Robinhood",
  "Salesforce",
  "SAP",
  "ServiceNow",
  "Slack",
  "Snowflake",
  "Spotify",
  "Square",
  "Tesla",
  "TikTok",
  "Twilio",
  "Two Sigma",
  "Uber",
  "Visa",
  "Walmart",
  "Wayfair",
  "Zoom",
];

const DEFAULT_TOPICS = [
  "Arrays & Hashing",
  "Backtracking",
  "Binary Search",
  "Bit Manipulation",
  "Dynamic Programming",
  "Graphs",
  "Heap / Priority Queue",
  "Intervals",
  "Linked List",
  "Math & Geometry",
  "Matrix",
  "Monotonic Stack",
  "Prefix Sum",
  "Sliding Window",
  "Stack",
  "Strings",
  "System Design",
  "Trees",
  "Tries",
  "Two Pointers",
  "Union Find",
  "Topological Sort",
  "Shortest Path",
  "Greedy",
  "Segment Tree",
  "Fenwick Tree",
];

function dedupeSorted(values: string[]) {
  const map = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) map.set(key, trimmed);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeRpcValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}

export default function SetupModal({ open, onClose, onStart }: Props) {
  const [company, setCompany] = useState("");
  const [excludeTopics, setExcludeTopics] = useState<string[]>([]);
  const [duration, setDuration] = useState(45);
  const [companyOptions, setCompanyOptions] = useState<string[]>(DEFAULT_COMPANIES);
  const [topicOptions, setTopicOptions] = useState<string[]>(DEFAULT_TOPICS);

  function toggleExcludeTopic(t: string) {
    setExcludeTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadSetupOptions() {
      if (!supabase) return;

      try {
        const [companyResult, topicResult] = await Promise.allSettled([
          supabase.rpc("get_company_options"),
          supabase.rpc("get_topic_options"),
        ]);

        if (cancelled) return;

        const fetchedCompanies =
          companyResult.status === "fulfilled" ? normalizeRpcValues(companyResult.value.data) : [];
        const fetchedTopics =
          topicResult.status === "fulfilled" ? normalizeRpcValues(topicResult.value.data) : [];

        if (companyResult.status === "rejected" || topicResult.status === "rejected") {
          console.warn("Using partial fallback setup options", {
            companyError: companyResult.status === "rejected" ? companyResult.reason : null,
            topicError: topicResult.status === "rejected" ? topicResult.reason : null,
          });
        }

        setCompanyOptions(dedupeSorted([...DEFAULT_COMPANIES, ...fetchedCompanies]));
        setTopicOptions(dedupeSorted([...DEFAULT_TOPICS, ...fetchedTopics]));
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load setup options from Supabase", error);
        }
      }
    }

    loadSetupOptions();

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-lg glass-card rounded-2xl p-8 animate-enter">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-1">Configure Session</h2>
          <p className="text-slate-400 text-sm">Customize your mock interview parameters.</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Target Company</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} list="companies" placeholder="e.g. Google, Meta, Netflix" className="w-full bg-slate-900 border border-white/10 text-white p-3 rounded-lg focus:outline-none focus:border-blue-500 transition placeholder:text-slate-600" />
          <datalist id="companies">
            {companyOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <p className="mt-2 text-xs text-slate-500">
            {companyOptions.length} companies available to choose from.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Exclude Topics</label>
          <div className="rounded-lg border border-white/10 bg-slate-900 p-3">
            <div className="max-h-64 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
                {topicOptions.map((t) => {
                  const checked = excludeTopics.includes(t);
                  return (
                    <label key={t} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExcludeTopic(t)}
                        className="h-4 w-4 rounded border-white/20 bg-slate-950"
                      />
                      <span className={checked ? "text-white" : ""}>{t}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {topicOptions.length} topics available to exclude. Leave empty to allow any topic.
            </p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Duration (minutes)</label>
          <div className="grid grid-cols-4 gap-3">
            {[30, 45, 60, 75].map((d) => (
              <label key={d} className="cursor-pointer">
                <input type="radio" name="duration" value={d} checked={duration === d} onChange={() => setDuration(d)} className="peer sr-only" />
                <div className={`text-center py-2 rounded-lg border border-white/10 bg-slate-900 peer-checked:bg-blue-600 peer-checked:border-blue-500 peer-checked:text-white text-slate-400 text-sm transition hover:bg-white/5`}>
                  {d}m
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              const available = topicOptions.filter((t) => !excludeTopics.includes(t));
              let topicLabel = "Technical Interview";

              if (excludeTopics.length > 0) {
                // Construct a label based on exclusions as requested
                topicLabel = `Excluding ${excludeTopics.join(", ")}`;
              } else if (available.length === 1) {
                topicLabel = available[0];
              }

              onStart({ company: company || "Generic", topic: topicLabel, duration, excludeTopics });
            }}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg shadow-blue-500/25 transition transform active:scale-[0.98]"
          >
            Start Interview Session
          </button>
        </div>
      </div>
    </div>
  );
}
