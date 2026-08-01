import {
  generateAttestKey,
  publicKeyFromSecret,
  sha256Hex,
  signAttestation,
  type AttestationPayload,
} from "@0c/crypto/attest";
import type { Db } from "@0c/db";

/**
 * Signs provenance records for runs that execute on external services.
 *
 * The signing key comes from ATTEST_SECRET_KEY when set. Otherwise one is
 * generated on first boot and persisted, so the published public key stays
 * stable across restarts (it lives on the same volume as the ledger). Set the
 * env var explicitly if you ever need to move or rotate it deliberately.
 */
const SETTING_KEY = "attest_secret_key";

export function makeAttestor(db: Db, domain: string) {
  let secretKeyHex = (process.env.ATTEST_SECRET_KEY ?? "").trim();
  if (!secretKeyHex) {
    const stored = db.getSetting(SETTING_KEY);
    if (stored) {
      secretKeyHex = stored;
    } else {
      secretKeyHex = generateAttestKey().secretKeyHex;
      db.setSetting(SETTING_KEY, secretKeyHex);
    }
  }
  const publicKeyHex = publicKeyFromSecret(secretKeyHex);

  // Records written before per-record keys existed were signed by whatever key
  // is active right now. Stamp them so a later key rotation can't invalidate
  // already-published proofs.
  const backfilled = db.backfillAttestationKey(publicKeyHex);
  if (backfilled > 0) console.log(`[attest] stamped ${backfilled} legacy record(s) with the current key`);

  /** Sign and persist a record binding a run to its external project + prompt. */
  function record(a: {
    runId: string;
    projectId: string;
    prompt: string;
    verified: boolean;
    transcriptUrl?: string;
  }) {
    const payload: AttestationPayload = {
      runId: a.runId,
      projectId: a.projectId,
      promptSha256: sha256Hex(a.prompt),
      verified: a.verified,
      createdAt: Date.now(),
    };
    const signature = signAttestation(payload, secretKeyHex);
    db.saveAttestation({
      runId: payload.runId,
      projectId: payload.projectId,
      prompt: a.prompt,
      promptSha256: payload.promptSha256,
      verified: payload.verified,
      signature,
      publicKey: publicKeyHex,
      transcriptUrl: a.transcriptUrl,
      createdAt: payload.createdAt,
    });
    return { ...payload, signature };
  }

  return { publicKeyHex, domain, record };
}
