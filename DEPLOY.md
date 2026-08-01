# Deploying 0_C

0_C is **not** a single deployable — Vercel hosts the frontend, but the
orchestrator is a stateful WebSocket server that needs an always-on host, and
workers need a GPU. Topology:

```
 Browser ──https──▶  Vercel (apps/web, Next.js)
    │
    └──wss──▶  Railway (apps/orchestrator)  ◀──wss── Worker(s) + Ollama
                        │                              (your Mac, or cloud GPU)
                        └─ SQLite on a volume
```

The web app talks to the orchestrator; the orchestrator talks to workers.
Workers **dial out**, so they can run anywhere (behind NAT, on your laptop) with
no inbound ports. Your local Ollama stays private — only the local worker sees it.

---

## 1. Orchestrator → Railway

1. **New Project → Deploy from GitHub repo** → pick `dev79-code/0_C_`.
2. Railway detects the root **`Dockerfile`** (builds only the orchestrator).
3. **Variables** (Service → Variables):
   - `ORCH_SECRET` = a strong secret. Generate one: `openssl rand -hex 32`.
     (This signs user tokens AND authenticates native workers — keep it safe.)
   - `DB_PATH` = `/data/0c.sqlite`  (already the Dockerfile default; set it explicitly too)
   - `SIGNUP_GRANT_CREDITS` = `500`  (optional)
   - Do **not** set `PORT` — Railway injects it.
4. **Add a Volume** (Service → Settings → Volumes): mount path **`/data`**.
   This persists the credit ledger + published keys across restarts.
5. **Generate a domain** (Service → Settings → Networking → Generate Domain).
   You'll get e.g. `https://0c-production.up.railway.app`. WebSockets work over it.
6. Verify: open `https://<your-domain>/health` → `{"ok":true,"workers":0}`.

> SQLite means **run exactly one orchestrator instance** (no horizontal scaling
> yet). That's fine for now; Phase 1 swaps in Postgres to scale out.

## 2. Frontend → Vercel (fix the failing build)

The "No Output Directory named public" error is because Vercel is building the
**repo root**. Point it at the Next.js app instead:

1. Vercel → Project → **Settings → General → Root Directory** = **`apps/web`**.
   Framework Preset then auto-detects **Next.js** (the error disappears).
2. **Settings → Environment Variables**:
   - `NEXT_PUBLIC_ORCH_URL` = `https://<your-railway-domain>`  (no trailing slash)
3. **Redeploy** (Deployments → ⋯ → Redeploy). Install runs at the pnpm workspace
   root automatically, so the `@0c/*` packages resolve.

## 3. A worker → your Mac (with Ollama)

Run a worker locally that connects to the **Railway** orchestrator:

```bash
# in the repo, with Ollama already running (ollama serve) + a model pulled:
WORKER_ORCH_URL="https://<your-railway-domain>" \
WORKER_SECRET="<the same ORCH_SECRET you set on Railway>" \
OLLAMA_URL="http://localhost:11434" \
pnpm --filter @0c/worker-native start
```

It registers over `wss` and starts serving `llama3.2` (plus `echo`). Keep the
terminal open. For an always-on worker, run it on a cloud GPU box the same way.

Browser contributors also work: anyone visiting **/contribute** on the deployed
site becomes a WebGPU worker using their own login token — no secret required.

---

## Solana credit deposits (optional)

To enable the "Add credits · SOL" on-ramp, set these on the **orchestrator**
(Railway) service — the web app reads them via `/credits/config`:

```
DEPOSITS_ENABLED=true
SOLANA_CLUSTER=devnet                     # or mainnet-beta
SOLANA_RPC_URL=https://api.devnet.solana.com   # use a paid RPC for mainnet
TREASURY_ADDRESS=<a Solana address you control>
SOL_USD_PRICE=150                         # feeds SOL->credits; use an oracle in prod
```

Users pay SOL to the treasury from Phantom (with a memo binding the payment to
their account); the orchestrator verifies the transaction on-chain and credits
them. It's **non-custodial** (the treasury only receives) and **idempotent** (one
credit per signature). To go to mainnet, change the three `SOLANA_*`/`TREASURY`
values and use a real price oracle. Devnet SOL comes free from
<https://faucet.solana.com>.

## Notes / caveats

- **Socket.IO is the primary path.** The web UI's chat + messages connect
  directly to the orchestrator over WebSocket, so they're unaffected by Vercel
  function limits.
- **External API callers** should hit the orchestrator directly
  (`https://<railway-domain>/v1/chat/completions`) rather than the Vercel
  `/api/v1/*` proxy — Vercel functions cap streaming duration.
- **CORS** is currently open (`origin: true`). Tighten to your Vercel domain
  before going public (edit `apps/orchestrator/src/server.ts`).
- **Secrets:** never commit real values. `.env` is gitignored; set production
  values only in the Railway/Vercel dashboards.
