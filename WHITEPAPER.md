# Open Communication (0_C) — Whitepaper

**Version 0.1 · Draft**

> Compute and conversation, owned by no one.

Open Communication is a decentralized network for **uncensored AI inference** and
**end-to-end encrypted human messaging**, served on GPUs that people contribute
rather than corporate data centers. It is powered by **$0C**, a fixed-supply
token of **1,000,000,000** units on Solana.

---

## 1. Abstract

Today's AI is centralized: prompts are logged, models are filtered, and access
can be revoked. Private messaging is fragmented across walled gardens. Open
Communication unifies both on one network. A thin orchestrator routes work to
contributed GPUs and blind-relays encrypted messages; users pay in credits; the
people who provide compute earn the majority of what they serve. No single party
owns the network, sees your prompts, or reads your messages.

## 2. The problem

- **Censorship & surveillance.** Centralized providers log prompts, apply refusal
  layers, and gate access behind accounts.
- **Rent extraction.** Compute is rented from a handful of clouds at a markup.
- **Fragmented, non-private comms.** Messaging lives in silos; "private" often
  means "private from everyone except the platform."

## 3. Design principles

1. **Uncensored** — no model-level refusal layer; only illegal content is blocked.
2. **Private** — prompts and images are not persisted; direct messages are
   end-to-end encrypted and the relay only ever sees ciphertext.
3. **Decentralized** — inference runs on contributed GPUs; settlement is on-chain.
4. **Comms-first** — human messaging and machine inference share one identity,
   one connection, and one economy. This is what sets 0_C apart from
   inference-only networks.

## 4. Architecture

```
 Browser / API ──https/wss──▶  Orchestrator  ◀──wss── Contributed GPU workers
                                   │  (routing, credits, blind comms relay)
                                   └─ ledger + key directory + message store
```

- **Web + API** — a Next.js app plus an OpenAI-compatible REST API. Chat, image
  creation, encrypted messaging, staking, and a credits dashboard.
- **Orchestrator** — a stateful WebSocket service. It queues jobs, routes each to
  the fastest idle worker, reserves credits before dispatch, streams results
  back, and settles on completion. For messaging it is a **blind relay**: it
  stores and forwards ciphertext only.
- **Workers** — contributors run a native worker (e.g. Ollama-backed) or a
  browser WebGPU worker. Each advertises the models and capabilities (chat,
  image, …) it serves and earns for the work it completes.
- **Protocol** — a single shared, typed wire schema for every message, so client,
  orchestrator, and workers cannot drift.

Roadmap adds **pipeline-parallel serving** so models too large for any single GPU
can be split across a cohort of machines.

## 5. Two surfaces

- **Inference.** Chat and image generation via contributed GPUs. New capabilities
  (voice, video, agents/tool-use) are added as new worker capabilities and result
  frames — no re-architecture.
- **Messaging.** 1:1 direct messages encrypted on-device with X25519 key
  agreement and XChaCha20-Poly1305. Public keys live in a directory; private keys
  never leave the device. The orchestrator relays and store-and-forwards
  ciphertext for offline recipients. A safety-number fingerprint lets peers detect
  a tampered key directory.

## 6. Economics: credits

Credits are the network's **stable unit of account**: **1 credit = $0.01**.

- **Pricing.** Chat is priced per 1K tokens by model; images are a flat per-image
  cost. Credits are reserved before a job runs and settled to the real cost on
  completion (refunded on failure) — an atomic reserve→settle→refund ledger that
  makes overspend and double-spend impossible.
- **Worker earn share.** Workers receive **70%** of the credits a job they serve
  is worth.
- **Staking fee.** A slice of every settled job (currently **10%** of the charge)
  flows from protocol margin to the staking rewards pool.
- **On-ramp.** Credits are purchased with SOL through a **non-custodial** deposit:
  the user pays the treasury with a memo binding the payment to their account; the
  orchestrator verifies the transaction on-chain (finalized on mainnet) and
  credits them. Conversion uses a live SOL/USD price feed. Each transaction
  signature can credit only once.

## 7. The $0C token

$0C is the network's native token and ownership layer.

| | |
|---|---|
| **Ticker** | `$0C` |
| **Chain** | Solana (pump.fun) |
| **Total supply** | **1,000,000,000** (fixed — no inflation) |
| **Decimals** | 6 |

**Reserve model.** Withdrawals pay out in **SOL** from a treasury reserve held in
SOL, fed by deposits and by $0C **creator-reward fees** on pump.fun. The reserve
is deliberately **not** backed by $0C itself — backing redemptions with a
volatile self-issued token invites a reflexive insolvency spiral, so $0C accrues
value via fee-funded **buyback-and-burn** while redemptions stay covered by real
SOL.

### Utility

- **Buy credits.** $0C can be used to purchase credits alongside SOL/USDC.
- **Stake.** Stake $0C (and, today, credits) to earn a share of protocol fees and
  to boost worker earn priority.
- **Worker settlement.** Worker earnings accrue in credits and can be settled to
  $0C / USDC.
- **Governance.** $0C holders steer protocol parameters (fee rates, model policy,
  treasury use) as the network decentralizes.

### Value accrual

A share of protocol fees is used to **buy back and burn** $0C. Against a fixed 1B
supply, sustained network usage creates continuous deflationary pressure — value
flows from real inference and messaging demand, not emissions alone.

### Proposed allocation

| Allocation | Share |
|---|---|
| Ecosystem & Community | 40% |
| Worker Rewards (emissions) | 25% |
| Team & Contributors (4-year vest) | 15% |
| Treasury / DAO | 12% |
| Liquidity | 5% |
| Public / Airdrop | 3% |

### Credits ↔ $0C

Credits stay pegged at $0.01 for predictable pricing; $0C floats. Users may hold
$0C for upside and governance while spending credits for stable, legible costs.
The two are bridged by the credit purchase and worker-settlement paths.

## 8. Staking

Staking uses the standard **accumulated-reward-per-share** method. When a job
settles, its staking fee increases a global reward index in proportion to total
stake; each staker's claimable reward is their stake times the index change since
they last interacted. Rewards are exact, O(1) to compute, and independent of when
each participant staked. Stake, unstake, and claim are atomic; unstaking returns
principal immediately.

## 9. Trust & anti-cheat (roadmap)

Workers are held honest by canary probes (known prompt → expected-shape output),
coherence checks, and throughput validation. Verification runs in log-only mode
first; once economic stake is attached, misbehavior is penalized by slashing
accrued earnings and quarantining the worker.

## 10. Roadmap

- **Phase 0 — Walking skeleton.** Streaming chat, credit ledger, OpenAI-compatible
  API, E2E direct messages. ✅
- **Phase 1 — Productionize.** Wallet auth, persistent datastore, worker health,
  reconnection/resume, dashboards. ✅ (in progress)
- **Phase 2 — Multimodal.** Image ✅ → voice → video.
- **Phase 3 — Agents / tool-use.**
- **Phase 4 — Crypto layer.** On-chain SOL deposits ✅, staking ✅, $0C token,
  buyback-and-burn, USDC worker payouts.
- **Phase 5 — Anti-cheat enforcement.**
- **Phase 6 — Pipeline-parallel serving** of very large models.
- **Phase 7 — Group messaging & forward secrecy** (Double Ratchet, sender keys).

## 11. Security & privacy

- Prompts and generated media are not persisted; only billing is.
- **One documented exception:** formally-verified mathematics is served by
  **Harmonic's Aristotle**, an external API. Selecting the verified-math model,
  or an agent calling the `verified_math` tool, transmits that problem to a third
  party under their terms — so it is not covered by the guarantees above. Every
  such step is labelled "⚠ leaves network" in the interface. All other inference
  runs on contributed GPUs inside the network.
- Messages are encrypted on-device; the relay handles ciphertext only.
- Deposits are non-custodial and idempotent; mainnet verification requires
  finalized confirmations.
- Custody of the treasury and any future token authorities is isolated from the
  orchestrator process.

## 12. Value flow — where each credit goes

Every credit spent on a job splits deterministically at settlement:

| Recipient | Share |
|---|---|
| Worker that served the job | 70% |
| Stakers (rewards pool) | 10% |
| Protocol margin → buyback & burn $0C | 20% |

Worker earnings accrue in credits and can be settled to $0C / USDC; the staking
slice is distributed by reward-per-share; the protocol margin funds the
buyback-and-burn that removes $0C from circulation.

## 13. How 0_C differs

| Property | 0_C | Centralized AI | Inference-only networks |
|---|---|---|---|
| Uncensored inference | ✓ | ✗ | ✓ |
| Prompts never logged | ✓ | ✗ | ~ |
| End-to-end human messaging | ✓ | ✗ | ✗ |
| Runs on contributed GPUs | ✓ | ✗ | ✓ |
| Native token / ownership | ✓ | ✗ | ~ |
| No account gate | ✓ | ✗ | ✓ |

The differentiator is combining **private human messaging** with decentralized
inference on one identity, connection, and economy.

## 14. Emissions & vesting

$0C supply is fixed at 1,000,000,000 with no inflation. Worker-reward emissions
(25%) release from a reserve on a decaying schedule that front-loads early
contributors and tapers over time. Team & contributor allocations (15%) vest
linearly over four years with a one-year cliff. Community, treasury, and
liquidity unlock against milestones. Sustained fee-driven buyback-and-burn works
against a fixed ceiling.

## 15. Governance

As the network decentralizes, $0C holders govern the parameters that matter — fee
rates, worker earn share, model policy, treasury spend, and emissions — via
on-chain proposals and voting. The goal is credible neutrality: no single
operator can censor a model, revoke a user, or unilaterally change the economics.

## 16. Use cases

- **Uncensored research** — no refusal layer, no prompt logs.
- **Private team comms + AI** — encrypted DMs and model access on one identity.
- **Image generation** — priced per render, served by the network.
- **Agents & tools** — build on the OpenAI-compatible API with a dev token.
- **Monetize idle GPUs** — contribute compute from a tab or native worker.
- **Censorship-resistant access** — owned by no one; access can't be revoked.

## 17. Developer quickstart

Point any OpenAI client at the orchestrator; your token is the API key:

```bash
curl $ORCH/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

`GET /v1/models` lists available models (tagged `chat` or `image`).

## 18. FAQ

**Is $0C live?** No — credits and on-chain SOL deposits are live; the $0C token is
a published design, not yet minted or tradeable.

**How is privacy protected?** Prompts and generated media are never stored (only
billing is); messages are encrypted on-device and the relay sees only ciphertext.

**What stops a worker from faking results?** Canary probes, coherence, and
throughput checks; enforcement (slashing) activates once stake is attached.

**Do I need crypto to use it?** No — you can use credits directly. Crypto is the
on-ramp and ownership layer, not a requirement to chat or message.

## 19. Worker lifecycle

Every worker — a browser tab or a datacenter GPU — follows the same loop, so the
orchestrator treats them identically:

1. **Connect** — open a WebSocket and authenticate.
2. **Register** — advertise models and capabilities (chat, image, …).
3. **Route** — the orchestrator dispatches each job to the fastest idle capable
   worker (by EMA tokens/sec).
4. **Serve** — stream tokens or return media; results relay to the caller.
5. **Settle** — credits settle to the real cost; the worker earns its 70% share.

## 20. Scaling: models too big for one GPU

Some models exceed any single contributor's memory. 0_C's roadmap serves them
with **pipeline-parallel** inference: a transformer is split into contiguous
layer blocks spread across a cohort of machines, with speculative decoding to
hide wide-area latency. To the caller it is one job; a coordinated group of
workers serves it together and shares the reward.

## 21. Threat model

| Threat | Mitigation |
|---|---|
| Worker returns garbage / wrong model | Canary probes + coherence/throughput checks; slashing once staked |
| Worker tries to identify a user | Worker sees only text, never identity; prompts not persisted |
| MITM on the key directory | Safety-number fingerprints; key transparency planned |
| Replayed deposit signature | Idempotent — one credit per signature |
| Claiming another user's deposit | Memo binds each payment to the paying user |
| Orchestrator reading messages | Blind relay — only ciphertext is stored/forwarded |
| Price-feed manipulation | Cached feed + fixed fallback; redundant oracle (Pyth) planned |
| Concurrent double-spend of credits | Balance check + reserve in a single atomic transaction |

## 22. $0C distribution & unlocks (proposed)

| Allocation | Share | Unlock |
|---|---|---|
| Ecosystem & Community | 40% | 5% at TGE, remainder on milestones |
| Worker Rewards | 25% | Decaying emissions over ~4 years |
| Team & Contributors | 15% | 1-year cliff, then linear over 4 years |
| Treasury / DAO | 12% | Governed unlocks |
| Liquidity | 5% | 100% at TGE |
| Public / Airdrop | 3% | At TGE / campaign |

*TGE = token generation event. Subject to change before any launch.*

## 23. Glossary

- **Orchestrator** — routes jobs, tracks credits, blind-relays messages.
- **Worker** — a contributed GPU (native or browser) that serves inference.
- **Credit** — the stable unit of account; 1 credit = $0.01.
- **$0C** — the fixed-supply (1B) token: ownership, staking, settlement.
- **Reserve → settle** — credits held before a job, finalized to real cost after.
- **Blind relay** — the server forwards ciphertext without seeing plaintext.
- **Reward-per-share** — O(1) fair staking-reward accounting.
- **Buyback & burn** — protocol fees repurchase and destroy $0C.
- **Pipeline-parallel** — one large model split across several machines.

## 24. Status & disclaimer

This document describes the design and parameters of Open Communication and the
$0C token. Credits and on-chain SOL deposits are live; the $0C token described in
§7 is a design specification and is **not yet minted or tradeable**. Nothing here
is an offer to sell a security or investment advice. Token parameters and
allocations are proposals subject to change before any launch.
