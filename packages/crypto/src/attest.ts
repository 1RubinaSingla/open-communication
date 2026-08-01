import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";

/**
 * Provenance attestations.
 *
 * An external transcript (e.g. an Aristotle project) proves the *maths*, but says
 * nothing about who commissioned it — anyone could produce a similar one. So 0_C
 * signs a record binding a run to its project and exact prompt. Anyone can then
 * verify, with our published public key, that we actually stand behind that run,
 * and nobody else can forge one.
 *
 * Deliberately isomorphic: the browser verifies the signature itself rather than
 * trusting a server that says "valid".
 */

export const ATTEST_VERSION = "0c-attest-v1";

export interface AttestationPayload {
  runId: string;
  projectId: string;
  /** sha256 of the exact prompt sent, hex. */
  promptSha256: string;
  verified: boolean;
  createdAt: number;
}

/** Canonical, unambiguous bytes to sign. Field order is part of the format. */
export function attestMessage(p: AttestationPayload): string {
  return [
    ATTEST_VERSION,
    p.runId,
    p.projectId,
    p.promptSha256,
    p.verified ? "verified" : "unverified",
    String(p.createdAt),
  ].join("|");
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export function generateAttestKey(): { secretKeyHex: string; publicKeyHex: string } {
  const sk = ed25519.utils.randomPrivateKey();
  return { secretKeyHex: bytesToHex(sk), publicKeyHex: bytesToHex(ed25519.getPublicKey(sk)) };
}

export function publicKeyFromSecret(secretKeyHex: string): string {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(secretKeyHex)));
}

export function signAttestation(p: AttestationPayload, secretKeyHex: string): string {
  const msg = new TextEncoder().encode(attestMessage(p));
  return bytesToHex(ed25519.sign(msg, hexToBytes(secretKeyHex)));
}

/** Verify a signature against a published public key. Never throws. */
export function verifyAttestation(p: AttestationPayload, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const msg = new TextEncoder().encode(attestMessage(p));
    return ed25519.verify(hexToBytes(signatureHex), msg, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** Short, human-quotable run id that appears in the public prompt. */
export function newRunId(): string {
  return bytesToHex(randomBytes(4));
}

/**
 * The marker prepended to every attested prompt. It shows up verbatim in the
 * external transcript, which is what lets a third party connect that transcript
 * back to a signed 0_C record.
 */
export function runMarker(runId: string, domain = "opencommunication.app"): string {
  return `[0_C · run ${runId} · ${domain}]`;
}
