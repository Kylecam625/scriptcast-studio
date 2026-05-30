"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, Loader2, Waves } from "lucide-react";

export function UnlockForm() {
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await unlock();
  }

  async function unlock() {
    const code = accessCode.trim();
    if (!code || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Unable to unlock ScriptCast Studio.");
      }

      window.location.assign(nextPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to unlock ScriptCast Studio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="unlock-shell">
      <form className="unlock-card" onSubmit={submit}>
        <div className="unlock-brand">
          <span className="brand-mark" aria-hidden="true">
            <Waves size={22} strokeWidth={2.4} />
          </span>
          <span>ScriptCast Studio</span>
        </div>
        <div className="unlock-icon" aria-hidden="true">
          <LockKeyhole size={24} />
        </div>
        <h1>Enter access code</h1>
        <input
          autoComplete="current-password"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="go"
          inputMode="text"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void unlock();
            }
          }}
          onChange={(event) => setAccessCode(event.target.value)}
          placeholder="Access code"
          spellCheck={false}
          type="text"
          value={accessCode}
        />
        {error ? <div className="alert">{error}</div> : null}
        <button className="primary-button" disabled={busy || !accessCode.trim()} type="submit">
          {busy ? <Loader2 className="spin" size={17} /> : null}
          Unlock
        </button>
      </form>
    </main>
  );
}

function nextPath() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}
