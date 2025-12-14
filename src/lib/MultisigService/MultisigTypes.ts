/**
 * Multisig Types
 * Simplified configuration types for multisig setup
 */

import type { PublicKey } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiNetwork } from '../SuiModule/types.js';

// ============================================================================
// Error Types
// ============================================================================

export enum MultisigErrorCode {
	// Config errors
	INVALID_CONFIG = 'INVALID_CONFIG',
	INVALID_THRESHOLD = 'INVALID_THRESHOLD',
	INVALID_SIGNER = 'INVALID_SIGNER',

	// Resolution errors
	SIGNER_NOT_RESOLVED = 'SIGNER_NOT_RESOLVED',
	WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
	PUBLIC_KEY_PARSE_ERROR = 'PUBLIC_KEY_PARSE_ERROR',

	// Proposal errors
	PROPOSAL_NOT_READY = 'PROPOSAL_NOT_READY',
	INSUFFICIENT_SIGNATURES = 'INSUFFICIENT_SIGNATURES',
	SIGNER_MISMATCH = 'SIGNER_MISMATCH',

	// Execution errors
	EXECUTION_FAILED = 'EXECUTION_FAILED'
}

export class MultisigError extends Error {
	constructor(
		public code: MultisigErrorCode,
		message: string,
		public cause?: Error
	) {
		super(message);
		this.name = 'MultisigError';
	}
}

// ============================================================================
// Signer Types
// ============================================================================

/** Key types for public key signers */
export type SignerKeyType = 'ed25519' | 'secp256k1' | 'secp256r1' | 'passkey' | 'zklogin';

/** Internal signer type after resolution */
export type ResolvedSignerType = 'ed25519' | 'secp256k1' | 'secp256r1' | 'zklogin' | 'passkey';

/** Passkey signer - uses connected passkey wallet */
export interface PasskeySigner {
	type: 'passkey';
	weight?: number;
	name?: string;
	/** Passkey address for persistence */
	address?: string;
}

/** ZkLogin signer - uses connected zkLogin wallet */
export interface ZkLoginSigner {
	type: 'zklogin';
	weight?: number;
	name?: string;
	/** zkLogin address for persistence */
	address?: string;
}

/** Wallet signer - resolves from connected wallet by address */
export interface WalletSigner {
	type: 'wallet';
	address: string;
	weight?: number;
	name?: string;
}

/** Public key signer - uses raw public key directly */
export interface PublicKeySigner {
	type: 'publicKey';
	publicKey: string; // base64 encoded
	keyType: SignerKeyType;
	weight?: number;
	name?: string;
	/** Optional: wallet address for display purposes */
	address?: string;
}

/** Union type for all signer definitions */
export type MultisigSigner = PasskeySigner | ZkLoginSigner | WalletSigner | PublicKeySigner;

// ============================================================================
// Config Types
// ============================================================================

/** Mode 1: Pre-configured multisig with fixed signers */
export interface MultisigPreConfig {
	mode: 'preconfigured';
	threshold: number;
	signers: MultisigSigner[];
	name?: string;
	network?: SuiNetwork;
}

/** Mode 2: Dynamic multisig where users can add/remove signers */
export interface MultisigDynamicConfig {
	mode: 'dynamic';
	network?: SuiNetwork;
	/** Optional: load existing config from localStorage */
	storageKey?: string;
	/** Optional: initial threshold (default: 1) */
	defaultThreshold?: number;
}

/** Union type for all config modes */
export type MultisigConfig = MultisigPreConfig | MultisigDynamicConfig;

// ============================================================================
// Resolved Signer Types
// ============================================================================

/** A signer after public key resolution */
export interface ResolvedSigner {
	id: string;
	type: ResolvedSignerType;
	weight: number;
	name?: string;
	publicKey?: PublicKey;
	/** Public key as base64 string for display */
	publicKeyBase64?: string;
	/** For zkLogin signers */
	addressSeed?: string;
	issuer?: string;
	/** Wallet address for display */
	address?: string;
	/** Resolution status */
	resolved: boolean;
	error?: string;
}

// ============================================================================
// State Types
// ============================================================================

/** Reactive state for multisig */
export interface MultisigState {
	// Configuration
	config: MultisigConfig | null;
	threshold: number;
	mode: 'preconfigured' | 'dynamic' | null;

	// Signers
	signers: ResolvedSigner[];
	resolvedCount: number;
	totalWeight: number;

	// Derived address
	address: string | null;
	addressReady: boolean;

	// Status
	isReady: boolean;
	error: string | null;
}

// ============================================================================
// Proposal Types
// ============================================================================

/** Status of a signer's signature */
export interface SignerSignatureStatus {
	signerId: string;
	signed: boolean;
	signature?: string;
	error?: string;
}

/** Result of transaction execution */
export interface ExecuteResult {
	digest: string;
	effects: any;
	events?: any[];
	error?: string;
}

/** Proposal for collecting signatures */
export interface MultisigProposal {
	id: string;
	transaction: Transaction;
	txBytes: Uint8Array;
	multisigAddress: string;
	threshold: number;

	// Signature state
	signatures: Map<string, string>;
	signedWeight: number;
	canExecute: boolean;

	// Actions
	signWithCurrentWallet: () => Promise<void>;
	signWithSigner: (signerId: string, signature: string) => void;
	execute: () => Promise<ExecuteResult>;

	// Status
	getSignerStatus: (signerId: string) => SignerSignatureStatus;
	getSignerStatuses: () => SignerSignatureStatus[];
}

// ============================================================================
// Hook Return Types
// ============================================================================

/** Return type for useMultisig hook */
export interface UseMultisigReturn {
	// State
	state: MultisigState;
	address: string | null;
	isReady: boolean;
	signers: ResolvedSigner[];
	mode: 'preconfigured' | 'dynamic' | null;
	threshold: number;

	// Actions (both modes)
	createProposal: (tx: Transaction) => Promise<MultisigProposal>;
	refreshSigners: () => Promise<void>;

	// Actions (dynamic mode only)
	addSignerFromCurrentWallet: (options?: { weight?: number; name?: string }) => Promise<void>;
	addSigner: (signer: MultisigSigner) => Promise<void>;
	removeSigner: (signerId: string) => void;
	setThreshold: (threshold: number) => void;
	saveConfig: () => void;
	loadConfig: () => void;
	clearConfig: () => void;
}

// ============================================================================
// Resolver Types
// ============================================================================

/** Context for resolving signers */
export interface ResolverContext {
	passkeyPublicKey?: PublicKey;
	passkeyAddress?: string;
	zkLoginPublicIdentifier?: PublicKey;
	zkLoginAddressSeed?: string;
	zkLoginIssuer?: string;
	zkLoginAddress?: string;
	connectedWallets: Map<string, { address: string; publicKey?: PublicKey }>;
}
