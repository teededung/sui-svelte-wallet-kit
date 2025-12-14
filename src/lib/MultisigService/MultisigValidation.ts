/**
 * Multisig Validation
 * Validates MultisigConfig and signer definitions
 */

import {
	MultisigError,
	MultisigErrorCode,
	type MultisigConfig,
	type MultisigSigner,
	type MultisigPreConfig,
	type MultisigDynamicConfig
} from './MultisigTypes.js';

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Check if config is preconfigured mode
 */
export function isPreconfiguredMode(config: MultisigConfig): config is MultisigPreConfig {
	return config.mode === 'preconfigured';
}

/**
 * Check if config is dynamic mode
 */
export function isDynamicMode(config: MultisigConfig): config is MultisigDynamicConfig {
	return config.mode === 'dynamic';
}

/**
 * Validate a single signer definition
 */
export function validateSigner(signer: MultisigSigner, index: number): string[] {
	const errors: string[] = [];
	const prefix = `Signer[${index}]`;

	if (!signer || typeof signer !== 'object') {
		errors.push(`${prefix}: Invalid signer definition`);
		return errors;
	}

	// Validate weight if provided
	if (signer.weight !== undefined) {
		if (typeof signer.weight !== 'number' || signer.weight < 1) {
			errors.push(`${prefix}: Weight must be a positive number (got ${signer.weight})`);
		}
	}

	switch (signer.type) {
		case 'passkey':
			// Passkey signer only needs type, weight and name are optional
			break;

		case 'zklogin':
			// ZkLogin signer only needs type, weight and name are optional
			break;

		case 'wallet':
			if (!signer.address || typeof signer.address !== 'string') {
				errors.push(`${prefix}: Wallet signer requires a valid address`);
			} else if (!signer.address.startsWith('0x')) {
				errors.push(`${prefix}: Wallet address must start with '0x'`);
			}
			break;

		case 'publicKey':
			if (!signer.publicKey || typeof signer.publicKey !== 'string') {
				errors.push(`${prefix}: PublicKey signer requires a valid publicKey (base64 string)`);
			}
			if (!signer.keyType) {
				errors.push(
					`${prefix}: PublicKey signer requires keyType (ed25519, secp256k1, secp256r1, passkey, or zklogin)`
				);
			} else if (
				!['ed25519', 'secp256k1', 'secp256r1', 'passkey', 'zklogin'].includes(signer.keyType)
			) {
				errors.push(
					`${prefix}: Invalid keyType '${signer.keyType}'. Must be ed25519, secp256k1, secp256r1, passkey, or zklogin`
				);
			}
			break;

		default:
			errors.push(`${prefix}: Unknown signer type '${(signer as any).type}'`);
	}

	return errors;
}

/**
 * Calculate total weight from signers
 */
export function calculateTotalWeight(signers: MultisigSigner[]): number {
	return signers.reduce((sum, s) => sum + (s.weight ?? 1), 0);
}

/**
 * Validate preconfigured mode config
 */
export function validatePreconfiguredConfig(config: MultisigPreConfig): ValidationResult {
	const errors: string[] = [];

	// Validate signers array
	if (!config.signers || !Array.isArray(config.signers)) {
		errors.push('MultisigPreConfig requires a signers array');
		return { valid: false, errors };
	}

	if (config.signers.length === 0) {
		errors.push('MultisigPreConfig requires at least one signer');
		return { valid: false, errors };
	}

	// Validate each signer
	config.signers.forEach((signer, index) => {
		errors.push(...validateSigner(signer, index));
	});

	// Validate threshold
	const totalWeight = calculateTotalWeight(config.signers);

	if (typeof config.threshold !== 'number') {
		errors.push('Threshold must be a number');
	} else if (config.threshold < 1) {
		errors.push(`Threshold must be at least 1 (got ${config.threshold})`);
	} else if (config.threshold > totalWeight) {
		errors.push(
			`Threshold (${config.threshold}) cannot exceed total signer weight (${totalWeight})`
		);
	}

	// Validate network if provided
	if (config.network !== undefined) {
		if (!['mainnet', 'testnet', 'devnet'].includes(config.network)) {
			errors.push(`Invalid network '${config.network}'. Must be mainnet, testnet, or devnet`);
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate dynamic mode config
 */
export function validateDynamicConfig(config: MultisigDynamicConfig): ValidationResult {
	const errors: string[] = [];

	// Validate defaultThreshold if provided
	if (config.defaultThreshold !== undefined) {
		if (typeof config.defaultThreshold !== 'number' || config.defaultThreshold < 1) {
			errors.push(`defaultThreshold must be a positive number (got ${config.defaultThreshold})`);
		}
	}

	// Validate network if provided
	if (config.network !== undefined) {
		if (!['mainnet', 'testnet', 'devnet'].includes(config.network)) {
			errors.push(`Invalid network '${config.network}'. Must be mainnet, testnet, or devnet`);
		}
	}

	// storageKey is optional, no validation needed

	return { valid: errors.length === 0, errors };
}

/**
 * Validate MultisigConfig
 * Throws MultisigError if invalid
 */
export function validateMultisigConfig(config: MultisigConfig): ValidationResult {
	if (!config || typeof config !== 'object') {
		throw new MultisigError(
			MultisigErrorCode.INVALID_CONFIG,
			'MultisigConfig must be a valid object'
		);
	}

	if (!config.mode) {
		throw new MultisigError(
			MultisigErrorCode.INVALID_CONFIG,
			"MultisigConfig requires a 'mode' property ('preconfigured' or 'dynamic')"
		);
	}

	let result: ValidationResult;

	if (isPreconfiguredMode(config)) {
		result = validatePreconfiguredConfig(config);
	} else if (isDynamicMode(config)) {
		result = validateDynamicConfig(config);
	} else {
		throw new MultisigError(
			MultisigErrorCode.INVALID_CONFIG,
			`Invalid mode '${(config as any).mode}'. Must be 'preconfigured' or 'dynamic'`
		);
	}

	if (!result.valid) {
		throw new MultisigError(
			MultisigErrorCode.INVALID_CONFIG,
			`Invalid MultisigConfig: ${result.errors.join('; ')}`
		);
	}

	return result;
}

/**
 * Validate threshold against total weight
 */
export function validateThreshold(threshold: number, totalWeight: number): void {
	if (typeof threshold !== 'number' || threshold < 1) {
		throw new MultisigError(
			MultisigErrorCode.INVALID_THRESHOLD,
			`Threshold must be at least 1 (got ${threshold})`
		);
	}

	if (threshold > totalWeight) {
		throw new MultisigError(
			MultisigErrorCode.INVALID_THRESHOLD,
			`Threshold (${threshold}) cannot exceed total signer weight (${totalWeight})`
		);
	}
}
