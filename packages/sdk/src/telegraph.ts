/**
 * The Telegraph rail: pay for each verdict from your own escrow, with no
 * Skein account. Import from "@skeinlabs/sdk/telegraph" (needs viem).
 *
 *   import { Skein } from "@skeinlabs/sdk";
 *   import { TelegraphClient, TESTNET, viemSigner } from "@skeinlabs/sdk/telegraph";
 *
 *   const client = new TelegraphClient({ network: TESTNET, signer: viemSigner(key), maxUusdcPerCall: 300_000 });
 *   const skein = new Skein({ apiUrl, payer: { kind: "telegraph", client } });
 *
 * The client reads each 402 challenge, refuses one above maxUusdcPerCall or
 * one whose signed message does not match its own fields, signs with EIP-191,
 * and never retries a call after paying for it.
 */
export {
  TelegraphClient,
  viemSigner,
  networkFromEnv,
  TESTNET,
  PreSeasonError,
  ChallengeMismatchError,
} from "@skein/telegraph";
export type { NetworkConfig, ClientOptions, AskOutcome, AskRequest, AskResponse, AskFailureKind, MessageSigner, Receipt } from "@skein/telegraph";
