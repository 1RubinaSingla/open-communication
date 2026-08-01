# Open Communication (`0_C`)

**Uncensored AI inference and end-to-end encrypted messaging on contributed GPUs.**
One network, one identity, one credit economy — for talking to a model *and* to
each other.

[opencommunication.app](https://opencommunication.app) · [@O_C_](https://x.com/O_C_)

---

## Why this exists

Most AI is centralised: prompts are logged, models are filtered, access can be
revoked. Private messaging lives in separate walled gardens. `0_C` puts both on
one decentralised network:

- **Uncensored inference** — OpenAI-compatible API, no refusal layer, prompts are
  never persisted (only billing is).
- **Private by construction** — direct messages are sealed on-device with X25519
  + XChaCha20-Poly1305. The relay only ever handles ciphertext.
- **Contributed, not rented** — anyone can serve inference from a browser tab or
  a native worker and earn the majority of what their work is worth.

## What's actually working

| | Status |
|---|---|
| Streaming chat over contributed GPUs (Ollama / browser WebGPU) | ✅ live |
| End-to-end encrypted DMs with offline store-and-forward | ✅ live |
| Atomic credit ledger (reserve → settle → refund) | ✅ live |
| OpenAI-compatible `/v1/chat/completions` | ✅ live |
| Image generation | ✅ live |
| Agents with tools (web search, calculator, verified maths) | ✅ live |
| Formally-verified maths via Harmonic Aristotle | ✅ live |
| Signed provenance for external runs | ✅ live |
| Solana deposits (SOL + USDC, on-chain verified) | ✅ live |
| Credit staking (reward-per-share) | ✅ live |
| SOL withdrawals | ⚙️ built, disabled by default |
| X bot (`/prove`), $0C token gate, buyback-and-burn | ⚙️ built, awaiting launch |
| Anti-cheat enforcement, pipeline-parallel serving | 📋 roadmap |

## Verified in public

The network can produce **machine-checked proofs**, and every such run is signed
so anyone can confirm it came from `0_C`:

- Signed record → [`/proof/dcac4a4c`](https://opencommunication.app/proof/dcac4a4c)
  (your browser verifies the ed25519 signature itself)
- Full reasoning transcript → [Aristotle project](https://aristotle.harmonic.fun/dashboard/requests/e33ca845-ca6d-4942-8f8d-119ba54715f8)

That run formalised `0_C`'s own relay-privacy property in Lean 4 and proved that
no relay's view can distinguish two plaintexts — so no single relay can
reconstruct a message. It assumes an explicit idealisation, stated as a
hypothesis, and proves the *model* rather than the running code.

## Architecture

```
 Browser / API ──wss──▶  Orchestrator  ◀──wss── Contributed GPU workers
                              │  routing · credits · blind relay
                              └─ ledger · key directory · message store
```

```
apps/
  web/            Next.js — chat, encrypted messages, create, staking, dashboard, /v1 API
  orchestrator/   Fastify + Socket.IO — /infer + /comms, credits, Solana, attestations
  worker-native/  Node worker — Ollama for real models, built-in echo fallback
packages/
  protocol/       Zod wire schemas (single source of truth for every message)
  db/             SQLite schema + atomic credit ledger
  crypto/         X25519 + XChaCha20-Poly1305 E2E, ed25519 attestations
  credits/        pricing and earn-share maths (browser-safe)
```

The orchestrator is deliberately a **blind relay** for messaging: it stores and
forwards ciphertext and never holds a recipient's private key.

## Run it locally

```bash
pnpm install
cp .env.example .env          # defaults work out of the box

pnpm orch                     # orchestrator
pnpm worker                   # worker (echo model unless Ollama is running)
pnpm web                      # app on :3000
```

For real models, install [Ollama](https://ollama.com), `ollama pull llama3.2`,
and the worker picks it up automatically.

### Use the API

```bash
TOKEN=$(curl -s localhost:4000/auth/dev -H 'content-type: application/json' \
  -d '{"userId":"alice"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

## Configuration

Everything optional is off by default. See [`.env.example`](.env.example) for the
full list — deposits, withdrawals, agent search providers, the Aristotle
integration, the X bot, attestations and backups each have their own section and
fail safe when unconfigured.

## Deployment

See [`DEPLOY.md`](DEPLOY.md). The web app is a normal Next.js deploy; the
orchestrator is a long-lived WebSocket service and needs a persistent host with a
volume — it cannot run on serverless.

## One documented privacy exception

Formally-verified maths is served by **Harmonic's Aristotle**, an external API.
Selecting that model, or an agent calling `verified_math`, transmits the problem
to a third party under their terms. Every such step is labelled
**⚠ leaves network** in the interface. All other inference runs inside the
network. See [`WHITEPAPER.md`](WHITEPAPER.md).

## Security

Deposits are non-custodial and idempotent. Withdrawals are capped by lifetime
deposits and earnings, so promotional credits can never be cashed out. Please
report vulnerabilities privately to **contact@opencommunication.app** rather than
opening a public issue.

## License

[MIT](LICENSE).
