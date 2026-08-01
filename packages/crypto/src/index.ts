import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";

/**
 * @0c/crypto — isomorphic (browser + Node) E2E encryption for the comms relay.
 *
 * MVP uses a libsodium-style "sealed box": the sender makes a throwaway
 * ephemeral X25519 keypair, does ECDH against the recipient's long-term public
 * key, derives an XChaCha20-Poly1305 key via HKDF-SHA256, and encrypts. The
 * orchestrator only ever sees {ciphertext, nonce, epk} — never the plaintext.
 *
 * Forward secrecy / Double Ratchet is deliberately deferred to a later phase;
 * this is enough to prove the "server is a blind relay" property end-to-end.
 */

const HKDF_INFO = new TextEncoder().encode("0c-e2e-dm-v1");

export interface Identity {
  /** base64url 32-byte X25519 public key (published to the directory). */
  publicKey: string;
  /** base64url 32-byte X25519 secret key (stays on the device). */
  secretKey: string;
}

export interface SealedBox {
  ciphertext: string; // base64url
  nonce: string; // base64url (24 bytes)
  epk: string; // base64url ephemeral public key
}

/* ---------------- base64url (isomorphic) ---------------- */

export function toB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/* ---------------- identity ---------------- */

export function generateIdentity(): Identity {
  const secret = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(secret);
  return { publicKey: toB64u(pub), secretKey: toB64u(secret) };
}

function deriveKey(shared: Uint8Array, epk: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(epk.length + recipientPub.length);
  salt.set(epk, 0);
  salt.set(recipientPub, epk.length);
  return hkdf(sha256, shared, salt, HKDF_INFO, 32);
}

/* ---------------- seal / open ---------------- */

export function seal(recipientPublicKeyB64: string, plaintext: string): SealedBox {
  const recipientPub = fromB64u(recipientPublicKeyB64);
  const esk = x25519.utils.randomPrivateKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, recipientPub);
  const key = deriveKey(shared, epk, recipientPub);
  const nonce = randomBytes(24);
  const aead = xchacha20poly1305(key, nonce);
  const ct = aead.encrypt(new TextEncoder().encode(plaintext));
  return { ciphertext: toB64u(ct), nonce: toB64u(nonce), epk: toB64u(epk) };
}

export function open(identity: Identity, box: SealedBox): string {
  const secret = fromB64u(identity.secretKey);
  const recipientPub = fromB64u(identity.publicKey);
  const epk = fromB64u(box.epk);
  const shared = x25519.getSharedSecret(secret, epk);
  const key = deriveKey(shared, epk, recipientPub);
  const aead = xchacha20poly1305(key, fromB64u(box.nonce));
  const pt = aead.decrypt(fromB64u(box.ciphertext));
  return new TextDecoder().decode(pt);
}

/**
 * A short, human-comparable fingerprint of a public key ("safety number").
 * Two users can read these aloud to detect a MITM'd key directory. Cosmetic in
 * MVP but wired now so the UI can show it.
 */
export function safetyNumber(publicKeyB64: string): string {
  const digest = sha256(fromB64u(publicKeyB64));
  const groups: string[] = [];
  for (let i = 0; i < 10; i++) {
    const n = ((digest[i * 2] ?? 0) << 8) | (digest[i * 2 + 1] ?? 0);
    groups.push((n % 100000).toString().padStart(5, "0"));
  }
  return groups.join(" ");
}
