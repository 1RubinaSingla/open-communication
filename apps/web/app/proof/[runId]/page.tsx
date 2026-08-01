"use client";

import { use, useEffect, useState } from "react";
import { ORCH_URL } from "@/lib/config";
import { verifyAttestation, type AttestationPayload } from "@0c/crypto/attest";

interface Record extends AttestationPayload {
  prompt: string;
  signature: string;
  publicKey: string;
  transcriptUrl?: string;
  algorithm: string;
  format: string;
}

export default function ProofPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [rec, setRec] = useState<Record | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${ORCH_URL}/attest/${runId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "not found");
        return r.json();
      })
      .then((d: Record) => {
        setRec(d);
        // Verify in the browser — don't take the server's word for it.
        setValid(
          verifyAttestation(
            {
              runId: d.runId,
              projectId: d.projectId,
              promptSha256: d.promptSha256,
              verified: d.verified,
              createdAt: d.createdAt,
            },
            d.signature,
            d.publicKey,
          ),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [runId]);

  const Row = ({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) => (
    <div className="flex flex-col gap-1 border-b border-border/50 py-2 sm:flex-row sm:gap-4">
      <div className="mono w-40 shrink-0 text-[10px] uppercase tracking-wider text-muted">{k}</div>
      <div className={`${mono ? "mono" : ""} break-all text-xs text-fg`}>{v}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="mono text-xs text-accent">// PROOF OF PROVENANCE</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <h1 className="mono text-2xl font-bold tracking-tight">
        <span className="gradient-text">RUN {runId}</span>
      </h1>

      {error && <p className="mono mt-4 text-sm text-warn">⚠ {error}</p>}
      {!rec && !error && <p className="mono mt-4 text-sm text-muted">loading…</p>}

      {rec && (
        <>
          <div className={`card mt-6 p-5 ${valid ? "border-good/50" : "border-warn/50"}`}>
            <div className="mono text-sm font-semibold">
              {valid === null ? "checking…" : valid ? (
                <span className="text-good">✓ SIGNATURE VALID</span>
              ) : (
                <span className="text-warn">✗ SIGNATURE INVALID</span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">
              {valid
                ? "Open Communication signed this record, and your browser just checked that signature against the published key — no need to trust this page. It confirms we commissioned this run and that the prompt below is exactly what was sent."
                : "This record does not match its signature. Treat it as unverified."}
            </p>
          </div>

          <div className="card mt-4 p-5">
            <Row k="Prompt sent" v={<span className="whitespace-pre-wrap">{rec.prompt}</span>} mono={false} />
            <Row k="Prompt SHA-256" v={rec.promptSha256} />
            <Row k="External project" v={rec.projectId} />
            <Row k="Result" v={rec.verified ? <span className="text-good">formally verified</span> : "completed (unverified)"} />
            <Row k="Attested at" v={new Date(rec.createdAt).toISOString()} />
            <Row k="Signature (ed25519)" v={rec.signature} />
            <Row k="Public key" v={rec.publicKey} />
          </div>

          {rec.transcriptUrl && (
            <a
              className="btn btn-accent mt-4"
              href={rec.transcriptUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textTransform: "none" }}
            >
              View the external reasoning transcript ↗
            </a>
          )}

          <div className="card mt-6 p-5">
            <h2 className="mono text-sm font-semibold tracking-wide">HOW TO CHECK THIS YOURSELF</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Open the transcript and read the prompt under “INSTRUCTION RECEIVED”.</li>
              <li>Confirm it matches the prompt above, including the <code className="mono text-accent">[0_C · run {runId}]</code> marker.</li>
              <li>
                Fetch our published key at{" "}
                <a className="text-accent underline" href={`${ORCH_URL}/attest/key`} target="_blank" rel="noreferrer">
                  /attest/key
                </a>{" "}
                and verify the ed25519 signature over{" "}
                <code className="mono text-accent">0c-attest-v1|runId|projectId|promptSha256|verified|createdAt</code>.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              Note: the formal verification itself was performed by Harmonic&apos;s Aristotle, not on
              contributed GPUs. Open Communication orchestrated, billed and attested the run.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
