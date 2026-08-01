/** Verifies provenance attestations: signing, verification, and tamper detection. */
import { createDb } from "@0c/db";
import {
  attestMessage,
  generateAttestKey,
  newRunId,
  publicKeyFromSecret,
  runMarker,
  sha256Hex,
  signAttestation,
  verifyAttestation,
  type AttestationPayload,
} from "@0c/crypto/attest";
import { makeAttestor } from "../src/attest.js";

let pass = true;
const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };

console.log("1) run marker appears in the prompt (what a third party sees)");
const runId = newRunId();
const marker = runMarker(runId, "opencommunication.app");
check("marker names 0_C, the run and the domain", marker.includes("0_C") && marker.includes(runId) && marker.includes("opencommunication.app"));
check("run id is short and quotable", runId.length === 8);

console.log("2) sign + verify");
const { secretKeyHex, publicKeyHex } = generateAttestKey();
check("public key derives from secret", publicKeyFromSecret(secretKeyHex) === publicKeyHex);
const payload: AttestationPayload = {
  runId,
  projectId: "3abf1ed7-6962-4f78-81fb-9fab32693232",
  promptSha256: sha256Hex(`${marker}\nProve that n * 1 = n.`),
  verified: true,
  createdAt: 1700000000000,
};
const sig = signAttestation(payload, secretKeyHex);
check("signature verifies with the published key", verifyAttestation(payload, sig, publicKeyHex));

console.log("3) tampering is detected");
check("altered projectId fails", !verifyAttestation({ ...payload, projectId: "other-project" }, sig, publicKeyHex));
check("altered prompt hash fails", !verifyAttestation({ ...payload, promptSha256: sha256Hex("different prompt") }, sig, publicKeyHex));
check("flipping verified fails", !verifyAttestation({ ...payload, verified: false }, sig, publicKeyHex));
check("altered timestamp fails", !verifyAttestation({ ...payload, createdAt: 1700000000001 }, sig, publicKeyHex));
check("altered runId fails", !verifyAttestation({ ...payload, runId: "deadbeef" }, sig, publicKeyHex));

console.log("4) forgery by another key fails");
const attacker = generateAttestKey();
const forged = signAttestation(payload, attacker.secretKeyHex);
check("attacker's signature rejected under our key", !verifyAttestation(payload, forged, publicKeyHex));
check("our signature rejected under attacker's key", !verifyAttestation(payload, sig, attacker.publicKeyHex));

console.log("5) canonical message is unambiguous");
check("format is versioned", attestMessage(payload).startsWith("0c-attest-v1|"));
check("all fields present", attestMessage(payload).split("|").length === 6);

console.log("6) orchestrator attestor persists a stable key + record");
const db = createDb(":memory:", { signupGrant: 0 });
delete process.env.ATTEST_SECRET_KEY;
const a1 = makeAttestor(db, "opencommunication.app");
const a2 = makeAttestor(db, "opencommunication.app");
check("key persists across instances (stable public key)", a1.publicKeyHex === a2.publicKeyHex);
const prompt = `${marker}\nProve that n * 1 = n.`;
const rec = a1.record({ runId, projectId: payload.projectId, prompt, verified: true, transcriptUrl: "https://x/y" });
check("record verifies with the attestor's public key", verifyAttestation(rec, rec.signature, a1.publicKeyHex));
const stored = db.getAttestation(runId);
check("record persisted", stored?.run_id === runId && stored?.project_id === payload.projectId);
check("stored prompt hash matches the prompt", stored?.prompt_sha256 === sha256Hex(prompt));
check("stored prompt contains the public marker", String(stored?.prompt).includes(runId));

console.log("\n" + (pass ? "OK — provenance attestations verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
