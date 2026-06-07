"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { InterviewFeedback } from "../lib/feedback-schema";

interface FeedbackModalProps {
  feedback: InterviewFeedback | null;
  feedbackId: string | null;
  sessionId: string | null;
  isLoading: boolean;
  onClose: () => void;
}

function ScoreRing({
  score,
  max = 5,
  label,
  size = 80,
  color = "#6366f1",
}: {
  score: number;
  max?: number;
  label: string;
  size?: number;
  color?: string;
}) {
  const [animated, setAnimated] = useState(0);
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = animated / max;
  const offset = circumference * (1 - pct);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(score), 100);
    return () => clearTimeout(t);
  }, [score]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Track */}
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold" style={{ fontSize: size * 0.22 }}>
            {score}/{max}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-slate-400 text-center leading-tight font-medium">
        {label}
      </span>
    </div>
  );
}

function OverallRing({ score }: { score: number }) {
  const [animated, setAnimated] = useState(0);
  const size = 140;
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const pct = animated / 10;
  const offset = circumference * (1 - pct);

  const getColor = (s: number) => {
    if (s >= 8) return "#22c55e";
    if (s >= 6) return "#3b82f6";
    if (s >= 4) return "#f59e0b";
    return "#ef4444";
  };

  useEffect(() => {
    const t = setTimeout(() => setAnimated(score), 200);
    return () => clearTimeout(t);
  }, [score]);

  const color = getColor(score);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={70} cy={70} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
        <circle
          cx={70}
          cy={70}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s ease-out", filter: `drop-shadow(0 0 8px ${color}80)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black text-white">{score}</span>
        <span className="text-xs text-slate-400 font-medium">/10</span>
      </div>
    </div>
  );
}

const SUB_SCORES = [
  { key: "introduction_score", label: "Introduction", color: "#8b5cf6" },
  { key: "approach_score", label: "Approach", color: "#06b6d4" },
  { key: "coding_score", label: "Code Quality", color: "#22c55e" },
  { key: "communication_score", label: "Communication", color: "#f59e0b" },
  { key: "time_complexity_accuracy", label: "Time Complexity", color: "#ec4899" },
  { key: "space_complexity_accuracy", label: "Space Complexity", color: "#6366f1" },
] as const;

export default function FeedbackModal({
  feedback,
  feedbackId,
  sessionId,
  isLoading,
  onClose,
}: FeedbackModalProps) {
  const [tab, setTab] = useState<"overview" | "details">("overview");

  if (!isLoading && !feedback) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}>
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 flex flex-col"
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
          boxShadow: "0 25px 80px rgba(99,102,241,0.25), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Interview Feedback Report</h2>
              <p className="text-xs text-slate-400">AI-generated evaluation based on your full interview</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 animate-pulse" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.698-1.338 2.698H4.136c-1.368 0-2.338-1.698-1.338-2.698L4 15.3" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white mb-1">Analyzing your interview...</p>
              <p className="text-sm text-slate-400">Gemini is reviewing your conversation, code, and approach</p>
            </div>
            <div className="flex items-center gap-2">
              {["Introduction", "Approach", "Code Quality", "Communication"].map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <div className="text-xs text-slate-500 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }}>
                    {step}
                  </div>
                  {i < 3 && <div className="w-3 h-px bg-slate-700" />}
                </div>
              ))}
            </div>
          </div>
        ) : feedback ? (
          <>
            {/* Overall score hero */}
            <div className="px-6 py-8 flex flex-col items-center gap-4 border-b border-white/5">
              <OverallRing score={feedback.overall_score} />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-300 mb-1">
                  {feedback.overall_score >= 8
                    ? "🌟 Outstanding Performance"
                    : feedback.overall_score >= 6
                    ? "✅ Good Performance"
                    : feedback.overall_score >= 4
                    ? "⚠️ Needs Improvement"
                    : "❌ Significant Gaps Identified"}
                </p>
                <p className="text-xs text-slate-400 mb-2">Primary candidate rating: {feedback.score}/5</p>
                {feedback.time_complexity && (
                  <div className="flex items-center justify-center gap-4 mt-2">
                    <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300 px-3 py-1 rounded-full font-mono">
                      Time: {feedback.time_complexity}
                    </span>
                    <span className="text-xs bg-purple-500/10 border border-purple-500/20 text-purple-300 px-3 py-1 rounded-full font-mono">
                      Space: {feedback.space_complexity}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-white/5 px-6">
              {(["overview", "details"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-3 text-sm font-semibold capitalize transition border-b-2 ${
                    tab === t
                      ? "border-indigo-500 text-indigo-400"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {tab === "overview" && (
              <div className="p-6 space-y-6">
                {/* Sub-score rings */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Score Breakdown</h3>
                  <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                    {SUB_SCORES.map(({ key, label, color }) => (
                      <ScoreRing
                        key={key}
                        score={(feedback as any)[key] ?? 0}
                        max={5}
                        label={label}
                        size={80}
                        color={color}
                      />
                    ))}
                  </div>
                </div>

                {/* Justification */}
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Overall Assessment</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{feedback.justification}</p>
                </div>

                {/* Strengths & Gaps side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                    <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Strengths
                    </h3>
                    <ul className="space-y-2">
                      {(feedback.strengths || []).map((s, i) => (
                        <li key={i} className="text-xs text-green-300 flex items-start gap-2">
                          <span className="text-green-500 mt-0.5 shrink-0">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Areas to Improve
                    </h3>
                    <ul className="space-y-2">
                      {(feedback.gaps_identified || []).map((g, i) => (
                        <li key={i} className="text-xs text-amber-300 flex items-start gap-2">
                          <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Suggested follow-up */}
                {feedback.suggested_followup && (
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                    <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Practice This Next
                    </h3>
                    <p className="text-sm text-indigo-300 italic">"{feedback.suggested_followup}"</p>
                  </div>
                )}
              </div>
            )}

            {/* Details tab */}
            {tab === "details" && (
              <div className="p-6 space-y-4">
                {(feedback.question_breakdown || []).length > 0 ? (
                  <>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question-by-Question Breakdown</h3>
                    {feedback.question_breakdown.map((q, i) => (
                      <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-white">{q.question_title}</h4>
                          <div className="flex gap-2 shrink-0">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${q.approach_correct ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                              {q.approach_correct ? "Correct" : "Wrong"} Approach
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${q.approach_optimal ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400"}`}>
                              {q.approach_optimal ? "Optimal" : "Sub-optimal"}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-mono">
                            Time: {q.time_complexity}
                          </span>
                          <span className="text-xs bg-purple-500/10 border border-purple-500/20 text-purple-300 px-2 py-0.5 rounded font-mono">
                            Space: {q.space_complexity}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{q.notes}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <p>No per-question breakdown available.</p>
                  </div>
                )}
              </div>
            )}

            {/* Footer actions */}
            <div className="sticky bottom-0 px-6 py-4 border-t border-white/5 flex items-center justify-between gap-3"
              style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)" }}>
              <p className="text-xs text-slate-500">This report is saved and accessible anytime from your dashboard.</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition"
                >
                  Close
                </button>
                {sessionId && (
                  <Link
                    href={`/dashboard/sessions/${sessionId}/feedback`}
                    className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                  >
                    View Full Report →
                  </Link>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
