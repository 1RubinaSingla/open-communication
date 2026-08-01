# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Getting set up

```bash
pnpm install
cp .env.example .env    # defaults work with no external services

pnpm orch               # orchestrator
pnpm worker             # worker (built-in echo model unless Ollama is running)
pnpm web                # app on :3000
```

Nothing external is required to run the stack. Install
[Ollama](https://ollama.com) and `ollama pull llama3.2` if you want real models;
every paid integration (Solana, Aristotle, search providers, the X bot) is off
until configured and fails safe when it isn't.

## Before opening a pull request

```bash
pnpm typecheck
pnpm build
```

If you touched credits, staking, attestations or the X bot, run the suites that
cover them — they use in-memory SQLite and need no network:

```bash
pnpm --filter @0c/orchestrator exec tsx scripts/withdraw-test.ts
pnpm --filter @0c/orchestrator exec tsx scripts/staking-test.ts
pnpm --filter @0c/orchestrator exec tsx scripts/attest-test.ts
pnpm --filter @0c/orchestrator exec tsx scripts/prefilter-test.ts
pnpm --filter @0c/orchestrator exec tsx scripts/xbot-test.ts
```

CI runs all of the above.

## House style

- **The protocol is the source of truth.** Anything crossing the wire belongs in
  `packages/protocol` as a Zod schema, so the client, orchestrator and workers
  can't drift apart.
- **Money changes are atomic.** Balance checks and mutations happen inside a
  single synchronous better-sqlite3 transaction. Never check a balance in one
  statement and spend it in another.
- **Fail safe.** New integrations default to off, no-op without configuration,
  and never charge a user for work that didn't happen.
- **Say what's assumed.** If something proves a model rather than the running
  code, or sends data to a third party, the code comment and the UI should both
  say so.
- Comments explain *why*, not *what*.

## Reporting bugs

Use the issue templates. For anything security-related, follow
[SECURITY.md](SECURITY.md) instead of opening an issue.
