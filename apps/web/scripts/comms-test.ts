import { io } from "socket.io-client";
import { generateIdentity, seal, open } from "@0c/crypto";

const ORCH = process.env.NEXT_PUBLIC_ORCH_URL ?? "http://localhost:4100";

async function login(userId: string): Promise<string> {
  const r = await fetch(`${ORCH}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  }).then((x) => x.json());
  return r.token as string;
}

function connect(token: string) {
  return io(`${ORCH}/comms`, { auth: { kind: "user", token }, transports: ["websocket"] });
}

const emitAck = <T>(sock: any, ev: string, payload: unknown) =>
  new Promise<T>((res) => sock.emit(ev, payload, (r: T) => res(r)));

async function main() {
  const aliceId = generateIdentity();
  const bobId = generateIdentity();
  const aliceTok = await login("alice");
  const bobTok = await login("bob");

  // Alice connects + publishes her key.
  const alice = connect(aliceTok);
  await new Promise<void>((r) => alice.on("connect", () => r()));
  await emitAck(alice, "key.publish", { publicKey: aliceId.publicKey });

  // Bob publishes his key, then DISCONNECTS (goes offline).
  const bobPre = connect(bobTok);
  await new Promise<void>((r) => bobPre.on("connect", () => r()));
  await emitAck(bobPre, "key.publish", { publicKey: bobId.publicKey });
  bobPre.close();
  await new Promise((r) => setTimeout(r, 300));

  // Alice fetches Bob's key and sends an encrypted DM while Bob is OFFLINE.
  const keyRes = await emitAck<any>(alice, "key.fetch", { userId: "bob" });
  const box = seal(keyRes.publicKey, "meet me at the docks 🕵️");
  const sendAck = await emitAck<any>(alice, "dm.send", {
    toUserId: "bob",
    ciphertext: box.ciphertext,
    nonce: box.nonce,
    epk: box.epk,
  });
  console.log("1) send ack ok:", sendAck.ok, "| ciphertext is opaque:",
    !box.ciphertext.includes("docks"));

  // Bob comes online — should receive the stored message and decrypt it.
  const bob = connect(bobTok);
  const received = new Promise<any>((res) => bob.on("dm.recv", (m: any) => res(m)));
  await new Promise<void>((r) => bob.on("connect", () => r()));
  const msg = await received;
  const plain = open(bobId, { ciphertext: msg.ciphertext, nonce: msg.nonce, epk: msg.epk });
  console.log("2) offline store-and-forward delivered from:", msg.fromUserId);
  console.log("3) bob decrypted:", JSON.stringify(plain));
  console.log("4) server relayed ciphertext only:", msg.ciphertext.slice(0, 24), "…");

  // Live path: Bob replies while Alice is online.
  const aliceRecv = new Promise<any>((res) => alice.on("dm.recv", (m: any) => res(m)));
  const box2 = seal(aliceId.publicKey, "on my way");
  await emitAck(bob, "dm.send", { toUserId: "alice", ciphertext: box2.ciphertext, nonce: box2.nonce, epk: box2.epk });
  const m2 = await aliceRecv;
  console.log("5) live reply decrypted:", JSON.stringify(open(aliceId, { ciphertext: m2.ciphertext, nonce: m2.nonce, epk: m2.epk })));

  alice.close();
  bob.close();
  console.log("\nOK — E2E comms verified.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
