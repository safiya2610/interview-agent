"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import SetupModal from "../../components/SetupModal";
import AuthStatus from "../../components/AuthStatus";
import StatsGrid from "../../components/StatsGrid";
import EditorWorkspace from "../../components/EditorWorkspace";
import { supabase } from "../../lib/supabaseClient";
import { useSearchParams } from "next/navigation";

function DashboardInner() {
  const [modalOpen, setModalOpen] = useState(false);
  const [session, setSession] = useState<null | { company: string; topic: string; duration: number; excludeTopics: string[] }>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  function startSession(opts: { company: string; topic: string; duration: number; excludeTopics: string[] }) {
    setSession(opts);
    setModalOpen(false);
  }

  useEffect(() => {
    let mounted = true;

    async function refreshUser() {
      try {
        // getUser() returns the freshest user metadata (better than relying on the session copy)
        const { data, error } = await supabase!.auth.getUser();
        if (error) throw error;
        if (!mounted) return;
        const u = data.user ?? null;
        const name = (u as any)?.user_metadata?.full_name || (u ? (u.email?.split("@")[0] ?? null) : null);
        setDisplayName(name);
      } catch (err) {
        console.error("Failed to load user for dashboard", err);
      }
    }

    refreshUser();

    const { data: listener } = supabase!.auth.onAuthStateChange((_e, session) => {
      // session may not have the latest user_metadata; fetch the latest user
      if (session?.user) refreshUser();
      else setDisplayName(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Load recent sessions for the table
  useEffect(() => {
    let cancelled = false;
    if (session) return;

    async function loadRecent() {
      setRecentLoading(true);
      setRecentError(null);
      try {
        const { data, error } = await supabase!
          .from("interview_sessions")
          .select("id, company, topic, created_at, duration_minutes, elapsed_seconds, agent_score")
          .order("created_at", { ascending: false })
          .limit(3);
        if (error) throw error;
        if (!cancelled) setRecentSessions(data ?? []);
      } catch (e: any) {
        if (!cancelled) setRecentError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }

    loadRecent();
    return () => {
      cancelled = true;
    };
  }, [session]);

  function formatMinutes(seconds: number | null | undefined) {
    const s = Number(seconds ?? 0);
    if (!Number.isFinite(s) || s <= 0) return "0m";
    return `${Math.max(1, Math.round(s / 60))}m`;
  }

  // If ?start=1 is present, open the setup modal immediately
  useEffect(() => {
    const start = searchParams?.get("start");
    if (start === "1") {
      setModalOpen(true);
      return;
    }

    // If company/topic/duration are provided via query params, start the session
    const company = searchParams?.get("company");
    const topic = searchParams?.get("topic");
    const duration = searchParams?.get("duration");
    if (company && topic && duration) {
      const dur = parseInt(duration, 10) || 30;
      setSession({ company, topic, duration: dur, excludeTopics: [] });
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-transparent">
      {/* Top navigation / header (only when NOT in an active interview) */}
      {!session && (
        <nav className="border-b border-white/5 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white">C</div>
                <span className="text-lg font-bold tracking-tight">Codent<span className="text-blue-500">AI</span></span>
              </div>

              <Link href="/" className="hidden md:flex items-center gap-2 text-slate-300 hover:text-white text-sm transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5L12 3l9 7.5V21a.75.75 0 0 1-.75.75H15v-6.5a.75.75 0 0 0-.75-.75h-4.5A.75.75 0 0 0 9 15.25v6.5H3.75A.75.75 0 0 1 3 21V10.5Z" />
                </svg>
                Home
              </Link>
            </div>

            <div className="flex items-center gap-6">
              <button onClick={() => setModalOpen(true)} className="hidden md:flex bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-blue-600/20">
                + Start New Interview
              </button>

              <div className="h-6 w-[1px] bg-white/10 hidden md:block"></div>

              <div>
                <AuthStatus />
              </div>
            </div>
          </div>
        </nav>
      )}
      {!session ? (
        <main className="max-w-7xl mx-auto px-6 py-10 w-full">
          <div className="mb-10 flex flex-col md:flex-row justify-between items-end gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{displayName ? `Welcome back, ${displayName}` : 'Welcome back'}</h1>
              <p className="text-slate-400">Your AI preparation stats for the last 30 days.</p>
            </div>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold rounded-full">Become the ideal candidate.</span>
            </div>
          </div>

          <StatsGrid onStartNew={() => setModalOpen(true)} />

          <div className="glass-card rounded-2xl overflow-hidden p-6">
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="font-bold text-lg">Recent Sessions</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => setModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-lg shadow-blue-600/20">+ Start New Interview</button>
                <Link href="/dashboard/sessions" className="text-xs text-blue-400 hover:text-blue-300">View All</Link>
              </div>
            </div>
            <div className="overflow-x-auto p-4">
              {recentLoading ? (
                <p className="text-slate-400">Loading sessions…</p>
              ) : recentError ? (
                <p className="text-yellow-300">Failed to load sessions: {recentError}</p>
              ) : recentSessions.length === 0 ? (
                <p className="text-slate-400">No recent sessions to display — start a new interview to begin.</p>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((s) => (
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

          <SetupModal open={modalOpen} onClose={() => setModalOpen(false)} onStart={startSession} />
        </main>
      ) : (
        <EditorWorkspace
          company={session.company}
          topic={session.topic}
          duration={session.duration}
          excludeTopics={session.excludeTopics}
          onEnd={() => setSession(null)}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-transparent" />}>
      <DashboardInner />
    </Suspense>
  );
}
