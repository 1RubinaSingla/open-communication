# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **contact@opencommunication.app** with:

- what the issue is and roughly how severe you think it is
- steps to reproduce, or a proof of concept
- anything you think we'd get wrong when trying to reproduce it

You'll get an acknowledgement within a few days. We'll tell you honestly whether
we consider it in scope and, if we fix it, credit you unless you'd rather we
didn't.

## Especially interested in

This project moves real money and handles private messages, so:

- **Credit ledger** — any way to create, duplicate or withdraw credits that
  weren't deposited or earned
- **Deposits** — crediting a transaction that didn't reach the account's own
  deposit address, replaying a transaction hash, or claiming someone else's
  deposit
- **Withdrawals** — draining beyond the caps, or making a payout happen twice
- **Messaging** — anything that lets the relay, or a third party, recover
  plaintext or a private key
- **Attestations** — forging a signed provenance record, or making one verify
  under a key we didn't sign with
- **Worker trust** — making the network accept fabricated inference results

## Known limitations

We'd rather state these than have them reported as findings:

- **Deposits are custodial.** Each account is issued its own Ethereum deposit
  address, derived from a master mnemonic (`DEPOSIT_MNEMONIC`) that the
  orchestrator holds — Ethereum has no memo field, so the destination address is
  what binds a payment to an account. Whoever holds that phrase controls every
  deposit address, and funds sit there until swept to the treasury. This is a
  deliberate trade-off of the per-address model, not an oversight.
- **Anti-cheat is not enforced yet.** Canary and throughput checks exist but only
  log; a dishonest worker is not yet penalised.
- **Sign-in is a development stub.** Any username can be claimed. Promotional
  credits are deliberately not withdrawable so this cannot be turned into money,
  but it is not real authentication.
- **The orchestrator is a single instance.** SQLite with one volume; no
  horizontal scaling and no automatic failover.
- **CORS is permissive** and there is no rate limiting on the public API.
- **Verified maths leaves the network.** Requests to the Aristotle model or the
  `verified_math` tool go to a third-party API, and the interface labels this.

## Scope

The orchestrator, web app, workers and shared packages in this repository.
Third-party services we integrate with (Ethereum RPC providers, Harmonic, search
providers) should be reported to those projects directly.
