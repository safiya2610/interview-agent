"use client";

import Nav from "../components/Nav";
import Hero from "../components/Hero";
import Features from "../components/Features";
import Preview from "../components/Preview";
import Footer from "../components/Footer";
import AuthOverlay from "../components/AuthOverlay";
import SetupModal from "../components/SetupModal";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type DepthTokenStyle = CSSProperties & {
  "--drift-x": string;
  "--drift-y": string;
  "--token-rotation": string;
  "--token-opacity": string;
  "--token-start-scale": string;
  "--token-end-scale": string;
  "--token-start-blur": string;
  "--token-end-blur": string;
  "--token-start-z": string;
  "--token-end-z": string;
};

export default function Page() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const depthTerms = useMemo(() => {
    const randomFromSeed = (seed: number) => {
      const x = Math.sin(seed * 9999.91) * 10000;
      return x - Math.floor(x);
    };

    const interviewTerms = [
      "O(n^2)",
      "O(n log n)",
      "O(log n)",
      "O(1)",
      "Complexity",
      "Time",
      "Space",
      "Big-O",
      "TLE",
      "WA",
      "RE",
      "MLE",
      "AC",
      "Pass",
      "WA",
      "Edge",
      "DFS",
      "BFS",
      "DP",
      "Greedy",
      "Heap",
      "Trie",
      "UnionFind",
      "Backtrack",
      "BinarySearch",
      "PrefixSum",
      "TwoPointers",
      "SlidingWindow",
      "Heap",
    ];

    const rows = 12;
    const cols = 14;
    const totalTerms = rows * cols;

    return Array.from({ length: totalTerms }, (_, index) => {
      const seed = index + 1;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const depth = randomFromSeed(seed * 9.17);
      const termIndex = Math.floor(randomFromSeed(seed * 8.29) * interviewTerms.length);
      const cellLeft = ((col + 0.5) / cols) * 100;
      const cellTop = ((row + 0.5) / rows) * 100;
      const jitterX = (randomFromSeed(seed * 1.13) - 0.5) * (96 / cols);
      const jitterY = (randomFromSeed(seed * 2.17) - 0.5) * (82 / rows);
      const left = Math.min(98, Math.max(2, cellLeft + jitterX));
      const top = Math.min(97, Math.max(3, cellTop + jitterY));

      const fontSize = 8.8 + depth * 6.3;
      const duration = 9.6 + randomFromSeed(seed * 4.11) * 11.4;
      const delay = randomFromSeed(seed * 5.31) * -20;
      const outwardX = (left - 50) * 0.34;
      const outwardY = (top - 50) * 0.24;
      const driftX = -46 + randomFromSeed(seed * 6.53) * 92 + outwardX;
      const driftY = -42 + randomFromSeed(seed * 7.61) * 84 + outwardY;
      const rotation = -10 + randomFromSeed(seed * 3.19) * 20;
      const opacity = 0.2 + depth * 0.28;
      const startScale = 0.2 + depth * 0.16;
      const endScale = 0.95 + depth * 0.45;
      const startBlur = 1.8 - depth * 1.0;
      const endBlur = 0.22 + (1 - depth) * 0.55;
      const startZ = -930 + depth * 210;
      const endZ = 90 + depth * 140;

      return {
        id: `term-${index}`,
        label: interviewTerms[termIndex],
        left,
        top,
        fontSize,
        duration,
        delay,
        driftX,
        driftY,
        rotation,
        opacity,
        startScale,
        endScale,
        startBlur,
        endBlur,
        startZ,
        endZ,
      };
    });
  }, []);

  useEffect(() => {
    function onOpen() {
      setModalOpen(true);
    }
    window.addEventListener("openSetupModal", onOpen as EventListener);
    return () => window.removeEventListener("openSetupModal", onOpen as EventListener);
  }, []);

  function handleStart(opts: { company: string; topic: string; duration: number }) {
    // navigate to dashboard with params so the dashboard can start the session
    const q = new URLSearchParams();
    q.set("company", opts.company);
    q.set("topic", opts.topic);
    q.set("duration", String(opts.duration));
    router.push(`/dashboard?${q.toString()}`);
  }

  return (
    <>
      <Nav />
      <main id="landing-page" className="relative pt-32">
        <div className="depth-term-field pointer-events-none" aria-hidden="true">
          {depthTerms.map((term) => {
            const style: DepthTokenStyle = {
              left: `${term.left}%`,
              top: `${term.top}%`,
              fontSize: `${term.fontSize}px`,
              animationDuration: `${term.duration}s`,
              animationDelay: `${term.delay}s`,
              "--drift-x": `${term.driftX}px`,
              "--drift-y": `${term.driftY}px`,
              "--token-rotation": `${term.rotation}deg`,
              "--token-opacity": `${term.opacity}`,
              "--token-start-scale": `${term.startScale}`,
              "--token-end-scale": `${term.endScale}`,
              "--token-start-blur": `${term.startBlur}px`,
              "--token-end-blur": `${term.endBlur}px`,
              "--token-start-z": `${term.startZ}px`,
              "--token-end-z": `${term.endZ}px`,
            };

            return (
              <span key={term.id} className="depth-term-token" style={style}>
                {term.label}
              </span>
            );
          })}
        </div>
        <div className="hero-gradient absolute inset-0 pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <section className="mb-24">
            <Hero />
          </section>

          <section>
            <Features />
          </section>

          <section>
            <Preview />
          </section>

          <section>
            <Footer />
          </section>
        </div>
      </main>
      <AuthOverlay />
      <SetupModal open={modalOpen} onClose={() => setModalOpen(false)} onStart={handleStart} />
    </>
  );
}
