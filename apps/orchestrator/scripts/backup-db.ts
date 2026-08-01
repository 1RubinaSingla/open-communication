/**
 * Consistent SQLite backup.
 *
 * The database holds the credit ledger (who is owed real money), the
 * attestation signing key, and X links. It lives on a single Railway volume with
 * no redundancy, so losing that volume loses all of it.
 *
 * Uses VACUUM INTO, which writes a consistent snapshot while the orchestrator is
 * running — safe to schedule against a live service. Keeps the newest
 * BACKUP_KEEP files and prunes the rest.
 *
 * Run on a schedule (Railway cron) AND pull copies off the volume periodically
 * via GET /admin/backup — an on-volume backup does not survive volume loss.
 */
import "../src/load-env.js";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { ROOT } from "../src/load-env.js";

const DB_PATH = resolve(ROOT, process.env.DB_PATH ?? "./data/0c.sqlite");
const BACKUP_DIR = resolve(ROOT, process.env.BACKUP_DIR ?? dirname(DB_PATH) + "/backups");
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

if (!existsSync(DB_PATH)) {
  console.error(`[backup] no database at ${DB_PATH}`);
  process.exit(1);
}
mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(BACKUP_DIR, `0c-${stamp}.sqlite`);

const db = new Database(DB_PATH, { readonly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`[backup] wrote ${target} (${(statSync(target).size / 1024).toFixed(0)} KB)`);

// prune oldest
const files = readdirSync(BACKUP_DIR)
  .filter((f) => f.startsWith("0c-") && f.endsWith(".sqlite"))
  .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const { f } of files.slice(KEEP)) {
  unlinkSync(join(BACKUP_DIR, f));
  console.log(`[backup] pruned ${f}`);
}
console.log(`[backup] ${Math.min(files.length, KEEP)} snapshot(s) retained`);
