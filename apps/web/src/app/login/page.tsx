"use client";

import { useState, type FormEvent } from "react";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  setPersistence,
  inMemoryPersistence,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { Eye, EyeOff, Lock, Mail, ShieldCheck, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function createSession(user: User) {
    const idToken = await user.getIdToken(true);

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      throw new Error("Session creation failed");
    }

    await signOut(firebaseAuth());
    window.location.assign("/dashboard");
  }

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const auth = firebaseAuth();
      await setPersistence(auth, inMemoryPersistence);
      const result = await signInWithEmailAndPassword(auth, email, password);
      await createSession(result.user);
    } catch {
      setError("Unable to sign in. Check your credentials or try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const auth = firebaseAuth();
      await setPersistence(auth, inMemoryPersistence);
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await createSession(result.user);
    } catch {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }

    setLoading(true);

    try {
      await sendPasswordResetEmail(firebaseAuth(), email);
      setMessage("If an account exists, a reset email will be sent.");
    } catch {
      setMessage("If an account exists, a reset email will be sent.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          ORB<span>O</span>TRIQ
        </div>
        <p className="auth-tagline">
          THE DIGITAL GROWTH OPERATING SYSTEM
        </p>

        <section className="auth-card">
          <h1>Welcome back</h1>
          <p className="sub">Sign in to your Orbotriq workspace.</p>

          <form onSubmit={handleEmailLogin}>
            <label htmlFor="email">Email address</label>
            <div className="auth-input">
              <Mail size={18} />
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <label htmlFor="password">Password</label>
            <div className="auth-input">
              <Lock size={18} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button
              className="auth-reset"
              type="button"
              disabled={loading}
              onClick={handleResetPassword}
            >
              Forgot password?
            </button>

            {error && <div role="alert" className="auth-error">{error}</div>}
            {message && <div role="status" className="auth-message">{message}</div>}

            <button className="auth-primary" disabled={loading}>
              {loading ? "Please wait..." : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>

          <div className="auth-divider">OR</div>

          <button
            className="auth-google"
            disabled={loading}
            onClick={handleGoogleLogin}
          >
            <strong style={{color:"#4285F4",fontSize:20}}>G</strong>
            Continue with Google
          </button>

          <div className="auth-security">
            <ShieldCheck size={16} /> Secure workspace access
          </div>
        </section>

        <p className="auth-footer">
          Copyright 2026 Orbotriq. All rights reserved.
        </p>
      </div>
    </main>
  );
}
