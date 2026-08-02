import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseEther,
  parseUnits,
  erc20Abi,
  type EIP1193Provider,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

const USDT_DECIMALS = 6;

function chainFor(name: string) {
  return name === "mainnet" ? mainnet : sepolia;
}

/**
 * Any EIP-1193 injected wallet — MetaMask, Rabby, Coinbase Wallet, Frame. We
 * deliberately don't require a specific one.
 */
function getProvider(): EIP1193Provider {
  const p = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!p) {
    throw new Error("No Ethereum wallet found. Install MetaMask or another browser wallet.");
  }
  return p;
}

function walletClient(chainName: string) {
  const provider = getProvider();
  return createWalletClient({ chain: chainFor(chainName), transport: custom(provider) });
}

/** Prompt the wallet for access and return the selected address. */
export async function connectWallet(): Promise<string> {
  const [address] = await walletClient("mainnet").requestAddresses();
  if (!address) throw new Error("no account selected in your wallet");
  return address;
}

/**
 * Ask the wallet to switch networks, adding nothing and forcing nothing — if
 * the user declines we surface it rather than sending to the wrong chain.
 */
async function ensureChain(chainName: string) {
  const chain = chainFor(chainName);
  const client = walletClient(chainName);
  const current = await client.getChainId();
  if (current === chain.id) return;
  try {
    await client.switchChain({ id: chain.id });
  } catch {
    throw new Error(`Please switch your wallet to ${chain.name} and try again.`);
  }
}

/**
 * Send ETH to the account's own deposit address. There is no memo: the deposit
 * is bound to the account by the destination address itself, which the server
 * derives per user.
 */
export async function depositEth(params: {
  chain: string;
  depositAddress: string;
  amountEth: number;
}): Promise<{ hash: string; from: string }> {
  await ensureChain(params.chain);
  const client = walletClient(params.chain);
  const [from] = await client.requestAddresses();
  if (!from) throw new Error("no account selected in your wallet");

  const hash = await client.sendTransaction({
    account: from,
    to: params.depositAddress as `0x${string}`,
    value: parseEther(String(params.amountEth)),
  });
  return { hash, from };
}

/** Send USDT (ERC-20) to the account's own deposit address. */
export async function depositUsdt(params: {
  chain: string;
  depositAddress: string;
  usdtAddress: string;
  amountUsdt: number;
}): Promise<{ hash: string; from: string }> {
  await ensureChain(params.chain);
  const client = walletClient(params.chain);
  const [from] = await client.requestAddresses();
  if (!from) throw new Error("no account selected in your wallet");

  const hash = await client.writeContract({
    account: from,
    chain: chainFor(params.chain),
    address: params.usdtAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: "transfer",
    args: [
      params.depositAddress as `0x${string}`,
      parseUnits(String(params.amountUsdt), USDT_DECIMALS),
    ],
  });
  return { hash, from };
}

/**
 * Prove control of a wallet by signing a server-issued challenge (EIP-191
 * personal_sign). Signing a message authorises no transaction and cannot move
 * funds.
 */
export async function signWalletChallenge(
  message: string,
): Promise<{ wallet: string; signature: string }> {
  const client = walletClient("mainnet");
  const [wallet] = await client.requestAddresses();
  if (!wallet) throw new Error("no account selected in your wallet");
  const signature = await client.signMessage({ account: wallet, message });
  return { wallet, signature };
}

/** Wait for the deposit to be mined before asking the server to verify it. */
export async function waitForTx(chain: string, hash: string, rpcUrl?: string): Promise<void> {
  const client = createPublicClient({
    chain: chainFor(chain),
    transport: rpcUrl ? http(rpcUrl) : custom(getProvider()),
  });
  await client.waitForTransactionReceipt({ hash: hash as `0x${string}` });
}

export function explorerTx(hash: string, chain: string): string {
  const base = chain === "mainnet" ? "https://etherscan.io" : "https://sepolia.etherscan.io";
  return `${base}/tx/${hash}`;
}

export function explorerAddress(address: string, chain: string): string {
  const base = chain === "mainnet" ? "https://etherscan.io" : "https://sepolia.etherscan.io";
  return `${base}/address/${address}`;
}
