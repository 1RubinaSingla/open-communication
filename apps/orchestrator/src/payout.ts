import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { USDT_DECIMALS } from "./eth.js";

/**
 * Parse a treasury private key. Accepts the usual MetaMask export shape (32
 * bytes of hex, with or without the 0x prefix).
 */
export function loadAccount(secret: string) {
  const s = secret.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error("bad TREASURY_PRIVATE_KEY (expected 32 bytes of hex)");
  }
  return privateKeyToAccount(`0x${s}`);
}

export interface PayoutResult {
  signature?: string;
  submitted: boolean; // true once a tx was sent to the network
  error?: string;
}

/**
 * Withdrawal payouts from the treasury.
 *
 * `submitted` tells the caller whether a transaction actually reached the
 * network. Once it has, credits must NOT be refunded on a later error — the
 * money may well be moving — which is why every send flips the flag the instant
 * the broadcast resolves, before waiting for the receipt.
 */
export function makePayout(cfg: {
  rpcUrl: string;
  chain: "mainnet" | "sepolia";
  usdtAddress: string;
  privateKey: string;
}) {
  const chain = cfg.chain === "mainnet" ? mainnet : sepolia;
  const account = loadAccount(cfg.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  /** Send USDT from the treasury to `recipient`. */
  async function payUsdt(
    recipient: string,
    amountUsdt: number,
    onSignature: (sig: string) => void,
  ): Promise<PayoutResult> {
    let submitted = false;
    try {
      if (!isAddress(recipient, { strict: false })) throw new Error("invalid recipient address");
      const value = parseUnits(String(amountUsdt), USDT_DECIMALS);

      const hash = await wallet.writeContract({
        address: cfg.usdtAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient as `0x${string}`, value],
      });
      onSignature(hash);
      submitted = true; // it's on the network now — do NOT refund on later uncertainty

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return { signature: hash, submitted: true, error: "transfer reverted on-chain" };
      }
      return { signature: hash, submitted: true };
    } catch (err) {
      return { submitted, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Send native ETH from the treasury to `recipient`. Same submitted-flag safety. */
  async function payEth(
    recipient: string,
    amountEth: number,
    onSignature: (sig: string) => void,
  ): Promise<PayoutResult> {
    let submitted = false;
    try {
      if (!isAddress(recipient, { strict: false })) throw new Error("invalid recipient address");

      const hash = await wallet.sendTransaction({
        to: recipient as `0x${string}`,
        value: parseEther(String(amountEth)),
      });
      onSignature(hash);
      submitted = true;

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return { signature: hash, submitted: true, error: "transfer reverted on-chain" };
      }
      return { signature: hash, submitted: true };
    } catch (err) {
      return { submitted, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { payUsdt, payEth, treasuryAddress: account.address };
}
