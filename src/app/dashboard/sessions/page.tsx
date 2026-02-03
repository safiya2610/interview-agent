"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase!
          .from("interview_sessions")
          .select("id, company, topic, created_at, duration_minutes, elapsed_seconds, agent_score")
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) setSessions(data ?? []);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function formatMinutes(seconds: number | null | undefined) {
    const s = Number(seconds ?? 0);
    if (!Number.isFinite(s) || s <= 0) return "0m";
    return `${Math.max(1, Math.round(s / 60))}m`;
  }

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-6 py-10 w-full">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">All Sessions</h1>
        <Link href="/dashboard" className="text-sm text-blue-400 hover:text-blue-300">Back</Link>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden p-6">
        <div className="overflow-x-auto p-4">
          {loading ? (
            <p className="text-slate-400">Loading sessions…</p>
          ) : error ? (
            <p className="text-yellow-300">Failed to load sessions: {error}</p>
          ) : sessions.length === 0 ? (
            <p className="text-slate-400">No sessions to display.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{s.company} • {s.topic}</div>
                    <div className="text-xs text-slate-400">{new Date(s.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-xs text-slate-300">{formatMinutes(s.elapsed_seconds)} / {s.duration_minutes}m</div>
                    <div className="text-xs font-bold text-blue-300">Score: {s.agent_score ?? 8}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
