"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Stats = {
  totalSessions: number;
  sessionsThisWeek: number;
  avgAgentScore: number | null;
  timePracticedSeconds: number;
};

type Props = {
  onStartNew?: () => void;
};

function startOfWeekISO(now: Date) {
  // Monday as start of week
  const d = new Date(now);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return { hours, minutes };
}

export default function StatsGrid({ onStartNew }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    totalSessions: 0,
    sessionsThisWeek: 0,
    avgAgentScore: null,
    timePracticedSeconds: 0,
  });

  const now = useMemo(() => new Date(), []);
  const sinceWeek = useMemo(() => startOfWeekISO(now), [now]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!supabase) throw new Error("Supabase not initialized.");

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const userId = userRes.user?.id;
        if (!userId) {
          if (!cancelled) {
            setStats({ totalSessions: 0, sessionsThisWeek: 0, avgAgentScore: null, timePracticedSeconds: 0 });
            setLoading(false);
          }
          return;
        }

        const { data: rows, error: rowsErr } = await supabase
          .from("interview_sessions")
          .select("created_at, elapsed_seconds, agent_score")
          .eq("user_id", userId);

        if (rowsErr) throw rowsErr;

        const totalSessions = rows?.length ?? 0;
        const sessionsThisWeek = (rows ?? []).filter((r) => (r as any)?.created_at >= sinceWeek).length;

        const scored = (rows ?? [])
          .map((r) => (r as any)?.agent_score)
          .filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
        const avgAgentScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

        const timePracticedSeconds = (rows ?? [])
          .map((r) => Number((r as any)?.elapsed_seconds ?? 0))
          .filter((v) => Number.isFinite(v) && v > 0)
          .reduce((a, b) => a + b, 0);

        if (!cancelled) {
          setStats({ totalSessions, sessionsThisWeek, avgAgentScore, timePracticedSeconds });
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sinceWeek]);

  const { hours, minutes } = useMemo(() => formatDuration(stats.timePracticedSeconds), [stats.timePracticedSeconds]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
      <div className="glass-card p-6 rounded-2xl">
        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Total Sessions</div>
        <div className="text-3xl font-bold text-white">{loading ? "…" : stats.totalSessions}</div>
        <div className="text-green-400 text-xs mt-2 flex items-center gap-1">{loading ? "" : `+${stats.sessionsThisWeek} this week`}</div>
      </div>
      <div className="glass-card p-6 rounded-2xl">
        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Avg. Agent Score</div>
        <div className="text-3xl font-bold text-white">
          {loading ? "…" : stats.avgAgentScore == null ? "—" : stats.avgAgentScore.toFixed(1)}
          <span className="text-lg text-slate-500">/10</span>
        </div>
        <div className="text-blue-400 text-xs mt-2">{loading ? "" : stats.avgAgentScore == null ? "No scored sessions yet" : "All time"}</div>
      </div>
      <div className="glass-card p-6 rounded-2xl">
        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Time Practiced</div>
        <div className="text-3xl font-bold text-white">
          {loading ? "…" : `${hours}h`}
          <span className="text-lg text-slate-500">{loading ? "" : `${minutes}m`}</span>
        </div>
      </div>
      <div className="p-6 rounded-2xl">
        <button onClick={onStartNew} className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-2xl flex flex-col justify-center items-center hover:scale-[1.02] transition shadow-xl shadow-blue-900/20 group text-left w-full h-full border border-white/10" id="start-card">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3 group-hover:bg-white/30 transition">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <span className="font-bold text-white">Start New Interview</span>
          <span className="text-xs text-blue-200 mt-1">Practice with Agent</span>
        </button>
      </div>
      {error && (
        <div className="md:col-span-4 text-xs text-yellow-300 mt-2">
          Stats unavailable: {error}
        </div>
      )}
    </div>
  );
}
