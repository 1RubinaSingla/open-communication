import Link from "next/link";
import { Hero } from "@/components/ui/hero";

const PILLARS = [
  {
    tag: "01",
    title: "UNCENSORED INFERENCE",
    body: "OpenAI-compatible API with no refusal layer and no prompt logging. Your prompts aren't stored — only billing is.",
  },
  {
    tag: "02",
    title: "PRIVATE BY CONSTRUCTION",
    body: "Direct messages are end-to-end encrypted with X25519 + XChaCha20. The relay only ever sees ciphertext.",
  },
  {
    tag: "03",
    title: "DECENTRALIZED & REWARDED",
    body: "Contribute a GPU from a browser tab or a native worker and earn 70% of the credits your work serves.",
  },
];

/**
 * A real, publicly viewable verified run from the network. Swap in a newer one
 * by pasting its Aristotle transcript URL (the "view reasoning" link in chat).
 */
const PROOF_SHOWCASE = {
  runId: "dcac4a4c",
  title: "Relay privacy, machine-checked",
  prompt:
    "Formalise the relay-privacy property of the Open Communication network: model the sealed message, the relay's observation, and prove the relay's view is independent of the plaintext.",
  theorem: "OpenCommunication.relay_privacy",
  claims: [
    "any two plaintexts produce identical relay views for fixed visible parameters",
    "every deterministic observer using only that view returns the same result",
    "for distinct messages, no view-only reconstruction function can be correct for both",
  ],
  assumption:
    "an explicit FreshSealPlaintextIndependent idealisation, stated as a hypothesis — not claimed as a property of ordinary deterministic AEAD",
  proofUrl: "/proof/dcac4a4c",
  transcriptUrl: "https://aristotle.harmonic.fun/dashboard/requests/e33ca845-ca6d-4942-8f8d-119ba54715f8",
};

const FLOW = [
  ["YOU SEND", "A prompt or an encrypted DM leaves your device."],
  ["ORCHESTRATOR", "Reserves credits, routes to the fastest idle worker — or blind-relays your ciphertext."],
  ["WORKER RUNS IT", "A contributed GPU streams tokens back in real time."],
  ["SETTLED", "Credits debit on completion; the worker earns its share."],
];

export default function Landing() {
  return (
    <div>
      <Hero />

      {/* pillars */}
      <section className="mx-auto max-w-5xl py-20">
        <div className="mb-8 flex items-center gap-3">
          <span className="mono text-xs text-accent">// PILLARS</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.tag} className="card group relative p-6 transition-colors hover:border-[color:var(--border-strong)]">
              <div className="mono mb-4 text-xs text-accent">{p.tag}</div>
              <h3 className="mono text-sm font-semibold tracking-wide text-fg">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-5xl py-8">
        <div className="mb-8 flex items-center gap-3">
          <span className="mono text-xs text-accent">// MESSAGE.FLOW</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {FLOW.map(([t, b], i) => (
            <div key={t} className="card relative p-5">
              <div className="mono absolute -top-2.5 left-4 bg-black px-1 text-xs text-accent">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="mono mt-2 text-xs font-semibold tracking-wide text-fg">{t}</div>
              <div className="mt-2 text-sm text-muted">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* public proof — a real, independently viewable verified run */}
      <section className="mx-auto mt-20 max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="mono text-xs text-accent">// VERIFIED IN PUBLIC</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="card p-6">
          <h3 className="mono text-base font-semibold tracking-wide text-fg">
            {PROOF_SHOWCASE.title}
          </h3>
          <p className="mt-2 text-sm text-muted">
            Not a claim — a receipt. We asked the network to formalise our own privacy property and
            prove it. It was checked by machine, not asserted by a chatbot, and the whole trail is
            public: every command, every file edit, the build, and the final check for{" "}
            <code className="mono text-accent">sorry</code> or{" "}
            <code className="mono text-accent">admit</code>.
          </p>

          <div className="mt-4 text-xs text-muted">
            <span className="mono text-fg">prompt · </span>
            {PROOF_SHOWCASE.prompt}
          </div>

          <div className="mono mt-3 rounded border border-border bg-black/40 p-4 text-[12px] text-fg">
            theorem <span className="text-accent">{PROOF_SHOWCASE.theorem}</span>
          </div>

          <ul className="mt-3 space-y-1 text-sm text-muted">
            {PROOF_SHOWCASE.claims.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-good">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted/80">
            <span className="mono text-warn">assumes · </span>
            {PROOF_SHOWCASE.assumption}. It proves the model, not the running code — and the
            verification was performed by Harmonic&apos;s Aristotle, orchestrated and attested by us.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="pill !text-good">✓ formally verified · Lean 4 · no axioms</span>
            <Link className="btn btn-accent" href={PROOF_SHOWCASE.proofUrl} style={{ textTransform: "none" }}>
              Signed proof · run {PROOF_SHOWCASE.runId} ↗
            </Link>
            <a
              className="btn btn-ghost"
              href={PROOF_SHOWCASE.transcriptUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textTransform: "none" }}
            >
              Full reasoning transcript ↗
            </a>
          </div>
        </div>
      </section>

      {/* differentiator */}
      <section className="mx-auto my-20 max-w-3xl">
        <div className="card p-8 text-center">
          <h2 className="mono text-xl font-semibold tracking-wide">BEYOND A COMPUTE NETWORK</h2>
          <p className="mt-4 text-muted">
            Other decentralized-inference projects stop at chat. Open Communication puts private human
            messaging on the same rails — one identity, one connection, one economy — with a roadmap to
            image, voice, and video generation, agents, and pipeline-parallel serving for models too
            big for any single GPU.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/chat" className="btn btn-primary">
              OPEN THE APP
            </Link>
            <Link href="/dashboard" className="btn btn-ghost">
              VIEW DASHBOARD
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl border-t border-border py-8 text-center">
        <div className="mb-4 flex justify-center gap-3">
          <a
            href="https://x.com/O_C_"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ textTransform: "none" }}
          >
            𝕏 @O_C_
          </a>
          <Link href="/contact" className="btn btn-ghost">
            CONTACT
          </Link>
        </div>
        <div className="mono text-[10px] tracking-widest text-muted">
          OPEN COMMUNICATION · 0_C.PROTOCOL · EST.2026 · OWNED BY NO ONE
        </div>
      </footer>
    </div>
  );
}
