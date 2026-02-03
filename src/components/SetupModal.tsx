"use client";

import React, { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onStart: (opts: { company: string; topic: string; duration: number; excludeTopics: string[] }) => void;
};

export default function SetupModal({ open, onClose, onStart }: Props) {
  const [company, setCompany] = useState("");
  const [excludeTopics, setExcludeTopics] = useState<string[]>([]);
  const [duration, setDuration] = useState(45);

  const TOPICS = [
    "Arrays & Hashing",
    "Two Pointers",
    "Sliding Window",
    "Dynamic Programming",
    "Graphs",
    "System Design",
  ];

  function toggleExcludeTopic(t: string) {
    setExcludeTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

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
            <option value="Google" />
            <option value="Meta" />
            <option value="Amazon" />
            <option value="Netflix" />
            <option value="Microsoft" />
          </datalist>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Exclude Topics</label>
          <div className="rounded-lg border border-white/10 bg-slate-900 p-3">
            <div className="grid grid-cols-2 gap-2">
              {TOPICS.map((t) => {
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
            <p className="mt-2 text-xs text-slate-500">Leave empty to allow any topic.</p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Duration (minutes)</label>
          <div className="grid grid-cols-4 gap-3">
            {[30,45,60,75].map((d) => (
              <label key={d} className="cursor-pointer">
                <input type="radio" name="duration" value={d} checked={duration===d} onChange={() => setDuration(d)} className="peer sr-only" />
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
              const available = TOPICS.filter((t) => !excludeTopics.includes(t));
              const chosenTopic = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : "Random";
              onStart({ company: company || "Generic", topic: chosenTopic, duration, excludeTopics });
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
