/**
 * MultisigService
 * Handles multisig wallet operations including address derivation and signature collection
 */

import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin';
import type { PublicKey } from '@mysten/sui/cryptography';
import {
	MultisigError,
	MultisigErrorCode,
	type MultisigConfig,
	type SignerConfig,
	type SignerStatus,
	type SignatureCollectionResult,
	type CollectSignaturesOptions,
	type MultisigAccountInfo
} from './types.js';

/**
 * MultisigService class for multisig wallet operations
 */
export class MultisigService {
	private config: MultisigConfig;
	private multiSigPublicKey: MultiSigPublicKey | null = null;

	constructor(config: MultisigConfig) {
		this.validateConfig(config);
		this.config = config;
		this.multiSigPublicKey = this.createMultiSigPublicKey();
	}

	/**
	 * Validate multisig configuration
	 */
	private validateConfig(config: MultisigConfig): void {
		if (!config.signers || config.signers.length === 0) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_CONFIG,
				'MultisigConfig requires at least one signer'
			);
		}

		if (typeof config.threshold !== 'number' || config.threshold < 1) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_THRESHOLD,
				'Threshold must be a positive number'
			);
		}

		// Calculate total weight
		const totalWeight = config.signers.reduce((sum, s) => sum + (s.weight || 1), 0);

		if (config.threshold > totalWeight) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_THRESHOLD,
				`Threshold (${config.threshold}) cannot exceed total signer weight (${totalWeight})`
			);
		}

		// Validate each signer
		for (const signer of config.signers) {
			this.validateSigner(signer);
		}

		// Check for duplicate signer IDs
		const ids = config.signers.map((s) => s.id);
		const uniqueIds = new Set(ids);
		if (ids.length !== uniqueIds.size) {
			throw new MultisigError(MultisigErrorCode.INVALID_CONFIG, 'Duplicate signer IDs found');
		}
	}

	/**
	 * Validate individual signer configuration
	 */
	private validateSigner(signer: SignerConfig): void {
		if (!signer.id) {
			throw new MultisigError(MultisigErrorCode.INVALID_SIGNER, 'Signer must have an id');
		}

		if (typeof signer.weight !== 'number' || signer.weight < 1) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_SIGNER,
				`Signer ${signer.id}: weight must be a positive number`
			);
		}

		// Validate based on signer type
		switch (signer.type) {
			case 'ed25519':
			case 'secp256k1':
			case 'secp256r1':
			case 'passkey':
				if (!signer.publicKey) {
					throw new MultisigError(
						MultisigErrorCode.INVALID_SIGNER,
						`Signer ${signer.id}: ${signer.type} signer requires publicKey`
					);
				}
				break;

			case 'zklogin':
				if (!signer.addressSeed || !signer.issuer) {
					throw new MultisigError(
						MultisigErrorCode.INVALID_SIGNER,
						`Signer ${signer.id}: zklogin signer requires addressSeed and issuer`
					);
				}
				break;

			default:
				throw new MultisigError(
					MultisigErrorCode.INVALID_SIGNER,
					`Signer ${signer.id}: unknown signer type ${signer.type}`
				);
		}
	}

	/**
	 * Create MultiSigPublicKey from config
	 */
	private createMultiSigPublicKey(): MultiSigPublicKey {
		const publicKeys: { publicKey: PublicKey; weight: number }[] = [];

		for (const signer of this.config.signers) {
			const pk = this.getPublicKeyForSigner(signer);
			publicKeys.push({
				publicKey: pk,
				weight: signer.weight
			});
		}

		return MultiSigPublicKey.fromPublicKeys({
			threshold: this.config.threshold,
			publicKeys
		});
	}

	/**
	 * Get PublicKey object for a signer
	 */
	private getPublicKeyForSigner(signer: SignerConfig): PublicKey {
		switch (signer.type) {
			case 'ed25519':
			case 'secp256k1':
			case 'secp256r1':
			case 'passkey':
				if (!signer.publicKey) {
					throw new MultisigError(
						MultisigErrorCode.INVALID_SIGNER,
						`Signer ${signer.id}: missing publicKey`
					);
				}
				return signer.publicKey;

			case 'zklogin':
				if (!signer.addressSeed || !signer.issuer) {
					throw new MultisigError(
						MultisigErrorCode.INVALID_SIGNER,
						`Signer ${signer.id}: missing addressSeed or issuer`
					);
				}
				// addressSeed needs to be BigInt for toZkLoginPublicIdentifier
				return toZkLoginPublicIdentifier(BigInt(signer.addressSeed), signer.issuer);

			default:
				throw new MultisigError(
					MultisigErrorCode.INVALID_SIGNER,
					`Unknown signer type: ${signer.type}`
				);
		}
	}

	/**
	 * Get the multisig address
	 */
	getAddress(): string {
		if (!this.multiSigPublicKey) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_CONFIG,
				'MultiSigPublicKey not initialized'
			);
		}
		return this.multiSigPublicKey.toSuiAddress();
	}

	/**
	 * Get the MultiSigPublicKey instance
	 */
	getMultiSigPublicKey(): MultiSigPublicKey {
		if (!this.multiSigPublicKey) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_CONFIG,
				'MultiSigPublicKey not initialized'
			);
		}
		return this.multiSigPublicKey;
	}

	/**
	 * Get current configuration
	 */
	getConfig(): MultisigConfig {
		return { ...this.config };
	}

	/**
	 * Get account info
	 */
	getAccountInfo(): MultisigAccountInfo {
		const totalWeight = this.config.signers.reduce((sum, s) => sum + s.weight, 0);
		return {
			address: this.getAddress(),
			config: this.getConfig(),
			totalWeight
		};
	}

	/**
	 * Get total weight of all signers
	 */
	getTotalWeight(): number {
		return this.config.signers.reduce((sum, s) => sum + s.weight, 0);
	}

	/**
	 * Get signer by ID
	 */
	getSigner(id: string): SignerConfig | undefined {
		return this.config.signers.find((s) => s.id === id);
	}

	/**
	 * Get all signers
	 */
	getSigners(): SignerConfig[] {
		return [...this.config.signers];
	}

	/**
	 * Combine partial signatures into a multisig signature
	 */
	combineSignatures(signatures: string[]): string {
		if (!this.multiSigPublicKey) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_CONFIG,
				'MultiSigPublicKey not initialized'
			);
		}

		if (signatures.length === 0) {
			throw new MultisigError(MultisigErrorCode.INSUFFICIENT_SIGNATURES, 'No signatures provided');
		}

		return this.multiSigPublicKey.combinePartialSignatures(signatures);
	}

	/**
	 * Verify if collected signatures meet threshold
	 */
	verifyThreshold(signerIds: string[]): boolean {
		const collectedWeight = signerIds.reduce((sum, id) => {
			const signer = this.getSigner(id);
			return sum + (signer?.weight || 0);
		}, 0);

		return collectedWeight >= this.config.threshold;
	}

	/**
	 * Get initial signer statuses
	 */
	getInitialSignerStatuses(): SignerStatus[] {
		return this.config.signers.map((signer) => ({
			id: signer.id,
			name: signer.name,
			type: signer.type,
			weight: signer.weight,
			available: true,
			signed: false
		}));
	}

	/**
	 * Update configuration (creates new MultiSigPublicKey)
	 * Returns the new address
	 */
	updateConfig(newConfig: MultisigConfig): string {
		this.validateConfig(newConfig);
		this.config = newConfig;
		this.multiSigPublicKey = this.createMultiSigPublicKey();
		return this.getAddress();
	}

	/**
	 * Add a signer to the configuration
	 * Returns the new address
	 */
	addSigner(signer: SignerConfig): string {
		this.validateSigner(signer);

		// Check for duplicate ID
		if (this.config.signers.some((s) => s.id === signer.id)) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_SIGNER,
				`Signer with id ${signer.id} already exists`
			);
		}

		const newConfig: MultisigConfig = {
			...this.config,
			signers: [...this.config.signers, signer]
		};

		return this.updateConfig(newConfig);
	}

	/**
	 * Remove a signer from the configuration
	 * Returns the new address
	 */
	removeSigner(signerId: string): string {
		const signerIndex = this.config.signers.findIndex((s) => s.id === signerId);
		if (signerIndex === -1) {
			throw new MultisigError(
				MultisigErrorCode.SIGNER_NOT_FOUND,
				`Signer with id ${signerId} not found`
			);
		}

		const newSigners = this.config.signers.filter((s) => s.id !== signerId);

		// Validate that remaining signers can still meet threshold
		const remainingWeight = newSigners.reduce((sum, s) => sum + s.weight, 0);
		if (remainingWeight < this.config.threshold) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_THRESHOLD,
				`Cannot remove signer: remaining weight (${remainingWeight}) would be less than threshold (${this.config.threshold})`
			);
		}

		const newConfig: MultisigConfig = {
			...this.config,
			signers: newSigners
		};

		return this.updateConfig(newConfig);
	}

	/**
	 * Update threshold
	 * Returns the new address (address changes when threshold changes)
	 */
	updateThreshold(newThreshold: number): string {
		const totalWeight = this.getTotalWeight();

		if (newThreshold < 1) {
			throw new MultisigError(MultisigErrorCode.INVALID_THRESHOLD, 'Threshold must be at least 1');
		}

		if (newThreshold > totalWeight) {
			throw new MultisigError(
				MultisigErrorCode.INVALID_THRESHOLD,
				`Threshold (${newThreshold}) cannot exceed total weight (${totalWeight})`
			);
		}

		const newConfig: MultisigConfig = {
			...this.config,
			threshold: newThreshold
		};

		return this.updateConfig(newConfig);
	}
}

/**
 * Create a MultisigService instance
 */
export function createMultisigService(config: MultisigConfig): MultisigService {
	return new MultisigService(config);
}

/**
 * Derive multisig address from config without creating full service
 */
export function deriveMultisigAddress(config: MultisigConfig): string {
	const service = new MultisigService(config);
	return service.getAddress();
}
