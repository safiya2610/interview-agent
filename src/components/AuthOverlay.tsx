"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function AuthOverlay() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  // Local email/password state + validation for the overlay
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onToggle(e: any) {
      setVisible(Boolean(e.detail));
      setMode(e.detail === "signup" ? "signup" : "login");
    }

    window.addEventListener("toggleAuth", onToggle as EventListener);
    return () => window.removeEventListener("toggleAuth", onToggle as EventListener);
  }, []);

  if (!visible) return null;

  async function handleOAuth(provider: "google" | "github") {
    if (!supabase) return setMessage("Supabase not initialized.");
    // Redirect back to the account page after OAuth completes
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/account` : undefined;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  }

  const emailRegex = /^\S+@\S+\.\S+$/;

  async function handleSignIn() {
    setMessage("");
    if (!email) return setMessage("Email is required.");
    if (!emailRegex.test(email)) return setMessage("Invalid email address.");
    if (!password) return setMessage("Password is required.");
    if (!supabase) return setMessage("Supabase not initialized.");

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      console.log("[AuthOverlay] signIn result", { data, error });
      setLoading(false);
      if (error) return setMessage(error.message || "Sign in failed");
      // success
      close();
      router.push("/account");
    } catch (err) {
      setLoading(false);
      console.error("[AuthOverlay] signIn exception", err);
      setMessage(String((err as any)?.message ?? err));
    }
  }

  async function handleSignUp() {
    setMessage("");
    const fullName = name.trim();
    if (!email) return setMessage("Email is required.");
    if (!emailRegex.test(email)) return setMessage("Invalid email address.");
    if (!password) return setMessage("Password is required.");
    if (!fullName) return setMessage("Please provide your full name.");
    if (!supabase) return setMessage("Supabase not initialized.");

    setLoading(true);
    try {
      // Pass the user's name into user metadata on signup so we can show it in profile
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      console.log("[AuthOverlay] signUp result", { data, error });
      setLoading(false);
      if (error) return setMessage(error.message || "Sign up failed");
      // If we have an active session (some projects auto-sign-in), update the user's metadata
      // so `full_name` is reliably available. If signUp didn't produce a session (email confirm flow),
      // the metadata may be set server-side or require confirmation — notify user.
      try {
        if ((data as any)?.session) {
          // update user metadata explicitly to ensure full_name is set
          await supabase.auth.updateUser({ data: { full_name: fullName } });
        }
      } catch (err) {
        console.warn("Could not update user metadata after signUp", err);
      }

      close();
      if ((data as any)?.session) {
        // refresh session and redirect to dashboard
        await supabase.auth.getSession();
        router.push("/account");
      } else {
        setMessage("Check your email for a confirmation link (if enabled).");
      }
    } catch (err) {
      setLoading(false);
      console.error("[AuthOverlay] signUp exception", err);
      setMessage(String((err as any)?.message ?? err));
    }
  }

  function close() {
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={close}></div>
      <div className="relative w-full max-w-md glass-card rounded-3xl p-8 shadow-2xl overflow-hidden border border-white/10">
        <div className="flex gap-6 mb-8 border-b border-white/5">
          <button onClick={() => setMode("login")} className={`pb-2 text-sm font-bold uppercase tracking-wider ${mode === "login" ? "tab-active" : "text-slate-500"}`}>Log In</button>
          <button onClick={() => setMode("signup")} className={`pb-2 text-sm font-bold uppercase tracking-wider ${mode === "signup" ? "tab-active" : "text-slate-500"}`}>Sign Up</button>
        </div>

        <div>
          <h2 className="text-2xl font-bold mb-2">{mode === "login" ? "Welcome Back" : "Create Account"}</h2>
          <p className="text-slate-400 text-sm mb-6">{mode === "login" ? "Enter your credentials to access your sessions." : "Start your first mock interview in seconds."}</p>

          <div className="space-y-3">
            <button onClick={() => handleOAuth("google")} className="w-full flex items-center justify-center gap-3 bg-white text-black font-bold py-3 rounded-xl hover:bg-slate-200 transition">
              Continue with Google
            </button>
            {/* GitHub OAuth temporarily disabled */}
            {/**
            <button onClick={() => handleOAuth("github")} className="w-full flex items-center justify-center gap-3 bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-700 transition">
              Continue with GitHub
            </button>
            */}
          </div>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-white/5"></div>
            <span className="px-3 text-xs text-slate-500 uppercase font-bold">or email</span>
            <div className="flex-1 border-t border-white/5"></div>
          </div>

          <div className="space-y-4">
            {mode === "signup" && (
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full bg-slate-900 border border-white/10 text-white p-3 px-4 rounded-xl focus:outline-none focus:border-blue-500 transition" />
            )}
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email Address" className="w-full bg-slate-900 border border-white/10 text-white p-3 px-4 rounded-xl focus:outline-none focus:border-blue-500 transition" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" className="w-full bg-slate-900 border border-white/10 text-white p-3 px-4 rounded-xl focus:outline-none focus:border-blue-500 transition" />
            <button onClick={mode === "login" ? handleSignIn : handleSignUp} disabled={loading} className="w-full glow-button bg-blue-600 text-white font-bold py-3 rounded-xl mt-4">{loading ? "Please wait..." : "Continue"}</button>
            {message && <p className="text-sm text-yellow-300 mt-2">{message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
