// Registration and escrow tooling for the Skein miner (spec section 4).
//
//   npx tsx miner/tools.ts status [address]          escrow balance, debt, wallet USDC, MACHINA and ETH (read-only)
//   npx tsx miner/tools.ts mint-usdc <usdc> [--as registration] [--yes]   mint Telegraph test USDC to the key's own address
//   npx tsx miner/tools.ts check-intent <INTENT>     isCanonicalIntent (read-only)
//   npx tsx miner/tools.ts hash [yaml]               the registration hash: SHA-256 of the raw YAML bytes
//   npx tsx miner/tools.ts deposit <usdc> [--yes]    approve(Diamond) + depositUSDC; simulated without --yes
//   npx tsx miner/tools.ts swap-machina <usdc> [--yes]     buy MACHINA (for the registration bond) on the Sepolia pool
//   npx tsx miner/tools.ts approve-bond <machina> [--yes]  let the Diamond take the MACHINA bond at registration
//   npx tsx miner/tools.ts register --yaml-url <https://…> --fee-address <0x…> --min-price-usdc <n> --intent <INTENT> [--yes]
//
// Transactions are simulated first and sent only with --yes. Keys come from
// the environment (PURCHASER_PRIVATE_KEY for deposits, MINER_REGISTRATION_KEY
// for the bond and registration; spec section 9: the registration key is cold).
// Network settings come from the same TELEGRAPH_* variables as the API, plus
// TELEGRAPH_MACHINA and UNISWAP_ROUTER (Sepolia defaults below).
//
// Order for a first registration (both keys need Sepolia ETH for gas):
//   mint-usdc 3 --as registration --yes → swap-machina 2 --yes → approve-bond 5 --yes → register … --yes
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { networkFromEnv } from "@skein/telegraph";
import { createPublicClient, createWalletClient, erc20Abi, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const DIAMOND_ABI = parseAbi([
  "function depositUSDC(uint256 amount)",
  "function effectiveBalance(address account) view returns (int256)",
  "function agentDebt(address account) view returns (uint256)",
  "function isCanonicalIntent(string intent) view returns (bool)",
  "function registerMiner(string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPrice, string[] intents)",
]);
const TOKEN_ABI = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
// Uniswap SwapRouter02 (no deadline field in the struct).
const ROUTER_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

const net = networkFromEnv();
const diamond = net.diamond as Hex;
const usdc = net.usdc as Hex;
const machina = (process.env.TELEGRAPH_MACHINA ?? "0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4") as Hex;
const router = (process.env.UNISWAP_ROUTER ?? "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E") as Hex;
const MACHINA_POOL_FEE = 3000; // the MACHINA/USDC pool's 0.3% tier
const chain = { ...sepolia, id: net.chainId };
const pub = createPublicClient({ chain, transport: http(net.rpcUrl) });
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    yes: { type: "boolean", default: false },
    "yaml-url": { type: "string" },
    "fee-address": { type: "string" },
    "min-price-usdc": { type: "string" },
    intent: { type: "string" },
    as: { type: "string" },
  },
});
const [cmd, arg] = positionals;
const usdcUnits = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`not a positive USDC amount: ${s}`);
  return BigInt(Math.round(n * 1e6));
};
const account = (envName: string) => {
  const key = process.env[envName] as Hex | undefined;
  if (!key) throw new Error(`${envName} is not set`);
  return privateKeyToAccount(key);
};

type Call = { address: Hex; abi: typeof DIAMOND_ABI | typeof erc20Abi | typeof TOKEN_ABI | typeof ROUTER_ABI; functionName: string; args: readonly unknown[] };

/**
 * Simulates, then sends with --yes. A step that depends on an earlier one in
 * the same command (a transfer after its approval) cannot be simulated until
 * that one is mined, so without --yes it is only described.
 */
async function send(envName: string, call: Call, opts: { afterPrevious?: boolean } = {}) {
  const who = account(envName);
  if (opts.afterPrevious && !values.yes) {
    console.log(`not simulated: ${call.functionName} needs the step above to be mined first (add --yes to send both)`);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await pub.simulateContract({ ...(call as any), account: who });
  console.log(`simulated ${call.functionName} from ${who.address}: ok`);
  if (!values.yes) {
    console.log("not sent (add --yes to send)");
    return null;
  }
  const wallet = createWalletClient({ account: who, chain, transport: http(net.rpcUrl) });
  const hash = await wallet.writeContract(request);
  console.log(`sent ${call.functionName}: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`mined in block ${receipt.blockNumber}, status ${receipt.status}`);
  return receipt;
}

switch (cmd) {
  case "status": {
    const who = (arg ?? (process.env.PURCHASER_PRIVATE_KEY ? account("PURCHASER_PRIVATE_KEY").address : undefined)) as Hex | undefined;
    if (!who) throw new Error("give an address or set PURCHASER_PRIVATE_KEY");
    const [eff, debt, bal, mach, eth] = await Promise.all([
      pub.readContract({ address: diamond, abi: DIAMOND_ABI, functionName: "effectiveBalance", args: [who] }),
      pub.readContract({ address: diamond, abi: DIAMOND_ABI, functionName: "agentDebt", args: [who] }),
      pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
      pub.readContract({ address: machina, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
      pub.getBalance({ address: who }),
    ]);
    console.log(
      JSON.stringify(
        { address: who, escrowEffectiveUsdc: Number(eff) / 1e6, agentDebtUsdc: Number(debt) / 1e6, walletUsdc: Number(bal) / 1e6, walletMachina: Number(mach) / 1e18, walletEth: Number(eth) / 1e18 },
        null,
        2,
      ),
    );
    break;
  }
  case "check-intent": {
    if (!arg) throw new Error("usage: check-intent <INTENT>");
    console.log(`${arg}: canonical=${await pub.readContract({ address: diamond, abi: DIAMOND_ABI, functionName: "isCanonicalIntent", args: [arg] })}`);
    break;
  }
  case "hash": {
    const bytes = readFileSync(arg ?? new URL("./skein-miner.yaml", import.meta.url));
    console.log(`0x${createHash("sha256").update(bytes).digest("hex")}`);
    break;
  }
  case "deposit": {
    if (!arg) throw new Error("usage: deposit <usdc> [--yes]");
    const amount = usdcUnits(arg);
    await send("PURCHASER_PRIVATE_KEY", { address: usdc, abi: erc20Abi, functionName: "approve", args: [diamond, amount] });
    await send("PURCHASER_PRIVATE_KEY", { address: diamond, abi: DIAMOND_ABI, functionName: "depositUSDC", args: [amount] }, { afterPrevious: true });
    break;
  }
  case "mint-usdc": {
    // The Telegraph test USDC lets anyone mint; this mints to the key's own address.
    if (!arg) throw new Error("usage: mint-usdc <usdc> [--as registration] [--yes]");
    const envName = values.as === "registration" ? "MINER_REGISTRATION_KEY" : "PURCHASER_PRIVATE_KEY";
    await send(envName, { address: usdc, abi: TOKEN_ABI, functionName: "mint", args: [account(envName).address, usdcUnits(arg)] });
    break;
  }
  case "swap-machina": {
    // MACHINA pays the registration bond ($1 for the first intent, at the pool price).
    if (!arg) throw new Error("usage: swap-machina <usdc> [--yes]");
    const amount = usdcUnits(arg);
    const me = account("MINER_REGISTRATION_KEY").address;
    await send("MINER_REGISTRATION_KEY", { address: usdc, abi: TOKEN_ABI, functionName: "approve", args: [router, amount] });
    await send(
      "MINER_REGISTRATION_KEY",
      {
        address: router, abi: ROUTER_ABI, functionName: "exactInputSingle",
        // amountOutMinimum 0: test tokens on a testnet pool; never do this with value.
        args: [{ tokenIn: usdc, tokenOut: machina, fee: MACHINA_POOL_FEE, recipient: me, amountIn: amount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
      },
      { afterPrevious: true },
    );
    break;
  }
  case "approve-bond": {
    if (!arg) throw new Error("usage: approve-bond <machina> [--yes]");
    const n = Number(arg);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error(`not a MACHINA amount from 0 to 1000: ${arg}`);
    const amount = BigInt(Math.round(n * 1e6)) * 10n ** 12n; // 18 decimals
    // Only the USD bond at the pool price is taken; the rest of the allowance stays unused.
    await send("MINER_REGISTRATION_KEY", { address: machina, abi: TOKEN_ABI, functionName: "approve", args: [diamond, amount] });
    break;
  }
  case "register": {
    const yamlUrl = values["yaml-url"];
    const fee = values["fee-address"] as Hex | undefined;
    const intent = values.intent;
    if (!yamlUrl?.startsWith("https://") || !fee || !/^0x[0-9a-fA-F]{40}$/.test(fee) || !values["min-price-usdc"] || !intent) {
      throw new Error("usage: register --yaml-url <https://…> --fee-address <0x…> --min-price-usdc <n> --intent <INTENT> [--yes]");
    }
    // The hash must be of the bytes served at yamlUrl, so fetch them rather than trust a local copy.
    const served = Buffer.from(await (await fetch(yamlUrl)).arrayBuffer());
    const yamlHash = `0x${createHash("sha256").update(served).digest("hex")}` as Hex;
    if (/^id:\s*0\b/m.test(served.toString("utf8"))) throw new Error("the served YAML still has id: 0");
    if (!(await pub.readContract({ address: diamond, abi: DIAMOND_ABI, functionName: "isCanonicalIntent", args: [intent] }))) {
      throw new Error(`${intent} is not canonical yet: propose it (or use plan B) before registering`);
    }
    console.log(`yaml ${yamlUrl}\nhash ${yamlHash}`);
    const receipt = await send("MINER_REGISTRATION_KEY", {
      address: diamond, abi: DIAMOND_ABI, functionName: "registerMiner",
      args: [yamlUrl, yamlHash, fee, usdcUnits(values["min-price-usdc"]), [intent]],
    });
    if (receipt) {
      // The MinerRegistered event layout is not in the docs we have: print the logs; the registration ID is in them.
      for (const l of receipt.logs.filter((x) => x.address.toLowerCase() === diamond.toLowerCase())) console.log(JSON.stringify({ topics: l.topics, data: l.data }));
      console.log("then poll https://devnode.telegraphprotocol.com/api/miners/<registrationId> until active, and set SKEIN_SELF_REGISTRATION_IDS");
    }
    break;
  }
  default:
    console.error("commands: status | check-intent | hash | mint-usdc | deposit | swap-machina | approve-bond | register (see the header of miner/tools.ts)");
    process.exit(64);
}
