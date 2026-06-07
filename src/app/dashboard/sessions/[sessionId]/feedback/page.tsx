"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";
import type { InterviewFeedback } from "../../../../../lib/feedback-schema";

export default function SessionFeedbackPage() {
  const params = useParams();
  const sessionId = params?.sessionId ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [sessionMeta, setSessionMeta] = useState<any>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      if (!supabase) {
        setError("Supabase client is not initialized.");
        setLoading(false);
        return;
      }

      try {
        const [{ data: feedbackData, error: feedbackError }, { data: sessionData, error: sessionError }] = await Promise.all([
          supabase
            .from("interview_feedback")
            .select("*")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("interview_sessions")
            .select("company, topic, created_at, duration_minutes, elapsed_seconds, agent_score")
            .eq("id", sessionId)
            .single(),
        ]);

        if (!cancelled) {
          if (feedbackError) {
            throw feedbackError;
          }
          if (sessionError) {
            throw sessionError;
          }
          if (feedbackData) {
            const normalizedFeedback = {
              ...feedbackData,
              question_breakdown: feedbackData.question_breakdown ?? [],
              strengths: feedbackData.strengths ?? [],
              gaps_identified: feedbackData.gaps_identified ?? [],
            };
            setFeedback(normalizedFeedback);
          } else {
            setFeedback(null);
          }
          setSessionMeta(sessionData ?? null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen max-w-6xl mx-auto px-6 py-10">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Saved Interview Feedback</h1>
          <p className="text-slate-400 mt-2">Review the AI evaluation generated after this interview session.</p>
        </div>
        <Link href="/dashboard/sessions" className="text-sm text-blue-400 hover:text-blue-300">
          ← Back to sessions
        </Link>
      </div>

      <div className="glass-card rounded-3xl border border-white/10 bg-slate-950/80 p-6">
        {loading ? (
          <div className="text-slate-400">Loading feedback…</div>
        ) : error ? (
          <div className="text-amber-300">Failed to load feedback: {error}</div>
        ) : !feedback ? (
          <div className="text-slate-400">No saved feedback was found for this session.</div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500 mb-2">Session</p>
                <p className="text-sm text-slate-300">{sessionMeta?.company ?? "Unknown company"} · {sessionMeta?.topic ?? "Unknown topic"}</p>
                <p className="text-xs text-slate-500 mt-2">{sessionMeta?.created_at ? new Date(sessionMeta.created_at).toLocaleString() : "Unknown date"}</p>
                <p className="text-xs text-slate-500">Duration: {sessionMeta?.duration_minutes ?? "-"}m</p>
                <p className="text-xs text-slate-500">Elapsed: {sessionMeta?.elapsed_seconds ? `${Math.max(1, Math.round(sessionMeta.elapsed_seconds / 60))}m` : "-"}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500 mb-2">Final score</p>
                <div className="text-4xl font-bold text-white">{feedback.overall_score}/10</div>
                <div className="mt-2 text-sm text-slate-400">Primary rating: {feedback.score}/5</div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold text-white mb-3">Overall Assessment</h2>
              <p className="text-sm text-slate-300 leading-relaxed">{feedback.justification}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Strengths</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  {(feedback.strengths?.length ?? 0) > 0
                    ? feedback.strengths.map((item, idx) => (
                        <li key={idx} className="list-disc list-inside">{item}</li>
                      ))
                    : <li>No strengths were recorded.</li>}
                </ul>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Gaps Identified</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  {(feedback.gaps_identified?.length ?? 0) > 0
                    ? feedback.gaps_identified.map((item, idx) => (
                        <li key={idx} className="list-disc list-inside">{item}</li>
                      ))
                    : <li>No gaps were recorded.</li>}
                </ul>
              </div>
            </div>

            {feedback.suggested_followup && (
              <div className="rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                <h3 className="text-sm font-semibold text-indigo-200 mb-2">Suggested Follow-Up</h3>
                <p className="text-sm text-indigo-100">{feedback.suggested_followup}</p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Introduction</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.introduction_score}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Approach</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.approach_score}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Coding</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.coding_score}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Communication</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.communication_score}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Time Complexity</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.time_complexity_accuracy}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Space Complexity</p>
                <p className="text-3xl font-semibold text-white mt-2">{feedback.space_complexity_accuracy}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Question Breakdown</h3>
              {(feedback.question_breakdown?.length ?? 0) > 0 ? (
                <div className="space-y-4">
                  {feedback.question_breakdown.map((item, index) => (
                    <div key={index} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="font-semibold text-white">{item.question_title}</p>
                        <span className={`text-[11px] font-semibold uppercase ${item.approach_correct ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {item.approach_correct ? 'Correct' : 'Needs work'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400 mb-3">
                        <span className="bg-slate-800/60 px-2 py-1 rounded">Time: {item.time_complexity}</span>
                        <span className="bg-slate-800/60 px-2 py-1 rounded">Space: {item.space_complexity}</span>
                        <span className={`px-2 py-1 rounded ${item.approach_optimal ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                          {item.approach_optimal ? 'Optimal' : 'Sub-optimal'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">{item.notes}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No per-question breakdown was generated.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
