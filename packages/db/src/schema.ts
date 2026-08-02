/**
 * SQLite schema for 0_C. One database, owned exclusively by the orchestrator.
 *
 * The ledger is append-only: a balance is always SUM(delta) over a user's
 * entries. Reserve/settle/refund are modelled as compensating entries keyed by
 * jobId, so the credit lifecycle is fully auditable and race-free (every mutation
 * happens inside a single synchronous better-sqlite3 transaction).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  display_name TEXT,
  is_worker    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  delta      INTEGER NOT NULL,            -- signed credits
  reason     TEXT NOT NULL,              -- grant | reserve | settle | refund | earn | purchase
  source     TEXT NOT NULL DEFAULT 'system', -- grant | purchase | earn | deposit_eth | system
  ref        TEXT,                        -- e.g. jobId
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_ref  ON ledger_entries(ref);

CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  model             TEXT NOT NULL,
  status            TEXT NOT NULL,        -- reserved | running | done | error
  reserve           INTEGER NOT NULL DEFAULT 0,
  charge            INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  served_by         TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

-- Staking: users lock credits to earn a share of protocol fees. Uses the
-- standard "accumulated reward per share" pattern (scaled by ACC_SCALE) so
-- payouts are O(1) and exact regardless of when each user staked.
CREATE TABLE IF NOT EXISTS staking_state (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  total_staked         INTEGER NOT NULL DEFAULT 0,
  acc_reward_per_share REAL    NOT NULL DEFAULT 0,   -- scaled by ACC_SCALE
  lifetime_rewards     INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO staking_state (id, total_staked, acc_reward_per_share, lifetime_rewards)
  VALUES (1, 0, 0, 0);

CREATE TABLE IF NOT EXISTS stakes (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  amount      INTEGER NOT NULL DEFAULT 0,
  reward_debt REAL    NOT NULL DEFAULT 0,           -- scaled
  updated_at  INTEGER NOT NULL
);

-- Withdrawals: credits cashed out to ETH. Credits are deducted atomically on
-- request; a payout is then sent from the treasury. Refunded only if no payout
-- was submitted on-chain (never risk a double-pay).
CREATE TABLE IF NOT EXISTS withdrawals (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  credits    INTEGER NOT NULL,
  amount     REAL NOT NULL,           -- payout amount, in the currency column
  currency   TEXT NOT NULL DEFAULT 'SOL',
  address    TEXT NOT NULL,           -- recipient Ethereum address
  status     TEXT NOT NULL,           -- requested | paid | failed | review
  signature  TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at);

-- Signed provenance records. An external transcript proves the maths but not
-- who commissioned it, so we sign (run, project, prompt hash) and publish it.
CREATE TABLE IF NOT EXISTS attestations (
  run_id        TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  prompt        TEXT NOT NULL,          -- exact prompt sent, including the marker
  prompt_sha256 TEXT NOT NULL,
  verified      INTEGER NOT NULL,
  signature     TEXT NOT NULL,
  public_key    TEXT,                   -- key that signed THIS record (rotation-safe)
  transcript_url TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attest_created ON attestations(created_at);

-- Long-lived orchestrator settings (e.g. the attestation signing key).
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Maps a 0_C chat conversation to its Aristotle project, so follow-up messages
-- continue the same reasoning thread instead of starting from scratch.
CREATE TABLE IF NOT EXISTS aristotle_projects (
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);

-- X (Twitter) bot: links an X handle to an Ethereum wallet so token-gating can't be
-- spoofed. The user connects the wallet on the site (proves wallet control) and
-- tweets a one-time code (proves X-account control). Only then is it verified.
CREATE TABLE IF NOT EXISTS x_links (
  code        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  wallet      TEXT NOT NULL,
  x_handle    TEXT,                    -- set when the code is seen in a tweet
  verified    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_xlinks_handle ON x_links(x_handle, verified);
CREATE INDEX IF NOT EXISTS idx_xlinks_user   ON x_links(user_id);

-- Cursor so the bot never re-processes old mentions across restarts.
CREATE TABLE IF NOT EXISTS x_bot_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_mention_id TEXT
);
INSERT OR IGNORE INTO x_bot_state (id, last_mention_id) VALUES (1, NULL);

-- One row per handled mention: idempotency (never reply twice) + daily quotas.
CREATE TABLE IF NOT EXISTS x_requests (
  tweet_id   TEXT PRIMARY KEY,
  x_handle   TEXT NOT NULL,
  command    TEXT NOT NULL,
  status     TEXT NOT NULL,            -- accepted | rejected | replied | failed
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xreq_handle ON x_requests(x_handle, created_at);

CREATE TABLE IF NOT EXISTS public_keys (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  public_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  from_user  TEXT NOT NULL,
  to_user    TEXT NOT NULL,
  ciphertext TEXT NOT NULL,               -- opaque to the server (E2E encrypted)
  nonce      TEXT NOT NULL,
  epk        TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user, delivered);
`;
