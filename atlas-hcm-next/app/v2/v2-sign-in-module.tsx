"use client";

import { Building2, Loader2, LockKeyhole, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { atlasLogin, atlasPublicBase } from "../../lib/atlas-api";
import { saveSession } from "./v2-session";
import styles from "./v2-shell.module.css";

type LoginForm = {
  company: string;
  username: string;
  password: string;
  remember: boolean;
};

type Props = {
  onSignedIn: () => void;
};

export default function V2SignInModule({ onSignedIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [loginForm, setLoginForm] = useState<LoginForm>({
    company: "ATLAS",
    username: "",
    password: "",
    remember: true
  });

  useEffect(() => {
    const companyCode = loginForm.company.trim();
    if (!companyCode) {
      setLogoUrl("");
      return;
    }

    let cancelled = false;
    let revokeUrl = "";
    setLogoUrl("");

    fetch(`${atlasPublicBase()}/public/companies/${encodeURIComponent(companyCode)}/logo`)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        revokeUrl = URL.createObjectURL(blob);
        setLogoUrl(revokeUrl);
      })
      .catch(() => setLogoUrl(""));

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [loginForm.company]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const session = await atlasLogin(loginForm.username.trim(), loginForm.password);
      saveSession(session, "");
      setMessage(`Signed in as ${session.user.fullName}. Opening the V2 workspace now.`);
      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.moduleStack}>
      <section className={styles.authHero}>
        <div className={styles.authHeroCopy}>
          <p>Step 7 authentication slice</p>
          <h1>Sign in to open the V2 workspace.</h1>
          <span>
            This shell now signs in directly against the same ATLAS backend on port 3355. Once your session is valid, Overview and Employees load the same live data contracts already used by the legacy application.
          </span>
          <div className={styles.authTrustRow}>
            <div className={styles.authTrustItem}>
              <ShieldCheck size={18} />
              <span>Existing backend contract preserved</span>
            </div>
            <div className={styles.authTrustItem}>
              <Sparkles size={18} />
              <span>Theme choice remains available before and after sign-in</span>
            </div>
          </div>
        </div>
        <div className={styles.authStateCard}>
          <div className={styles.authLogoWrap}>
            {logoUrl ? <img src={logoUrl} alt={`${loginForm.company} logo`} className={styles.authLogoImage} /> : <Building2 size={26} />}
          </div>
          <strong>Session required</strong>
          <span>Use your existing ATLAS account to continue into the rebuilt shell.</span>
          <small>Company code is used for branding preview and future multi-company entry flow.</small>
        </div>
      </section>

      <section className={styles.authPanel}>
        <div className={styles.panelTitle}>
          <LockKeyhole size={18} />
          <span>ATLAS sign-in</span>
        </div>

        <form className={styles.authFormGrid} onSubmit={handleSubmit}>
          <label className={styles.authField}>
            <span>Company code</span>
            <div className={styles.authInputWrap}>
              <Building2 size={18} />
              <input
                value={loginForm.company}
                onChange={(event) => setLoginForm((current) => ({ ...current, company: event.target.value.toUpperCase() }))}
                placeholder="ATLAS"
                autoComplete="organization"
                data-testid="v2-login-company"
              />
            </div>
          </label>

          <label className={styles.authField}>
            <span>Username</span>
            <div className={styles.authInputWrap}>
              <UserRound size={18} />
              <input
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="Enter username"
                autoComplete="username"
                data-testid="v2-login-username"
              />
            </div>
          </label>

          <label className={styles.authField}>
            <span>Password</span>
            <div className={styles.authInputWrap}>
              <LockKeyhole size={18} />
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter password"
                autoComplete="current-password"
                data-testid="v2-login-password"
              />
            </div>
          </label>

          <label className={styles.authRememberRow}>
            <input
              type="checkbox"
              checked={loginForm.remember}
              onChange={(event) => setLoginForm((current) => ({ ...current, remember: event.target.checked }))}
            />
            <span>Keep this browser signed in for the normal session window</span>
          </label>

          {message ? (
            <div
              className={`${styles.authMessage} ${message.toLowerCase().includes("signed in") ? styles.authMessageSuccess : styles.authMessageError}`}
              role="status"
              data-testid="v2-login-message"
            >
              {message}
            </div>
          ) : null}

          <div className={styles.authActionRow}>
            <button type="submit" className={styles.primaryActionButton} disabled={busy} data-testid="v2-login-submit">
              {busy ? <Loader2 size={16} className={styles.spinningIcon} /> : <LockKeyhole size={16} />}
              <span>{busy ? "Signing in..." : "Sign in"}</span>
            </button>
            <div className={styles.authFootnote}>
              The shell keeps Light Professional as the default theme, while all user theme choices stay available after sign-in.
            </div>
          </div>
        </form>
      </section>
    </section>
  );
}
