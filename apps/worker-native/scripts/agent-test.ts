/** Headless agent test: model uses the calculator tool, then answers. */
import { io } from "socket.io-client";

const ORCH = process.env.ORCH ?? "http://localhost:4100";

async function main() {
  const auth = await fetch(`${ORCH}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "agent-tester" }),
  }).then((r) => r.json());
  const before = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${auth.token}` } })
    .then((r) => r.json())
    .then((d) => d.balance);

  const socket = io(`${ORCH}/infer`, { auth: { kind: "user", token: auth.token }, transports: ["websocket"] });
  await new Promise<void>((r) => socket.on("connect", () => r()));

  const jobId = "agent-" + Date.now();
  const steps: string[] = [];
  let finalText = "";

  const done = new Promise<any>((resolve) => {
    socket.on("job.step", (p: any) => { steps.push(p.text); console.log("  step:", p.text); });
    socket.on("job.token", (p: any) => { finalText += p.delta; });
    socket.on("job.done", (p: any) => resolve(p));
    socket.on("job.error", (p: any) => resolve({ error: p.message }));
  });

  console.log("submitting agent job (calculator)…");
  socket.emit("job.submit", {
    jobId,
    model: "llama3.2",
    kind: "agent",
    messages: [{ role: "user", content: "Use the calculator tool to compute 4823 * 197, then tell me the result." }],
  });

  const result = await done;
  console.log("\nfinal answer:", finalText.slice(0, 200));

  let pass = true;
  const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };
  check("agent emitted tool steps", steps.length > 0);
  check("a calculator tool was called", steps.some((s) => s.includes("calculator")));
  check("final answer contains 950131", finalText.includes("950131"));
  check("billed flat 15 cr", result.charge === 15);
  check("balance debited by 15", result.balance === before - 15);

  socket.close();
  console.log("\n" + (pass ? "OK — agent tool-use verified." : "PARTIAL — see above (model tool-use can vary)."));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
