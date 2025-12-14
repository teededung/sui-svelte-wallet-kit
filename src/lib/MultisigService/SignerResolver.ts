/**
 * SignerResolver
 * Resolves public keys from signer definitions
 */

import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1PublicKey } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1PublicKey } from '@mysten/sui/keypairs/secp256r1';
import { PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type { PublicKey } from '@mysten/sui/cryptography';

import {
	MultisigError,
	MultisigErrorCode,
	type MultisigSigner,
	type ResolvedSigner,
	type ResolverContext,
	type SignerKeyType,
	type ResolvedSignerType
} from './MultisigTypes.js';

/**
 * Parse base64 public key string to PublicKey object
 * Supports ed25519, secp256k1, secp256r1, and zklogin key types
 */
export function parsePublicKey(publicKeyBase64: string, keyType: SignerKeyType): PublicKey {
	try {
		const bytes = fromBase64(publicKeyBase64);

		// Handle zklogin type explicitly
		if (keyType === 'zklogin') {
			return new ZkLoginPublicIdentifier(bytes);
		}
		// Handle passkey type explicitly (Passkey scheme flag, not Secp256r1)
		if (keyType === 'passkey') {
			return new PasskeyPublicKey(bytes);
		}

		// Try to detect zkLogin by byte length (zkLogin identifiers are typically > 48 bytes)
		if (bytes.length > 48) {
			try {
				return new ZkLoginPublicIdentifier(bytes);
			} catch {
				// If zkLogin fails, try other types
			}
		}

		switch (keyType) {
			case 'ed25519':
				return new Ed25519PublicKey(bytes);
			case 'secp256k1':
				return new Secp256k1PublicKey(bytes);
			case 'secp256r1':
				return new Secp256r1PublicKey(bytes);
			default:
				throw new Error(`Unknown key type: ${keyType}`);
		}
	} catch (error: any) {
		throw new MultisigError(
			MultisigErrorCode.PUBLIC_KEY_PARSE_ERROR,
			`Failed to parse public key: ${error.message}`,
			error
		);
	}
}

/**
 * Generate a unique ID for a signer
 */
export function generateSignerId(signer: MultisigSigner, index: number): string {
	switch (signer.type) {
		case 'passkey':
			return `passkey-${index}`;
		case 'zklogin':
			return `zklogin-${index}`;
		case 'wallet':
			return `wallet-${signer.address.slice(0, 10)}-${index}`;
		case 'publicKey':
			return `pubkey-${signer.publicKey.slice(0, 8)}-${index}`;
		default:
			return `signer-${index}`;
	}
}

/**
 * SignerResolver class
 * Handles resolution of signer definitions to actual public keys
 */
export class SignerResolver {
	/**
	 * Check if a signer can be resolved with current context
	 */
	canResolve(signer: MultisigSigner, context: ResolverContext): boolean {
		switch (signer.type) {
			case 'passkey':
				return !!context.passkeyPublicKey;

			case 'zklogin':
				return !!context.zkLoginPublicIdentifier;

			case 'wallet':
				return context.connectedWallets.has(signer.address);

			case 'publicKey':
				// Public key signers can always be resolved (they have the key inline)
				return true;

			default:
				return false;
		}
	}

	/**
	 * Resolve a signer definition to a ResolvedSigner
	 */
	resolve(signer: MultisigSigner, index: number, context: ResolverContext): ResolvedSigner {
		const id = generateSignerId(signer, index);
		const weight = signer.weight ?? 1;
		const name = signer.name;

		try {
			switch (signer.type) {
				case 'passkey':
					return this.resolvePasskeySigner(id, weight, name, context, signer.address);

				case 'zklogin':
					return this.resolveZkLoginSigner(id, weight, name, context, signer.address);

				case 'wallet':
					return this.resolveWalletSigner(id, signer.address, weight, name, context);

				case 'publicKey':
					return this.resolvePublicKeySigner(
						id,
						signer.publicKey,
						signer.keyType,
						weight,
						name,
						signer.address
					);

				default:
					return {
						id,
						type: 'ed25519',
						weight,
						name,
						resolved: false,
						error: `Unknown signer type: ${(signer as any).type}`
					};
			}
		} catch (error: any) {
			return {
				id,
				type: 'ed25519',
				weight,
				name,
				resolved: false,
				error: error.message
			};
		}
	}

	/**
	 * Resolve passkey signer
	 * Uses saved address from signer config if available, falls back to context
	 */
	private resolvePasskeySigner(
		id: string,
		weight: number,
		name: string | undefined,
		context: ResolverContext,
		savedAddress?: string
	): ResolvedSigner {
		const address = savedAddress || context.passkeyAddress;

		if (!context.passkeyPublicKey) {
			// If we have a saved address, mark as resolved (signing will work when passkey connects)
			if (address) {
				return {
					id,
					type: 'passkey',
					weight,
					name: name ?? 'Passkey',
					address,
					resolved: true // Resolved because we have address for multisig derivation
				};
			}
			return {
				id,
				type: 'passkey',
				weight,
				name: name ?? 'Passkey',
				resolved: false,
				error: 'Passkey wallet not connected'
			};
		}

		const pkBase64 = toBase64(context.passkeyPublicKey.toRawBytes());
		return {
			id,
			type: 'passkey',
			weight,
			name: name ?? 'Passkey',
			publicKey: context.passkeyPublicKey,
			publicKeyBase64: pkBase64,
			address: address || context.passkeyAddress,
			resolved: true
		};
	}

	/**
	 * Resolve zkLogin signer
	 * Uses saved address from signer config if available, falls back to context.
	 * zkLogin signers are considered "resolved" if we have an address,
	 * because the actual signing will be handled by the zkLogin wallet.
	 */
	private resolveZkLoginSigner(
		id: string,
		weight: number,
		name: string | undefined,
		context: ResolverContext,
		savedAddress?: string
	): ResolvedSigner {
		const address = savedAddress || context.zkLoginAddress;

		// If we have a saved address, mark as resolved (for multisig address derivation)
		// Signing will work when zkLogin wallet connects
		if (address) {
			// If we have full zkLogin info from context, include it
			if (
				context.zkLoginAddress === address &&
				context.zkLoginPublicIdentifier &&
				context.zkLoginAddressSeed &&
				context.zkLoginIssuer
			) {
				const pkBase64 = toBase64(context.zkLoginPublicIdentifier.toRawBytes());
				return {
					id,
					type: 'zklogin',
					weight,
					name: name ?? 'zkLogin',
					publicKey: context.zkLoginPublicIdentifier,
					publicKeyBase64: pkBase64,
					addressSeed: context.zkLoginAddressSeed,
					issuer: context.zkLoginIssuer,
					address,
					resolved: true
				};
			}

			// Mark as resolved with just address
			return {
				id,
				type: 'zklogin',
				weight,
				name: name ?? 'zkLogin',
				address,
				resolved: true
			};
		}

		return {
			id,
			type: 'zklogin',
			weight,
			name: name ?? 'zkLogin',
			resolved: false,
			error: 'zkLogin wallet not connected and no saved address'
		};
	}

	/**
	 * Resolve wallet signer by address
	 * Note: Wallet signers are considered "resolved" if the wallet is connected,
	 * even without public key - the signing will work via wallet adapter.
	 */
	private resolveWalletSigner(
		id: string,
		address: string,
		weight: number,
		name: string | undefined,
		context: ResolverContext
	): ResolvedSigner {
		const wallet = context.connectedWallets.get(address);

		if (!wallet) {
			return {
				id,
				type: 'ed25519', // Default, will be updated when resolved
				weight,
				name: name ?? `Wallet ${address.slice(0, 8)}...`,
				address,
				resolved: false,
				error: 'Wallet not connected'
			};
		}

		// If we have public key, use it to determine type
		if (wallet.publicKey) {
			const type = this.inferTypeFromPublicKey(wallet.publicKey);
			const pkBase64 = toBase64(wallet.publicKey.toRawBytes());
			return {
				id,
				type,
				weight,
				name: name ?? `Wallet ${address.slice(0, 8)}...`,
				publicKey: wallet.publicKey,
				publicKeyBase64: pkBase64,
				address,
				resolved: true
			};
		}

		// Wallet is connected but no public key - still mark as resolved
		// Signing will work via wallet adapter
		return {
			id,
			type: 'ed25519', // Default type
			weight,
			name: name ?? `Wallet ${address.slice(0, 8)}...`,
			address,
			resolved: true
		};
	}

	/**
	 * Resolve public key signer (inline key)
	 * Note: Public key signers are always considered "resolved" because they have
	 * the public key inline - we have all info needed to derive multisig address.
	 * Wallet connection is only checked when signing.
	 */
	private resolvePublicKeySigner(
		id: string,
		publicKeyBase64: string,
		keyType: SignerKeyType,
		weight: number,
		name: string | undefined,
		signerAddress?: string
	): ResolvedSigner {
		try {
			const publicKey = parsePublicKey(publicKeyBase64, keyType);
			// Always derive address from public key.
			// (Using a persisted address here can drift and cause signing/execution mismatches.)
			const derivedAddress = publicKey.toSuiAddress();
			if (signerAddress && signerAddress !== derivedAddress) {
				try {
					console.warn(
						`[SignerResolver] Signer '${id}' persisted address mismatch. Using derived address from public key.`,
						{ persisted: signerAddress, derived: derivedAddress }
					);
				} catch {}
			}
			const address = derivedAddress;

			// Map keyType to ResolvedSignerType (zklogin stays as zklogin)
			const resolvedType: ResolvedSignerType =
				keyType === 'zklogin' ? 'zklogin' : (keyType as ResolvedSignerType);

			return {
				id,
				type: resolvedType,
				weight,
				name: name ?? `PublicKey ${publicKeyBase64.slice(0, 8)}...`,
				publicKey,
				publicKeyBase64,
				address,
				resolved: true
			};
		} catch (error: any) {
			// Even if parsing fails, try to mark as resolved if we have address
			// This allows the multisig to work even with parse errors
			console.warn(`[SignerResolver] Failed to parse public key: ${error.message}`);
			const resolvedType: ResolvedSignerType =
				keyType === 'zklogin' ? 'zklogin' : (keyType as ResolvedSignerType);
			return {
				id,
				type: resolvedType,
				weight,
				name: name ?? `PublicKey ${publicKeyBase64.slice(0, 8)}...`,
				publicKeyBase64,
				address: signerAddress,
				resolved: false,
				error: error.message
			};
		}
	}

	/**
	 * Infer signer type from public key
	 */
	private inferTypeFromPublicKey(publicKey: PublicKey): ResolvedSignerType {
		const flag = publicKey.flag();

		// Sui public key flags
		// 0x00 = ED25519
		// 0x01 = Secp256k1
		// 0x02 = Secp256r1
		// 0x05 = ZkLogin
		// 0x06 = Passkey
		switch (flag) {
			case 0x00:
				return 'ed25519';
			case 0x01:
				return 'secp256k1';
			case 0x02:
				return 'secp256r1';
			case 0x05:
				return 'zklogin';
			case 0x06:
				return 'passkey';
			default:
				return 'ed25519'; // Default fallback
		}
	}

	/**
	 * Resolve all signers from a list
	 */
	resolveAll(signers: MultisigSigner[], context: ResolverContext): ResolvedSigner[] {
		return signers.map((signer, index) => this.resolve(signer, index, context));
	}
}

/**
 * Create a SignerResolver instance
 */
export function createSignerResolver(): SignerResolver {
	return new SignerResolver();
}
