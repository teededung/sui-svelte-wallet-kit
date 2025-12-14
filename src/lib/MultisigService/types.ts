/**
 * MultisigService Types
 * Defines interfaces and types for multisig wallet operations
 */

import type { PublicKey } from '@mysten/sui/cryptography';

// Error codes for multisig operations
export enum MultisigErrorCode {
	INVALID_CONFIG = 'INVALID_CONFIG',
	INVALID_THRESHOLD = 'INVALID_THRESHOLD',
	INVALID_SIGNER = 'INVALID_SIGNER',
	INSUFFICIENT_SIGNATURES = 'INSUFFICIENT_SIGNATURES',
	SIGNER_NOT_FOUND = 'SIGNER_NOT_FOUND',
	SIGNATURE_FAILED = 'SIGNATURE_FAILED',
	NETWORK_ERROR = 'NETWORK_ERROR'
}

// Custom error class for multisig operations
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

// Supported signer types
export type SignerType = 'ed25519' | 'secp256k1' | 'secp256r1' | 'zklogin' | 'passkey';

// Signer configuration
export interface SignerConfig {
	/** Unique identifier for this signer */
	id: string;
	/** Type of signer */
	type: SignerType;
	/** Weight of this signer (default: 1) */
	weight: number;
	/** Public key (required for ed25519, secp256k1, secp256r1, passkey) */
	publicKey?: PublicKey;
	/** zkLogin address seed (required for zklogin type) */
	addressSeed?: string;
	/** zkLogin issuer (required for zklogin type) */
	issuer?: string;
	/** Display name for UI */
	name?: string;
}

// Multisig configuration
export interface MultisigConfig {
	/** Threshold required to execute transactions */
	threshold: number;
	/** List of signers */
	signers: SignerConfig[];
	/** Optional name for this multisig wallet */
	name?: string;
}

// Signer status during signature collection
export interface SignerStatus {
	id: string;
	name?: string;
	type: SignerType;
	weight: number;
	/** Whether this signer is available for signing */
	available: boolean;
	/** Whether signature has been collected */
	signed: boolean;
	/** Error message if signing failed */
	error?: string;
}

// Signature collection result
export interface SignatureCollectionResult {
	/** Combined multisig signature */
	signature: string;
	/** Total weight collected */
	totalWeight: number;
	/** Status of each signer */
	signerStatuses: SignerStatus[];
	/** Whether threshold was met */
	thresholdMet: boolean;
}

// Callback for signature collection progress
export type SignatureProgressCallback = (status: {
	currentSigner: SignerConfig;
	collectedWeight: number;
	threshold: number;
	signerStatuses: SignerStatus[];
}) => void;

// Options for signature collection
export interface CollectSignaturesOptions {
	/** Transaction bytes to sign */
	txBytes: Uint8Array;
	/** Callback for progress updates */
	onProgress?: SignatureProgressCallback;
	/** Signers to skip (by id) */
	skipSigners?: string[];
	/** Previously collected signatures (for retry) */
	existingSignatures?: Map<string, string>;
}

// Multisig account info
export interface MultisigAccountInfo {
	/** Multisig address */
	address: string;
	/** Current configuration */
	config: MultisigConfig;
	/** Total weight of all signers */
	totalWeight: number;
}
