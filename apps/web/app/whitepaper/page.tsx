import { TOKEN, formatSupply } from "@0c/credits";

export const metadata = {
  title: "Open Communication — Whitepaper",
};

const HUES = [162, 190, 265, 320, 45, 100];

const FLOW = [
  { label: "Worker (serves the job)", pct: 70, hue: 162 },
  { label: "Stakers", pct: 10, hue: 265 },
  { label: "Protocol → buyback & burn", pct: 20, hue: 320 },
];

const COMPARE: Array<[string, "y" | "n" | "p", "y" | "n" | "p", "y" | "n" | "p"]> = [
  ["Uncensored inference", "y", "n", "y"],
  ["Prompts never logged", "y", "n", "p"],
  ["E2E human messaging", "y", "n", "n"],
  ["Runs on contributed GPUs", "y", "n", "y"],
  ["Native token / ownership", "y", "n", "p"],
  ["No account gate", "y", "n", "y"],
];

const USE_CASES = [
  ["Uncensored research", "Ask anything; no refusal layer, no prompt logs."],
  ["Private team comms + AI", "Encrypted DMs and model access on one identity."],
  ["Image generation", "Create images priced per-render, served by the network."],
  ["Agents & tools", "Build on the OpenAI-compatible API with your dev token."],
  ["Monetize idle GPUs", "Contribute compute from a tab or native worker and earn."],
  ["Censorship-resistant access", "Owned by no one; no single party can revoke you."],
];

const FAQ = [
  ["Is $0C live?", "No. Credits and on-chain ETH/USDT deposits are live; the $0C token is a published design and is not yet minted or tradeable."],
  ["How is my privacy protected?", "Prompts and generated media are never stored — only billing is. Direct messages are encrypted on your device; the relay only ever sees ciphertext."],
  ["What stops a worker from faking results?", "Canary probes, coherence, and throughput checks. Enforcement (slashing) activates once economic stake is attached."],
  ["Do I need crypto to use it?", "No. You can use credits directly. Crypto is the on-ramp and ownership layer, not a requirement to chat or message."],
];

function Mark({ v }: { v: "y" | "n" | "p" }) {
  if (v === "y") return <span className="text-accent">✓</span>;
  if (v === "p") return <span className="text-warn">~</span>;
  return <span className="text-muted/50">✗</span>;
}

const LIFECYCLE = [
  ["CONNECT", "A worker opens a WebSocket to the orchestrator and authenticates."],
  ["REGISTER", "It advertises the models and capabilities (chat, image, …) it serves."],
  ["ROUTE", "The orchestrator sends each job to the fastest idle capable worker (EMA tok/s)."],
  ["SERVE", "The worker streams tokens or returns media; results relay to the caller."],
  ["SETTLE", "Credits settle to the real cost; the worker earns its 70% share."],
];

const THREATS: Array<[string, string]> = [
  ["Worker returns garbage or a wrong model", "Canary probes + coherence/throughput checks; earnings slashed once economic stake is attached."],
  ["Worker tries to identify a user", "The worker receives only text — never identity; prompts are not persisted. Confidential compute is on the roadmap."],
  ["Man-in-the-middle on the key directory", "Safety-number fingerprints let peers verify keys out-of-band; key transparency planned."],
  ["Replayed deposit signature", "Idempotent — a transaction signature can credit exactly once."],
  ["Claiming someone else's deposit", "A memo binds each payment to the paying user's account."],
  ["Orchestrator reading messages", "It can't — messaging is a blind relay; only ciphertext is stored/forwarded."],
  ["Price-feed manipulation", "Cached feed with a fixed fallback; a redundant on-chain oracle (Pyth) is planned."],
  ["Concurrent double-spend of credits", "Balance check + reserve run in a single atomic transaction."],
];

const SCHEDULE: Array<[string, string, string]> = [
  ["Ecosystem & Community", "40%", "5% at TGE, remainder on milestones"],
  ["Worker Rewards", "25%", "Decaying emissions over ~4 years"],
  ["Team & Contributors", "15%", "1-year cliff, then linear over 4 years"],
  ["Treasury / DAO", "12%", "Governed unlocks"],
  ["Liquidity", "5%", "100% at TGE"],
  ["Public / Airdrop", "3%", "At TGE / campaign"],
];

const GLOSSARY: Array<[string, string]> = [
  ["Orchestrator", "The stateful service that routes jobs, tracks credits, and blind-relays messages."],
  ["Worker", "A contributed GPU (native or browser) that serves inference and earns."],
  ["Credit", "The stable unit of account; 1 credit = $0.01."],
  ["$0C", "The network's fixed-supply (1B) token — ownership, staking, and settlement layer."],
  ["Reserve → settle", "Credits are held before a job and finalized to the real cost after."],
  ["Blind relay", "The server forwards encrypted messages without ever seeing plaintext."],
  ["Reward-per-share", "O(1) accounting that splits staking rewards fairly regardless of timing."],
  ["Buyback & burn", "Protocol fees repurchase and destroy $0C, reducing supply."],
  ["Pipeline-parallel", "Splitting one large model across several machines to serve it cooperatively."],
];

function Section({ tag, title, children }: { tag: string; title: string; children: React.ReactNode }) {
  return (
    <section className="py-8">
      <div className="mb-4 flex items-center gap-3">
        <span className="mono text-xs text-accent">// {tag}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <h2 className="mono mb-3 text-lg font-semibold tracking-wide">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function WhitepaperPage() {
  return (
    <div className="mx-auto max-w-3xl py-10">
      {/* header */}
      <div className="relative card p-8">
        <span className="corner corner-tl !h-5 !w-5" />
        <span className="corner corner-br !h-5 !w-5" />
        <div className="mono mb-2 text-xs tracking-widest text-muted">WHITEPAPER · v0.1 · DRAFT</div>
        <h1 className="mono text-3xl font-bold tracking-tight">
          <span className="gradient-text">OPEN COMMUNICATION</span>
        </h1>
        <p className="mt-3 text-sm text-muted">
          Compute and conversation, owned by no one. Uncensored AI inference and end-to-end
          encrypted messaging on contributed GPUs — powered by <b className="text-fg">{TOKEN.ticker}</b>,
          a fixed supply of {formatSupply()} on {TOKEN.chain}.
        </p>
      </div>

      <Section tag="ABSTRACT" title="One network, two ways to talk">
        <p>
          AI today is centralized: prompts are logged, models are filtered, access can be revoked.
          Private messaging is fragmented. Open Communication unifies both on one network. A thin
          orchestrator routes work to contributed GPUs and blind-relays encrypted messages; users pay
          in credits; the people who provide compute earn the majority of what they serve. No single
          party owns the network, sees your prompts, or reads your messages.
        </p>
      </Section>

      <Section tag="ARCHITECTURE" title="Orchestrator + contributed workers">
        <p>
          A Next.js app and OpenAI-compatible API sit in front of a stateful WebSocket orchestrator.
          It queues jobs, routes each to the fastest idle worker, reserves credits before dispatch,
          streams results back, and settles on completion. For messaging it is a <b className="text-fg">blind
          relay</b> — it stores and forwards ciphertext only. Contributors run a native or browser
          WebGPU worker advertising the models and capabilities they serve.
        </p>
        <pre className="scroll-thin overflow-x-auto rounded border border-border bg-black/40 p-4 text-[11px] text-muted">{`Browser / API ──wss──▶ Orchestrator ◀──wss── GPU workers
                         │ routing · credits · blind relay
                         └ ledger · key directory · msg store`}</pre>
      </Section>

      <Section tag="ECONOMICS" title="Credits — the stable unit">
        <p>
          Credits are the unit of account: <b className="text-fg">1 credit = $0.01</b>. Chat is priced
          per 1K tokens by model; images are flat-priced. Credits are reserved before a job and settled
          to the real cost (refunded on failure) via an atomic reserve→settle→refund ledger. Workers
          earn <b className="text-fg">70%</b> of what they serve; a <b className="text-fg">10%</b> fee on
          each job flows to stakers. Credits are bought with ETH or USDT through an on-chain
          verified deposit into your own per-account address, at the live ETH/USD rate.
        </p>
      </Section>

      {/* TOKEN */}
      <Section tag="TOKEN" title={`${TOKEN.ticker} — the ownership layer`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Ticker", TOKEN.ticker],
            ["Supply", formatSupply()],
            ["Chain", TOKEN.chain],
            ["Model", "fixed · no inflation"],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <div className="mono text-[10px] uppercase tracking-wider text-muted">{k}</div>
              <div className="mono mt-1 text-lg font-semibold text-fg">{v}</div>
            </div>
          ))}
        </div>

        <p className="pt-2">
          {TOKEN.ticker} is an <b className="text-fg">ERC-20</b> token on Ethereum. It buys credits, is staked to
          earn protocol fees and boost worker priority, settles worker earnings, and governs protocol
          parameters. Protocol margin funds the treasury, and a
          share of revenue <b className="text-fg">buys back and burns</b> {TOKEN.ticker} — against a
          fixed {formatSupply()} supply, real usage creates continuous deflationary pressure.
        </p>


        {/* allocation bar */}
        <div className="pt-2">
          <div className="mono mb-2 text-[10px] uppercase tracking-wider text-muted">
            Proposed allocation · {formatSupply()} total
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded border border-border">
            {TOKEN.allocation.map((a, i) => (
              <div
                key={a.label}
                style={{ width: `${a.pct}%`, background: `hsl(${HUES[i % HUES.length]} 70% 55%)` }}
                title={`${a.label} — ${a.pct}%`}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {TOKEN.allocation.map((a, i) => (
              <div key={a.label} className="flex items-center gap-2 text-xs text-muted">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: `hsl(${HUES[i % HUES.length]} 70% 55%)` }}
                />
                <span className="flex-1">{a.label}</span>
                <span className="mono text-fg">{a.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section tag="RESERVE" title="Treasury &amp; payouts">
        <p>
          Deposits (ETH/USDT) and protocol margin accrue to the treasury as a
          <b className="text-fg"> reserve held in ETH</b>. Withdrawals pay out in <b className="text-fg">ETH</b>
          at the live oracle price, automatically and within per-request and daily caps.
        </p>
        <p>
          Crucially, the reserve is <b className="text-fg">not</b> backed by {TOKEN.ticker} itself.
          Backing user redemptions with a volatile, self-issued token invites a reflexive
          bank-run/insolvency spiral, so {TOKEN.ticker} accrues value the safe way — through
          fee-funded <b className="text-fg">buyback-and-burn</b> — while redemptions are always covered
          by real ETH.
        </p>
      </Section>

      <Section tag="STAKING" title="Reward-per-share">
        <p>
          Staking uses accumulated-reward-per-share accounting. Each settled job's fee raises a global
          reward index in proportion to total stake; a staker's claimable reward is their stake times
          the index change since they last interacted — exact, O(1), and independent of when they
          staked. Stake, unstake, and claim are atomic.
        </p>
      </Section>

      <Section tag="PRIVACY" title="Encrypted by construction">
        <p>
          Direct messages are encrypted on-device with X25519 + XChaCha20-Poly1305; private keys never
          leave the device and the relay handles only ciphertext, including store-and-forward for
          offline recipients. Prompts and generated media are never persisted — only billing is.
        </p>
        <p>
          <b className="text-fg">One documented exception.</b> Formally-verified mathematics is served
          by <b className="text-fg">Harmonic&apos;s Aristotle</b>, an external API. When you select the
          verified-math model — or an agent calls the <code className="mono text-accent">verified_math</code>{" "}
          tool — that problem is transmitted to a third party under their terms, and is therefore not
          covered by the guarantees above. Every such step is labelled{" "}
          <span className="text-warn">⚠ leaves network</span> in the interface. All other inference runs
          on contributed GPUs inside the network.
        </p>
      </Section>

      <Section tag="VALUE FLOW" title="Where each credit goes">
        <p>
          Every credit spent on a job splits deterministically at settlement — the worker that did the
          work takes the majority, stakers share a slice, and the remainder is protocol margin used to
          buy back and burn {TOKEN.ticker}.
        </p>
        <div className="pt-2">
          <div className="flex h-4 w-full overflow-hidden rounded border border-border">
            {FLOW.map((f) => (
              <div key={f.label} style={{ width: `${f.pct}%`, background: `hsl(${f.hue} 70% 55%)` }} title={`${f.label} — ${f.pct}%`} />
            ))}
          </div>
          <div className="mt-3 space-y-1">
            {FLOW.map((f) => (
              <div key={f.label} className="flex items-center gap-2 text-xs text-muted">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: `hsl(${f.hue} 70% 55%)` }} />
                <span className="flex-1">{f.label}</span>
                <span className="mono text-fg">{f.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section tag="COMPARISON" title="How 0_C differs">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="mono text-[11px] uppercase tracking-wider text-muted">
                <th className="border-b border-border py-2 text-left font-normal">Property</th>
                <th className="border-b border-border px-3 py-2 text-center font-normal text-accent">0_C</th>
                <th className="border-b border-border px-3 py-2 text-center font-normal">Centralized AI</th>
                <th className="border-b border-border px-3 py-2 text-center font-normal">Inference-only</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r[0]}>
                  <td className="border-b border-border/50 py-2 text-muted">{r[0]}</td>
                  <td className="border-b border-border/50 px-3 py-2 text-center"><Mark v={r[1]} /></td>
                  <td className="border-b border-border/50 px-3 py-2 text-center"><Mark v={r[2]} /></td>
                  <td className="border-b border-border/50 px-3 py-2 text-center"><Mark v={r[3]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mono pt-2 text-[11px] text-muted/70">✓ yes · ~ partial/varies · ✗ no</p>
      </Section>

      <Section tag="TOKEN FLOW" title="Emissions & vesting">
        <p>
          {TOKEN.ticker} has a fixed {formatSupply()} supply and no inflation. Worker-reward emissions
          (25%) are released from a reserve on a decaying schedule that front-loads early contributors
          and tapers over time. Team &amp; contributor allocations (15%) vest linearly over four years
          with a one-year cliff. Community, treasury, and liquidity unlock against milestones. Because
          supply is capped, sustained fee-driven buyback-and-burn works against a fixed ceiling.
        </p>
      </Section>

      <Section tag="GOVERNANCE" title="Owned by holders">
        <p>
          As the network decentralizes, {TOKEN.ticker} holders govern the parameters that matter — fee
          rates, the worker earn share, model policy, treasury spend, and reward emissions — through
          on-chain proposals and voting. The goal is credible neutrality: no single operator can
          censor a model, revoke a user, or unilaterally change the economics.
        </p>
      </Section>

      <Section tag="USE CASES" title="What people build">
        <div className="grid gap-3 sm:grid-cols-2">
          {USE_CASES.map(([t, b]) => (
            <div key={t} className="card p-4">
              <div className="mono text-sm font-semibold text-fg">{t}</div>
              <div className="mt-1 text-xs text-muted">{b}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tag="DEVELOPERS" title="OpenAI-compatible API">
        <p>Point any OpenAI client at the orchestrator; your token is the API key.</p>
        <pre className="scroll-thin overflow-x-auto rounded border border-border bg-black/40 p-4 text-[11px] leading-relaxed text-muted">{`curl $ORCH/v1/chat/completions \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"llama3.2",
       "messages":[{"role":"user","content":"hello"}],
       "stream":true}'`}</pre>
      </Section>

      <Section tag="FAQ" title="Common questions">
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <div key={q} className="card p-4">
              <div className="mono text-sm font-semibold text-fg">{q}</div>
              <div className="mt-1 text-sm text-muted">{a}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tag="NETWORK" title="Worker lifecycle">
        <p>Every worker follows the same loop, so the orchestrator treats browser tabs and datacenter GPUs identically:</p>
        <div className="space-y-2 pt-1">
          {LIFECYCLE.map(([t, b], i) => (
            <div key={t} className="flex gap-3">
              <span className="mono w-6 shrink-0 text-accent">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <span className="mono text-sm font-semibold text-fg">{t}</span>
                <span className="text-sm text-muted"> — {b}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section tag="SCALING" title="Models too big for one GPU">
        <p>
          Some models exceed any single contributor's memory. 0_C's roadmap serves them with
          <b className="text-fg"> pipeline-parallel</b> inference: a transformer is split into contiguous
          layer blocks spread across a cohort of machines, with speculative decoding to hide
          wide-area latency. To the caller it is one job; under the hood a coordinated group of
          workers serves it together and shares the reward.
        </p>
      </Section>

      <Section tag="THREAT MODEL" title="What could go wrong, and why it can't">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="mono text-[11px] uppercase tracking-wider text-muted">
                <th className="border-b border-border py-2 text-left font-normal">Threat</th>
                <th className="border-b border-border py-2 pl-4 text-left font-normal text-accent">Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {THREATS.map(([t, m]) => (
                <tr key={t} className="align-top">
                  <td className="border-b border-border/50 py-2 pr-4 text-fg">{t}</td>
                  <td className="border-b border-border/50 py-2 pl-4 text-muted">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tag="SCHEDULE" title={`${TOKEN.ticker} distribution & unlocks`}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="mono text-[11px] uppercase tracking-wider text-muted">
                <th className="border-b border-border py-2 text-left font-normal">Allocation</th>
                <th className="border-b border-border px-3 py-2 text-right font-normal">Share</th>
                <th className="border-b border-border py-2 pl-4 text-left font-normal">Unlock</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULE.map(([a, p, u]) => (
                <tr key={a}>
                  <td className="border-b border-border/50 py-2 text-fg">{a}</td>
                  <td className="mono border-b border-border/50 px-3 py-2 text-right text-accent">{p}</td>
                  <td className="border-b border-border/50 py-2 pl-4 text-muted">{u}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mono pt-2 text-[11px] text-muted/70">TGE = token generation event · proposed, subject to change</p>
      </Section>

      <Section tag="GLOSSARY" title="Terms">
        <dl className="grid gap-3 sm:grid-cols-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} className="card p-4">
              <dt className="mono text-sm font-semibold text-fg">{term}</dt>
              <dd className="mt-1 text-xs text-muted">{def}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section tag="STATUS" title="What's live vs designed">
        <p>
          Streaming chat, image generation, encrypted messaging, the credit ledger, staking, and
          on-chain ETH/USDT deposits are <b className="text-fg">live</b>. The {TOKEN.ticker} token in the
          token section is a <b className="text-fg">design specification</b> — not yet minted or
          tradeable. Nothing here is an offer to sell a security or investment advice; token parameters
          are proposals subject to change before any launch.
        </p>
        <p className="mono pt-2 text-xs">
          Full document: <span className="text-accent">WHITEPAPER.md</span> in the repository.
        </p>
      </Section>
    </div>
  );
}
