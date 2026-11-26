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
import { strongPassword } from "@/lib/auth/onboarding-policy";
import { firebaseAuth } from "@/lib/firebase/client";
import { Eye, EyeOff, Lock, Mail, ShieldCheck, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const staging = process.env.NEXT_PUBLIC_FIREBASE_MODE === "staging";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [setup, setSetup] = useState(false);
  const [newPassword,setNewPassword] = useState("");
  const [confirmPassword,setConfirmPassword] = useState("");

  async function clearClientAuth() {
    try { await signOut(firebaseAuth()); } catch { /* No usable client session. */ }
  }

  async function createSession(user: User, allowSetup=false) {
    const idToken = await user.getIdToken(true);

    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      const body=await response.json().catch(()=>null);
      if(allowSetup && response.status===403 && body?.code==="PASSWORD_SETUP_REQUIRED") {setSetup(true);return;}
      throw new Error("Session creation failed");
    }

    await signOut(firebaseAuth());
    window.location.assign("/dashboard");
  }

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (staging && email.trim().toLowerCase() !== "staging-admin@orbotriq.test") {
      setError("Only the approved staging administrator may sign in.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const auth = firebaseAuth();
      await setPersistence(auth, inMemoryPersistence);
      const result = await signInWithEmailAndPassword(auth, email, password);
      await createSession(result.user,true);
    } catch {
      await clearClientAuth();
      setError("Unable to sign in. Check your credentials or try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setMessage("");
    if(!strongPassword(newPassword)||newPassword!==confirmPassword||newPassword===password){setError("Use a different password of 12–128 characters with upper and lower case, a number and a symbol, without spaces. Confirmation must match.");return;}
    setLoading(true);
    try {
      const user=firebaseAuth().currentUser;
      if(!user)throw new Error("Sign in again.");
      const idToken=await user.getIdToken(true);
      const response=await fetch("/api/auth/onboarding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken,currentPassword:password,newPassword})});
      const body=await response.json().catch(()=>null);
      if(!response.ok){setError(body?.error||"Password setup failed. Sign in again or contact your administrator.");return;}
      await clearClientAuth();
      setSetup(false);setPassword("");setNewPassword("");setConfirmPassword("");setShowPassword(false);
      setMessage("Password setup completed. Sign in again with your new password.");
    }catch{setError("Password setup failed. Sign in again or contact your administrator.");}finally{setLoading(false);}
  }
  async function cancelSetup(){
    await clearClientAuth();
    setSetup(false);setPassword("");setNewPassword("");setConfirmPassword("");setError("");setMessage("");
  }

  async function handleGoogleLogin() {
    if (staging) { setError("Google sign-in is disabled in staging."); return; }
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const auth = firebaseAuth();
      await setPersistence(auth, inMemoryPersistence);
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await createSession(result.user);
    } catch {
      await clearClientAuth();
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (staging) { setError("Contact the staging administrator for account recovery."); return; }
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
          {setup ? <>
            <h1>Set your new password</h1>
            <p className="sub">Your workspace is locked until first-time password setup is complete.</p>
            <form onSubmit={handleSetup}>
              <label htmlFor="newPassword">New password</label>
              <div className="auth-input"><Lock size={18}/><input id="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></div>
              <label htmlFor="confirmPassword">Confirm new password</label>
              <div className="auth-input"><Lock size={18}/><input id="confirmPassword" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div>
              <p className="sub">12–128 characters, upper and lower case, number and symbol. No spaces.</p>
              {error && <div role="alert" className="auth-error">{error}</div>}
              <button className="auth-primary" disabled={loading}>{loading?"Please wait...":"Complete password setup"}<ArrowRight size={18}/></button>
              <button type="button" className="auth-reset" disabled={loading} onClick={cancelSetup}>Cancel and sign in again</button>
            </form>
          </> : <>
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

          </>}
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
