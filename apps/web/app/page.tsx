import Link from "next/link";
import { Hero } from "@/components/ui/hero";
import { FlowDiagram } from "@/components/ui/flow-diagram";
import { ProofTerminal } from "@/components/ui/proof-terminal";
import { Marquee, Reveal, SectionHeading, SpotlightCard } from "@/components/ui/motion";

/** The stack in the terms people actually search for. */
const STACK = [
  "LEAN 4",
  "HARMONIC ARISTOTLE",
  "MACHINE-CHECKED PROOF",
  "X25519",
  "XCHACHA20-POLY1305",
  "ED25519 ATTESTATION",
  "BLIND RELAY",
  "SOLANA",
  "PYTH ORACLE",
  "OLLAMA",
  "WEBGPU",
  "SOCKET.IO",
  "ZOD WIRE PROTOCOL",
  "ATOMIC CREDIT LEDGER",
  "OPENAI-COMPATIBLE API",
  "AGENTS + TOOL USE",
];

const PILLARS = [
  {
    tag: "01",
    title: "UNCENSORED INFERENCE",
    body: "OpenAI-compatible API with no refusal layer and no prompt logging. Your prompts aren't stored — only billing is.",
  },
  {
    tag: "02",
    title: "PRIVATE BY CONSTRUCTION",
    body: "Direct messages are sealed on your device with X25519 + XChaCha20-Poly1305. The relay only ever handles ciphertext.",
  },
  {
    tag: "03",
    title: "PROVABLE, NOT PLAUSIBLE",
    body: "Ask for a theorem and you get a Lean 4 proof checked by machine — then signed with ed25519 so anyone can verify it came from us.",
  },
  {
    tag: "04",
    title: "DECENTRALIZED & REWARDED",
    body: "Contribute a GPU from a browser tab or a native worker and earn 70% of the credits your work serves.",
  },
];

type Status = "LIVE" | "BUILT" | "SOON";

const CAPABILITIES: { name: string; detail: string; status: Status }[] = [
  { name: "Streaming chat", detail: "contributed GPUs · Ollama + browser WebGPU", status: "LIVE" },
  { name: "Encrypted DMs", detail: "sealed box · offline store-and-forward", status: "LIVE" },
  { name: "Verified maths", detail: "Harmonic Aristotle · Lean 4 · no axioms", status: "LIVE" },
  { name: "Signed provenance", detail: "ed25519 attestation · public /proof pages", status: "LIVE" },
  { name: "Agents + tools", detail: "web search · calculator · verified_math", status: "LIVE" },
  { name: "Image generation", detail: "worker-served, same credit rails", status: "LIVE" },
  { name: "OpenAI-compatible API", detail: "/v1/chat/completions · streaming", status: "LIVE" },
  { name: "Solana deposits", detail: "SOL + USDC · memo-bound · Pyth-priced", status: "LIVE" },
  { name: "Credit staking", detail: "reward-per-share accounting", status: "LIVE" },
  { name: "SOL withdrawals", detail: "capped by deposits + earnings", status: "BUILT" },
  { name: "X bot /prove", detail: "$0C holder gate · buyback-and-burn", status: "SOON" },
  { name: "Pipeline-parallel", detail: "models too big for one GPU · anti-cheat", status: "SOON" },
];

const STATUS_STYLE: Record<Status, string> = {
  LIVE: "!text-good",
  BUILT: "!text-warn",
  SOON: "",
};

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
  transcriptUrl:
    "https://aristotle.harmonic.fun/dashboard/requests/e33ca845-ca6d-4942-8f8d-119ba54715f8",
};

const FLOW = [
  ["YOU SEND", "A prompt or an encrypted DM leaves your device."],
  [
    "ORCHESTRATOR",
    "Reserves credits, routes to the fastest idle worker — or blind-relays your ciphertext.",
  ],
  ["WORKER RUNS IT", "A contributed GPU streams tokens back in real time."],
  ["SETTLED", "Credits debit on completion; the worker earns its share."],
];

const ECONOMY = [
  {
    k: "CREDITS",
    v: "1 credit = $0.01",
    d: "Reserved before a job dispatches and settled on completion, inside one atomic transaction. No double-spend, no negative balances.",
  },
  {
    k: "EARN",
    v: "70% to the worker",
    d: "Whoever serves the tokens keeps the majority of what the work is worth. Contribute from a browser tab or a native worker.",
  },
  {
    k: "DEPOSIT",
    v: "SOL + USDC",
    d: "Non-custodial and idempotent: payments carry a memo binding them to your account, priced by the Pyth oracle and verified on-chain.",
  },
  {
    k: "$0C",
    v: "1B supply",
    d: "Gates holder-only features like the X bot's /prove, and funds buyback-and-burn. A published design — not yet minted or tradeable.",
  },
];

export default function Landing() {
  return (
    <div>
      <Hero />

      {/* stack ticker — the buzzwords, moving */}
      <section className="-mx-4 border-y border-border bg-black/40 py-3">
        <Marquee duration={52}>
          {STACK.map((s) => (
            <span key={s} className="chip">
              <span className="text-accent">▪</span>
              {s}
            </span>
          ))}
        </Marquee>
      </section>

      {/* pillars */}
      <section id="pillars" className="mx-auto max-w-5xl scroll-mt-20 py-20">
        <SectionHeading label="PILLARS" right="04" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.tag} delay={i * 70}>
              <SpotlightCard className="card h-full p-6">
                <div className="mono mb-4 text-xs text-accent">{p.tag}</div>
                <h3 className="mono text-sm font-semibold tracking-wide text-fg">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{p.body}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* what the network can actually do */}
      <section id="capabilities" className="mx-auto max-w-5xl scroll-mt-20 py-8">
        <SectionHeading label="CAPABILITIES" right="LIVE · BUILT · SOON" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.name} delay={(i % 3) * 60}>
              <SpotlightCard className="card flex h-full items-start justify-between gap-3 p-4">
                <div>
                  <div className="mono text-[13px] font-semibold text-fg">{c.name}</div>
                  <div className="mono mt-1 text-[11px] leading-relaxed text-muted">{c.detail}</div>
                </div>
                <span className={`pill shrink-0 !text-[9px] ${STATUS_STYLE[c.status]}`}>
                  {c.status}
                </span>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* the differentiator, explained then demonstrated */}
      <section id="proof" className="mx-auto mt-20 max-w-5xl scroll-mt-20">
        <SectionHeading label="PROOF, NOT VIBES" right="HARMONIC ARISTOTLE" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <h2 className="mono text-2xl font-semibold leading-snug tracking-tight text-fg">
              Most AI answers are <span className="text-muted">plausible</span>.
              <br />
              These are <span className="gradient-text">proved</span>.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A language model that sounds certain is still guessing. So for mathematics we
              don&apos;t ask a model to be convincing — we route the problem to{" "}
              <span className="text-fg">Harmonic&apos;s Aristotle</span>, which writes the argument
              in <span className="text-fg">Lean 4</span>, a proof assistant that refuses to compile
              anything that doesn&apos;t follow. If it builds clean, with no{" "}
              <code className="mono text-accent">sorry</code>, no{" "}
              <code className="mono text-accent">admit</code> and no new axioms, the result is a
              fact, not an opinion.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Then we go one step further: every such run is stamped with a{" "}
              <span className="text-fg">run marker</span> and signed with{" "}
              <span className="text-fg">ed25519</span>. The published proof page verifies that
              signature <span className="text-fg">in your browser</span> — you never have to take our
              word for it.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["LEAN 4", "NO AXIOMS", "ED25519 SIGNED", "BROWSER-VERIFIED"].map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-muted/80">
              <span className="mono text-warn">⚠ one documented exception · </span>
              Aristotle is an external API, so selecting that model sends the problem to a third
              party. Every such step is labelled{" "}
              <span className="mono text-warn">leaves network</span> in the interface. Everything
              else runs inside the network.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <ProofTerminal />
          </Reveal>
        </div>
      </section>

      {/* public proof — a real, independently viewable verified run */}
      <section id="verified" className="mx-auto mt-16 max-w-5xl scroll-mt-20">
        <SectionHeading label="VERIFIED IN PUBLIC" right={`RUN ${PROOF_SHOWCASE.runId}`} />
        <Reveal>
          <SpotlightCard className="card p-6">
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
              verification was performed by Harmonic&apos;s Aristotle, orchestrated and attested by
              us.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="pill !text-good">✓ formally verified · Lean 4 · no axioms</span>
              <Link
                className="btn btn-accent"
                href={PROOF_SHOWCASE.proofUrl}
                style={{ textTransform: "none" }}
              >
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
          </SpotlightCard>
        </Reveal>
      </section>

      {/* topology */}
      <section id="topology" className="mx-auto mt-20 max-w-5xl scroll-mt-20">
        <SectionHeading label="NETWORK.TOPOLOGY" right="ONE SERVER · TWO PROTOCOLS" />
        <Reveal>
          <div className="card scanlines p-4 sm:p-6">
            <div className="scroll-thin overflow-x-auto">
              <div className="min-w-[640px]">
                <FlowDiagram />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-5xl py-16">
        <SectionHeading label="MESSAGE.FLOW" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map(([t, b], i) => (
            <Reveal key={t} delay={i * 80}>
              <SpotlightCard className="card relative h-full p-5">
                <div className="mono absolute -top-2.5 left-4 bg-black px-1 text-xs text-accent">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="mono mt-2 text-xs font-semibold tracking-wide text-fg">{t}</div>
                <div className="mt-2 text-sm text-muted">{b}</div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* economy */}
      <section id="economy" className="mx-auto max-w-5xl scroll-mt-20 pb-8">
        <SectionHeading label="THE ECONOMY" right="CREDITS · EARN · $0C" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ECONOMY.map((e, i) => (
            <Reveal key={e.k} delay={i * 70}>
              <SpotlightCard className="card h-full p-5">
                <div className="mono text-[10px] tracking-widest text-accent">{e.k}</div>
                <div className="mono mt-2 text-lg font-semibold text-fg">{e.v}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted">{e.d}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* differentiator */}
      <section className="mx-auto my-20 max-w-3xl">
        <Reveal>
          <SpotlightCard className="card p-8 text-center">
            <h2 className="mono text-xl font-semibold tracking-wide">BEYOND A COMPUTE NETWORK</h2>
            <p className="mt-4 text-muted">
              Other decentralized-inference projects stop at chat. Open Communication puts private
              human messaging on the same rails — one identity, one connection, one economy — and
              adds something none of them have: answers you can{" "}
              <span className="text-fg">check</span>, signed and machine-verified.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/chat" className="btn btn-primary">
                OPEN THE APP
              </Link>
              <Link href="/whitepaper" className="btn btn-ghost">
                READ THE WHITEPAPER
              </Link>
              <Link href="/dashboard" className="btn btn-ghost">
                VIEW DASHBOARD
              </Link>
            </div>
          </SpotlightCard>
        </Reveal>
      </section>

      <footer className="mx-auto max-w-5xl border-t border-border py-8 text-center">
        <div className="mb-4 flex flex-wrap justify-center gap-3">
          <a
            href="https://x.com/O_C_"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ textTransform: "none" }}
          >
            𝕏 @O_C_
          </a>
          <a
            href="https://github.com/1RubinaSingla/open-communication"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ textTransform: "none" }}
          >
            ◧ Source
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
