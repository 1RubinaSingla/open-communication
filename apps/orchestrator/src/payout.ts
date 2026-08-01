import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";

const USDC_DECIMALS = 6;

/** Parse a treasury secret key from base58 (Phantom export), JSON array, or base64. */
export function loadKeypair(secret: string): Keypair {
  const s = secret.trim();
  if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try {
    const b = bs58.decode(s);
    if (b.length === 64) return Keypair.fromSecretKey(b);
  } catch {
    /* not base58 */
  }
  const b = Buffer.from(s, "base64");
  if (b.length === 64) return Keypair.fromSecretKey(new Uint8Array(b));
  throw new Error("bad TREASURY_SECRET_KEY (expected base58, JSON array, or base64 of 64 bytes)");
}

export interface PayoutResult {
  signature?: string;
  submitted: boolean; // true once a tx was sent to the network
  error?: string;
}

/**
 * Sends `amountUsdc` USDC from the treasury to `recipient`, creating the
 * recipient's token account if needed. `submitted` tells the caller whether a
 * tx reached the network (so credits are NOT refunded on an uncertain failure).
 */
export function makePayout(cfg: { rpcUrl: string; cluster: string; usdcMint: string; secretKey: string }) {
  const commitment = cfg.cluster === "mainnet-beta" ? "finalized" : "confirmed";
  const connection = new Connection(cfg.rpcUrl, commitment);
  const treasury = loadKeypair(cfg.secretKey);
  const mint = new PublicKey(cfg.usdcMint);

  async function payUsdc(recipient: string, amountUsdc: number, onSignature: (sig: string) => void): Promise<PayoutResult> {
    let submitted = false;
    try {
      const to = new PublicKey(recipient);
      const fromAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
      const toAta = await getAssociatedTokenAddress(mint, to);

      const tx = new Transaction();
      if (!(await connection.getAccountInfo(toAta))) {
        tx.add(createAssociatedTokenAccountInstruction(treasury.publicKey, toAta, to, mint));
      }
      const amount = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
      tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, treasury.publicKey, amount, USDC_DECIMALS));

      tx.feePayer = treasury.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(treasury);

      // Broadcast (with preflight). If this throws, the tx never landed → safe to refund.
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      onSignature(sig);
      submitted = true; // it's on the network now — do NOT refund on later uncertainty

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, commitment);
      return { signature: sig, submitted: true };
    } catch (err) {
      return { submitted, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Send native SOL from the treasury to `recipient`. Same submitted-flag safety. */
  async function paySol(recipient: string, amountSol: number, onSignature: (sig: string) => void): Promise<PayoutResult> {
    let submitted = false;
    try {
      const to = new PublicKey(recipient);
      const lamports = Math.round(amountSol * 1e9);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: to, lamports }),
      );
      tx.feePayer = treasury.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(treasury);

      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      onSignature(sig);
      submitted = true;

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, commitment);
      return { signature: sig, submitted: true };
    } catch (err) {
      return { submitted, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { payUsdc, paySol, treasuryPubkey: treasury.publicKey.toBase58() };
}
