import React, { useState } from "react";
import logoUrl from "../assets/surens-infotek-logo.png";

export interface LoginPageProps {
  onBack: () => void;
  onSuccess: () => void;
  loginEmail: string;
  loginPass: string;
}

export function LoginPage({
  onBack,
  onSuccess,
  loginEmail,
  loginPass
}: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (email.trim() === loginEmail && password === loginPass) {
      setError("");
      onSuccess();
    } else {
      setError("Email or password does not match the configured workspace login.");
    }
  };

  return (
    <main className="login-page">
      <section className="login-art">
        <img src={logoUrl} alt="Surensinfotek Logo" className="login-logo" />
        <div className="login-device">
          <span />
        </div>
        <h1>Audit sessions, evidence, and reports stay linked.</h1>
      </section>

      <section className="login-form-panel">
        <button className="text-button" onClick={onBack}>
          ← Back
        </button>
        <form className="login-form" onSubmit={handleSubmit}>
          <span className="eyebrow">Surensinfotek workspace</span>
          <h2>Sign in</h2>
          
          <label>
            <span>Email Address</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          
          <button className="primary-action" type="submit">
            Enter Workspace
          </button>
        </form>
      </section>
    </main>
  );
}
