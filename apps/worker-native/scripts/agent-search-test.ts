/** Agent web_search test: real (keyless Wikipedia) results, not "No results". */
import { io } from "socket.io-client";

const ORCH = process.env.ORCH ?? "http://localhost:4100";

async function main() {
  const auth = await fetch(`${ORCH}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "search-tester" }),
  }).then((r) => r.json());

  const socket = io(`${ORCH}/infer`, { auth: { kind: "user", token: auth.token }, transports: ["websocket"] });
  await new Promise<void>((r) => socket.on("connect", () => r()));

  const steps: string[] = [];
  let finalText = "";
  const done = new Promise<any>((resolve) => {
    socket.on("job.step", (p: any) => { steps.push(p.text); console.log("  step:", p.text); });
    socket.on("job.token", (p: any) => { finalText += p.delta; });
    socket.on("job.done", (p: any) => resolve(p));
    socket.on("job.error", (p: any) => resolve({ error: p.message }));
  });

  console.log("submitting agent job (web_search)…");
  socket.emit("job.submit", {
    jobId: "search-" + Date.now(),
    model: "llama3.2",
    kind: "agent",
    messages: [{ role: "user", content: "Use web_search to find the capital city of Australia, then state it." }],
  });

  await done;
  console.log("\nfinal:", finalText.slice(0, 160));
  const resultSteps = steps.filter((s) => s.startsWith("↳")).join(" ");
  let pass = true;
  const check = (n: string, ok: boolean) => { console.log(`   ${ok ? "✓" : "✗"} ${n}`); if (!ok) pass = false; };
  check("web_search tool was called", steps.some((s) => s.includes("web_search")));
  check("search returned real content (not empty)", !resultSteps.includes("No results found") && resultSteps.length > 5);
  check("answer/results mention Canberra", (finalText + resultSteps).includes("Canberra"));

  socket.close();
  console.log("\n" + (pass ? "OK — real web search verified." : "PARTIAL — model/search can vary."));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
