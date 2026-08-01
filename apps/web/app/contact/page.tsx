"use client";

import { useState } from "react";

const CONTACT_EMAIL = "contact@opencommunication.app";

type Phase = "idle" | "sending" | "sent" | "drafted" | "error";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");

  function mailtoHref() {
    const body = `From: ${name} <${email}>\n\n${message}`;
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject || `Message from ${name}`)}&body=${encodeURIComponent(body)}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setPhase("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();

      if (data.ok) {
        setPhase("sent");
        setMsg("Message sent — we'll get back to you at " + email);
        setName("");
        setEmail("");
        setSubject("");
        setMessage("");
        return;
      }
      if (data.configured === false) {
        // No server mail provider — open a prefilled draft instead.
        window.location.href = mailtoHref();
        setPhase("drafted");
        setMsg(`Opening your email app addressed to ${CONTACT_EMAIL}. If nothing opened, email us directly.`);
        return;
      }
      setPhase("error");
      setMsg(data.error ?? "Could not send. Please email us directly.");
    } catch {
      setPhase("error");
      setMsg("Could not reach the server. Please email us directly.");
    }
  }

  const busy = phase === "sending";

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="mono text-xs text-accent">// CONTACT</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <h1 className="mono text-2xl font-bold tracking-tight">
        <span className="gradient-text">GET IN TOUCH</span>
      </h1>
      <p className="mt-3 text-sm text-muted">
        Questions about the network, running a worker, the API, or partnerships — send us a message
        and we'll reply by email. You can also write to{" "}
        <a className="text-accent underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Name *</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" />
          </div>
          <div>
            <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Email *</label>
            <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        </div>

        <div>
          <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="what's this about?" />
        </div>

        <div>
          <label className="mono mb-1 block text-[10px] uppercase tracking-wider text-muted">Message *</label>
          <textarea
            className="input resize-y"
            required
            rows={7}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="tell us what's on your mind…"
          />
        </div>

        <div className="flex items-center gap-3">
          <button className="btn btn-accent" type="submit" disabled={busy}>
            {busy ? "SENDING…" : "SEND MESSAGE"}
          </button>
          <a className="mono text-xs text-muted underline" href={`mailto:${CONTACT_EMAIL}`}>
            or email directly
          </a>
        </div>

        {msg && (
          <div className={`mono text-xs ${phase === "error" ? "text-warn" : "text-good"}`}>
            {phase === "error" ? "⚠ " : "✓ "}
            {msg}
          </div>
        )}
      </form>

      <div className="mono mt-6 flex items-center gap-2 opacity-40">
        <span className="text-[9px]">∞</span>
        <div className="h-px flex-1 bg-white" />
        <span className="text-[9px]">0C.CONTACT</span>
      </div>
    </div>
  );
}
