"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function AuthStatus() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!supabase) return;
      const { data } = await supabase!.auth.getSession();
      if (!mounted) return;
      setUser(data.session?.user ?? null);
    }

    load();

    let listener: any = null;
    if (supabase) {
      const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      listener = data;
    }

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase!.auth.signOut();
    router.push("/");
  };

  function initialsFromEmail(email: string | undefined) {
    if (!email) return "U";
    const name = email.split("@")[0];
    const parts = name.split(/[._-]/).filter(Boolean);
    if (parts.length === 0) return name.charAt(0).toUpperCase();
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  return (
    <div className="relative">
      {user ? (
        <div className="relative group">
          <button className="flex items-center gap-3 hover:bg-white/5 p-1.5 rounded-full pr-3 transition">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold ring-2 ring-slate-900 text-white">{initialsFromEmail(user.email)}</div>
            <span className="text-sm font-medium text-slate-300 hidden sm:block">{user.email?.split("@")[0]}</span>
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
          </button>

          <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-white/10 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right z-50">
            <div className="p-2">
              <Link href="/account" className="block px-4 py-2 text-sm text-slate-300 hover:bg-white/5 rounded-lg">View Profile</Link>
              <Link href="/dashboard" className="block px-4 py-2 text-sm text-slate-300 hover:bg-white/5 rounded-lg flex justify-between items-center">
                Dashboard (History)
                <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-full">12</span>
              </Link>
              <div className="h-[1px] bg-white/5 my-1"></div>
              <button onClick={handleSignOut} className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg">Sign Out</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
