"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

function dispatchToggle(mode?: string | null) {
  window.dispatchEvent(new CustomEvent("toggleAuth", { detail: mode ?? null }));
}

const BRUTE_CODE = `vector<int> twoSum(vector<int>& nums, int target) {
    for(int i = 0; i < nums.size(); i++) {
        for(int j = i + 1; j < nums.size(); j++) {
            if(nums[i] + nums[j] == target) {
                return {i, j};
            }
        }
    }
    return {};
}`;

const OPTIMAL_CODE = `vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for(int i = 0; i < nums.size(); i++) {
        if(seen.count(target - nums[i])) {
            return {seen[target - nums[i]], i};
        }
        seen[nums[i]] = i;
    }
    return {};
}`;

export default function Hero() {
  const router = useRouter();
  const [phase, setPhase] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  const highlightedLines = useMemo(() => {
    const keywords = new Set(["for", "if", "return"]);
    const types = new Set(["int", "vector", "unordered_map", "auto"]);
    const functions = new Set(["twoSum", "size", "count"]);
    const punctuation = new Set(["(", ")", "{", "}", "[", "]", ";", ",", "+", "-", "=", "<", ">", "!", "&"]);

    const code = phase < 2 ? BRUTE_CODE : OPTIMAL_CODE.slice(0, charIndex);
    const lines = code.split("\n");

    return lines.map((line, lineIndex) => {
      const tokens = line.split(/([ \t(){}[\];.,+\-=<>!&]+)/);
      const isHotPath = phase === 1 && lineIndex >= 1 && lineIndex <= 5;

      return {
        lineIndex,
        isHotPath,
        tokens: tokens.map((token, tokenIndex) => {
          const trimmed = token.trim();
          let tone = "hero-token-plain";

          if (!trimmed) {
            tone = "hero-token-plain";
          } else if (keywords.has(trimmed)) {
            tone = "hero-token-keyword";
          } else if (types.has(trimmed)) {
            tone = "hero-token-type";
          } else if (functions.has(trimmed)) {
            tone = "hero-token-function";
          } else if (/^\d+$/.test(trimmed)) {
            tone = "hero-token-number";
          } else if (punctuation.has(trimmed)) {
            tone = "hero-token-punct";
          }

          return { id: `${lineIndex}-${tokenIndex}`, token, tone };
        }),
      };
    });
  }, [charIndex, phase]);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<number>();

    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!cancelled) fn();
      }, ms);
      timers.add(id);
    };

    const runSequence = () => {
      if (cancelled) return;
      setPhase(0);
      setCharIndex(0);

      schedule(() => setPhase(1), 2200);
      schedule(() => setPhase(2), 5600);
      schedule(() => {
        setPhase(3);
        setCharIndex(OPTIMAL_CODE.length);
      }, 9800);
      schedule(runSequence, 14500);
    };

    runSequence();

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let typingInterval: number | undefined;

    if (phase === 2) {
      typingInterval = window.setInterval(() => {
        setCharIndex((prev) => {
          const next = prev + 3;
          return next >= OPTIMAL_CODE.length ? OPTIMAL_CODE.length : next;
        });
      }, 16);
    }

    return () => {
      if (typingInterval) window.clearInterval(typingInterval);
    };
  }, [phase]);

  async function handleStart() {
    try {
      if (!supabase) {
        dispatchToggle("signup");
        return;
      }
      const { data } = await supabase!.auth.getSession();
      const user = data.session?.user ?? null;
      if (!user) {
        // open signup/login overlay
        dispatchToggle("signup");
        return;
      }
      // If signed in, open the setup modal on the homepage (stay on home).
      window.dispatchEvent(new CustomEvent("openSetupModal"));
    } catch (err) {
      console.error("Error checking session before starting interview", err);
      dispatchToggle("signup");
    }
  }

  async function handleViewBank() {
    try {
      if (!supabase) {
        dispatchToggle("login");
        return;
      }
      const { data } = await supabase!.auth.getSession();
      const user = data.session?.user ?? null;
      if (!user) {
        dispatchToggle("login");
        return;
      }
      router.push("/question-bank");
    } catch (err) {
      console.error("Error checking session before viewing question bank", err);
      dispatchToggle("login");
    }
  }

  return (
    <div className="mb-24 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] items-center gap-10 lg:gap-14">
      <div className="text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-bold mb-6">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          POWERED BY AGENTIC INTELLIGENCE
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.15] md:leading-[1.08] mb-6 pb-1 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
          Master the SDE Interview <br />with an AI Agent
        </h1>

        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-10">
          Speak your logic, code in C++, and engage with an interviewer that uses real past-year questions from top tech firms.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={handleStart} className="glow-button bg-blue-600 px-8 py-4 rounded-xl text-lg font-bold">
            Start Mock Interview
          </button>
          <button onClick={handleViewBank} className="bg-slate-800 hover:bg-slate-700 px-8 py-4 rounded-xl text-lg font-bold transition">
            View Question Bank
          </button>
        </div>
      </div>

      <div className="hero-laptop-stage mx-auto" aria-hidden="true">
        <div className="hero-laptop-halo"></div>
        <div className="hero-laptop">
          <div className="hero-laptop-screen">
            <div className="hero-laptop-toolbar">
              <span></span>
              <span></span>
              <span></span>
              <div className="hero-laptop-tab">two_sum.cpp</div>
            </div>
            <div className="hero-laptop-code">
              <div className="hero-code-block">
                {highlightedLines.map((line, index) => {
                  const isLastLine = index === highlightedLines.length - 1;
                  const showCursor = phase === 2 && charIndex < OPTIMAL_CODE.length && isLastLine;

                  return (
                    <div key={line.lineIndex} className={`hero-code-row ${line.isHotPath ? "hero-code-hot" : ""}`}>
                      <span className="hero-code-number">{line.lineIndex + 1}</span>
                      <span className="hero-code-text">
                        {line.tokens.map((part) => (
                          <span key={part.id} className={part.tone}>
                            {part.token}
                          </span>
                        ))}
                        {showCursor ? <span className="hero-inline-cursor"></span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className={`hero-ai-bubble ${phase === 1 || phase === 2 ? "is-visible" : ""}`}>
                {phase === 1
                  ? "Nested loop detected: O(n^2). Try a hash map for O(n)."
                  : "Refactor in progress: Hash map lookup + single pass."}
              </div>
              <div className={`hero-terminal ${phase === 3 ? "is-open" : ""}`}>
                <span className="hero-terminal-title">All test cases passed</span>
                <span className="hero-terminal-metric">Runtime: O(n)  |  Memory: O(n)</span>
              </div>
            </div>
          </div>
          <div className="hero-laptop-base"></div>
          <div className="hero-laptop-shadow"></div>
        </div>
        <span className="hero-laptop-spark hero-laptop-spark-1"></span>
        <span className="hero-laptop-spark hero-laptop-spark-2"></span>
        <span className="hero-laptop-spark hero-laptop-spark-3"></span>
      </div>
    </div>
  );
}
