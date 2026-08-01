import { Buffer } from "buffer";
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Cluster,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const USDC_DECIMALS = 6;

// web3.js relies on a global Buffer; Next's client bundle doesn't provide one.
if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

interface Phantom {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
  signMessage: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
}

function getProvider(): Phantom {
  const p = (window as any).solana as Phantom | undefined;
  if (!p?.isPhantom) {
    throw new Error("Phantom wallet not found. Install the Phantom browser extension.");
  }
  return p;
}

export async function connectWallet(): Promise<string> {
  const res = await getProvider().connect();
  return res.publicKey.toString();
}

/**
 * Send `amountSol` to the treasury with a memo binding the payment to `userId`,
 * then wait for confirmation. Returns the signature for server verification.
 */
export async function depositSol(params: {
  cluster: string;
  treasury: string;
  amountSol: number;
  userId: string;
}): Promise<{ signature: string; from: string }> {
  const provider = getProvider();
  const res = await provider.connect();
  const from = new PublicKey(res.publicKey.toString());
  const connection = new Connection(clusterApiUrl(params.cluster as Cluster), "confirmed");

  const lamports = Math.round(params.amountSol * 1e9);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(params.treasury), lamports }),
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`0c:${params.userId}`, "utf8"),
    }),
  );
  tx.feePayer = from;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, from: from.toBase58() };
}

/**
 * Send `amountUsdc` USDC to the treasury with a memo, creating the treasury's
 * token account if needed. Returns the signature for server verification.
 */
export async function depositUsdc(params: {
  cluster: string;
  treasury: string;
  usdcMint: string;
  amountUsdc: number;
  userId: string;
}): Promise<{ signature: string; from: string }> {
  const provider = getProvider();
  const res = await provider.connect();
  const from = new PublicKey(res.publicKey.toString());
  const connection = new Connection(clusterApiUrl(params.cluster as Cluster), "confirmed");
  const mint = new PublicKey(params.usdcMint);
  const treasury = new PublicKey(params.treasury);

  const fromAta = await getAssociatedTokenAddress(mint, from);
  const toAta = await getAssociatedTokenAddress(mint, treasury);

  const tx = new Transaction();
  if (!(await connection.getAccountInfo(toAta))) {
    tx.add(createAssociatedTokenAccountInstruction(from, toAta, treasury, mint));
  }
  const amount = BigInt(Math.round(params.amountUsdc * 10 ** USDC_DECIMALS));
  tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, from, amount, USDC_DECIMALS));
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`0c:${params.userId}`, "utf8"),
    }),
  );
  tx.feePayer = from;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { signature, from: from.toBase58() };
}

/**
 * Prove control of a wallet by signing a server-issued challenge. Signing a
 * message authorises no transaction and cannot move funds.
 */
export async function signWalletChallenge(message: string): Promise<{ wallet: string; signature: string }> {
  const provider = getProvider();
  const res = await provider.connect();
  const wallet = res.publicKey.toString();
  const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  // base58, matching how Solana keys/signatures are represented
  const { default: bs58 } = await import("bs58");
  return { wallet, signature: bs58.encode(signature) };
}

export function explorerTx(signature: string, cluster: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
