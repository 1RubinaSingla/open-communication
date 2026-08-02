import { createPublicClient, http, formatEther, formatUnits, isAddress } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";

/** Tether (USDT) on Ethereum mainnet. 6 decimals, like USDC — not 18. */
export const USDT_MAINNET = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
export const USDT_DECIMALS = 6;

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface EthConfig {
  enabled: boolean;
  chain: "mainnet" | "sepolia";
  rpcUrl: string;
  /**
   * BIP-39 mnemonic that every per-user deposit address is derived from.
   * Whoever holds this controls every deposit address — see SECURITY.md.
   */
  mnemonic: string;
  usdtAddress: string;
  ethUsdPrice: number;
  /** Blocks required on top of the including block before we credit. */
  confirmations: number;
}

export interface VerifyResult {
  credits: number;
  currency: "ETH" | "USDT";
  amount: number;
  sender: string | null;
}

/** Case-insensitive address comparison. Addresses are hex, casing is checksum only. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** A 32-byte log topic holds a left-padded address in its low 20 bytes. */
export function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface RawTx {
  to: string | null;
  from: string;
  value: bigint;
}

export interface RawReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: readonly RawLog[];
}

/**
 * Sum of USDT credited to `recipient` by this receipt's logs.
 *
 * Reading the Transfer logs — rather than the transaction's calldata — is what
 * makes this safe: it counts what the token contract actually recorded, so a
 * transfer routed through a proxy, a multicall or a contract wallet still
 * counts, and a call that reverted internally does not.
 */
export function usdtDelta(logs: readonly RawLog[], usdtAddress: string, recipient: string): number {
  let raw = 0n;
  for (const log of logs) {
    if (!sameAddress(log.address, usdtAddress)) continue;
    if (log.topics.length < 3 || !sameAddress(log.topics[0] ?? "", TRANSFER_TOPIC)) continue;
    if (!sameAddress(topicToAddress(log.topics[2] ?? ""), recipient)) continue;
    raw += BigInt(log.data);
  }
  return Number(formatUnits(raw, USDT_DECIMALS));
}

/**
 * Pure validation of an already-fetched transaction — no network.
 *
 * This is the security core. A deposit counts only if it landed in the address
 * derived for *this* user, which is what binds a payment to an account now that
 * there is no memo to carry the user id (Ethereum has no equivalent of Solana's
 * memo program). Idempotency — one credit per transaction hash — is enforced by
 * the DB layer, not here.
 */
export function interpretTx(
  tx: RawTx,
  receipt: RawReceipt,
  headBlock: bigint,
  cfg: Pick<EthConfig, "usdtAddress" | "ethUsdPrice" | "confirmations">,
  depositAddress: string,
): VerifyResult {
  if (receipt.status !== "success") throw new Error("transaction reverted on-chain");

  const confirmations = headBlock - receipt.blockNumber + 1n;
  if (confirmations < BigInt(cfg.confirmations)) {
    throw new Error(
      `only ${confirmations} confirmation(s) — waiting for ${cfg.confirmations} before crediting`,
    );
  }

  // Native ETH: a plain transfer straight to the user's deposit address.
  if (tx.value > 0n && sameAddress(tx.to, depositAddress)) {
    const eth = Number(formatEther(tx.value));
    const credits = Math.floor(eth * cfg.ethUsdPrice * 100); // 1 credit = $0.01
    if (credits <= 0) throw new Error("deposit too small to credit");
    return { credits, currency: "ETH", amount: eth, sender: tx.from };
  }

  // USDT: 1 USDT = $1 = 100 credits.
  const usdt = usdtDelta(receipt.logs, cfg.usdtAddress, depositAddress);
  if (usdt > 0) {
    const credits = Math.floor(usdt * 100);
    if (credits <= 0) throw new Error("deposit too small to credit");
    return { credits, currency: "USDT", amount: usdt, sender: tx.from };
  }

  throw new Error(
    "no ETH or USDT transfer to your deposit address in this transaction — " +
      "did you send it to the address shown on your dashboard?",
  );
}

export function makeEth(cfg: EthConfig) {
  const chain = cfg.chain === "mainnet" ? mainnet : sepolia;
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  /**
   * The deposit address for a user, derived from the master mnemonic at
   * `m/44'/60'/0'/0/<index>`. Deterministic: the same index always yields the
   * same address, so the mapping survives a database restore.
   */
  function depositAddressFor(index: number): string {
    return mnemonicToAccount(cfg.mnemonic, { addressIndex: index }).address;
  }

  /**
   * Verify a deposit of ETH or USDT into this user's own deposit address and
   * convert it to credits. `ethUsdPrice` is the live rate; USDT is 1:1.
   */
  async function verifyDeposit(
    txHash: string,
    depositAddress: string,
    ethUsdPrice: number,
  ): Promise<VerifyResult> {
    const hash = txHash as `0x${string}`;
    const [tx, receipt, headBlock] = await Promise.all([
      client.getTransaction({ hash }).catch(() => null),
      client.getTransactionReceipt({ hash }).catch(() => null),
      client.getBlockNumber(),
    ]);
    if (!tx || !receipt) {
      throw new Error("transaction not found or not yet mined — try again in a moment");
    }
    return interpretTx(tx, receipt, headBlock, { ...cfg, ethUsdPrice }, depositAddress);
  }

  return { verifyDeposit, depositAddressFor, client };
}

/** Validate a 0x address at boot so misconfiguration fails loudly. */
export function isValidAddress(s: string): boolean {
  return isAddress(s, { strict: false });
}

/** Transaction hashes are 32 bytes of hex — reject anything else before an RPC call. */
export function isValidTxHash(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}
