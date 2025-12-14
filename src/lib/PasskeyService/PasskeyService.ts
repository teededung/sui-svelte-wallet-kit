/**
 * PasskeyService
 * Handles WebAuthn operations for passkey creation and authentication
 */

import { toBase64, fromBase64 } from '@mysten/sui/utils';
import {
	PasskeyError,
	PasskeyErrorCode,
	type PasskeyCreateOptions,
	type PasskeyCredential,
	type PasskeyAuthOptions,
	type PasskeyAuthResult,
	type PasskeyConfig
} from './types.js';

// COSE algorithm identifiers
const COSE_ALG_ES256 = -7; // ECDSA with P-256 and SHA-256 (secp256r1)
const COSE_ALG_RS256 = -257; // RSASSA-PKCS1-v1_5 with SHA-256

/**
 * PasskeyService class for WebAuthn passkey operations
 */
export class PasskeyService {
	private config: PasskeyConfig;

	constructor(config: PasskeyConfig) {
		this.validateConfig(config);
		this.config = config;
	}

	/**
	 * Validate passkey configuration
	 */
	private validateConfig(config: PasskeyConfig): void {
		if (!config.rpId) {
			throw new PasskeyError(
				PasskeyErrorCode.INVALID_CONFIG,
				'PasskeyConfig requires rpId (Relying Party Identifier)'
			);
		}
		if (!config.rpName) {
			throw new PasskeyError(
				PasskeyErrorCode.INVALID_CONFIG,
				'PasskeyConfig requires rpName (Relying Party Name)'
			);
		}
	}

	/**
	 * Check if WebAuthn is supported in the current browser
	 */
	static isSupported(): boolean {
		if (typeof window === 'undefined') return false;
		if (typeof navigator === 'undefined') return false;
		if (!navigator.credentials) return false;
		if (typeof PublicKeyCredential === 'undefined') return false;
		return true;
	}

	/**
	 * Check if platform authenticator is available (Face ID, Touch ID, Windows Hello)
	 */
	static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
		if (!PasskeyService.isSupported()) return false;
		try {
			return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
		} catch {
			return false;
		}
	}

	/**
	 * Create a new passkey credential
	 */
	async createCredential(options: PasskeyCreateOptions): Promise<PasskeyCredential> {
		if (!PasskeyService.isSupported()) {
			throw new PasskeyError(
				PasskeyErrorCode.WEBAUTHN_NOT_SUPPORTED,
				'WebAuthn is not supported in this browser'
			);
		}

		// Generate random user ID
		const userId = new Uint8Array(32);
		crypto.getRandomValues(userId);

		// Generate random challenge
		const challenge = new Uint8Array(32);
		crypto.getRandomValues(challenge);

		const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
			challenge,
			rp: {
				id: options.rpId,
				name: options.rpName
			},
			user: {
				id: userId,
				name: options.userName,
				displayName: options.userDisplayName || options.userName
			},
			pubKeyCredParams: [
				{
					type: 'public-key',
					alg: COSE_ALG_ES256 // secp256r1 (P-256) - preferred for Sui
				},
				{
					type: 'public-key',
					alg: COSE_ALG_RS256 // RSA - fallback for compatibility
				}
			],
			authenticatorSelection: {
				authenticatorAttachment: options.authenticatorAttachment || 'platform',
				userVerification: 'required',
				residentKey: 'preferred',
				requireResidentKey: false
			},
			timeout: options.timeout || 60000,
			attestation: 'none'
		};

		try {
			const credential = (await navigator.credentials.create({
				publicKey: publicKeyCredentialCreationOptions
			})) as PublicKeyCredential | null;

			if (!credential) {
				throw new PasskeyError(
					PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
					'Failed to create passkey credential'
				);
			}

			const response = credential.response as AuthenticatorAttestationResponse;
			const publicKey = this.extractPublicKey(response);
			const suiAddress = await this.deriveSuiAddress(publicKey);

			return {
				credentialId: toBase64(new Uint8Array(credential.rawId)),
				publicKey,
				suiAddress,
				createdAt: Date.now()
			};
		} catch (error) {
			if (error instanceof PasskeyError) throw error;

			const domError = error as DOMException;
			if (domError.name === 'NotAllowedError') {
				throw new PasskeyError(
					PasskeyErrorCode.USER_CANCELLED,
					'User cancelled the passkey creation',
					domError
				);
			}
			if (domError.name === 'AbortError' || domError.name === 'TimeoutError') {
				throw new PasskeyError(PasskeyErrorCode.TIMEOUT, 'Passkey creation timed out', domError);
			}

			throw new PasskeyError(
				PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
				`Failed to create passkey: ${domError.message}`,
				domError
			);
		}
	}

	/**
	 * Authenticate with existing passkey credential
	 */
	async authenticate(options: PasskeyAuthOptions): Promise<PasskeyAuthResult> {
		if (!PasskeyService.isSupported()) {
			throw new PasskeyError(
				PasskeyErrorCode.WEBAUTHN_NOT_SUPPORTED,
				'WebAuthn is not supported in this browser'
			);
		}

		// Generate random challenge
		const challenge = new Uint8Array(32);
		crypto.getRandomValues(challenge);

		const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
			challenge,
			rpId: options.rpId,
			timeout: options.timeout || 60000,
			userVerification: 'required'
		};

		// If credentialId is provided, use it in allowCredentials
		if (options.credentialId) {
			publicKeyCredentialRequestOptions.allowCredentials = [
				{
					type: 'public-key',
					id: fromBase64(options.credentialId)
				}
			];
		}

		try {
			const credential = (await navigator.credentials.get({
				publicKey: publicKeyCredentialRequestOptions
			})) as PublicKeyCredential | null;

			if (!credential) {
				throw new PasskeyError(
					PasskeyErrorCode.CREDENTIAL_GET_FAILED,
					'Failed to authenticate with passkey'
				);
			}

			const response = credential.response as AuthenticatorAssertionResponse;

			return {
				credentialId: toBase64(new Uint8Array(credential.rawId)),
				signature: new Uint8Array(response.signature),
				authenticatorData: new Uint8Array(response.authenticatorData),
				clientDataJSON: new Uint8Array(response.clientDataJSON)
			};
		} catch (error) {
			if (error instanceof PasskeyError) throw error;

			const domError = error as DOMException;
			if (domError.name === 'NotAllowedError') {
				throw new PasskeyError(
					PasskeyErrorCode.USER_CANCELLED,
					'User cancelled the passkey authentication',
					domError
				);
			}
			if (domError.name === 'AbortError' || domError.name === 'TimeoutError') {
				throw new PasskeyError(
					PasskeyErrorCode.TIMEOUT,
					'Passkey authentication timed out',
					domError
				);
			}

			throw new PasskeyError(
				PasskeyErrorCode.CREDENTIAL_GET_FAILED,
				`Failed to authenticate: ${domError.message}`,
				domError
			);
		}
	}

	/**
	 * Extract public key from attestation response
	 * Returns the raw secp256r1 public key bytes (65 bytes: 0x04 || x || y)
	 */
	private extractPublicKey(response: AuthenticatorAttestationResponse): Uint8Array {
		// Check the algorithm used
		const algorithm = response.getPublicKeyAlgorithm();
		// console.log('[PasskeyService] Public key algorithm:', algorithm);

		if (algorithm !== COSE_ALG_ES256) {
			throw new PasskeyError(
				PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
				`Unsupported algorithm: ${algorithm}. Sui requires ES256 (P-256/secp256r1). Your authenticator may not support this algorithm.`
			);
		}

		const publicKey = response.getPublicKey();
		if (!publicKey) {
			throw new PasskeyError(
				PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
				'Failed to extract public key from credential'
			);
		}

		// The public key is in SPKI format, we need to extract the raw key
		const spkiKey = new Uint8Array(publicKey);
		// console.log('[PasskeyService] SPKI key length:', spkiKey.length);

		// SPKI format for P-256 (91 bytes total):
		// 30 59 - SEQUENCE (89 bytes)
		//   30 13 - SEQUENCE (19 bytes) - algorithm identifier
		//     06 07 2a 86 48 ce 3d 02 01 - OID ecPublicKey
		//     06 08 2a 86 48 ce 3d 03 01 07 - OID prime256v1
		//   03 42 00 - BIT STRING (66 bytes, 0 unused bits)
		//     04 [32 bytes x] [32 bytes y] - uncompressed point

		// For 91 bytes SPKI, the public key starts at offset 26 (after 0x00 padding)
		// For 91 bytes: header(26) + 0x00(1) + key(64) = 91, so key is at offset 27
		// But we need to add 0x04 prefix for uncompressed format

		let rawPublicKey: Uint8Array;

		if (spkiKey.length === 91) {
			// Standard P-256 SPKI format without 0x04 in the extracted portion
			// The 0x04 is at offset 26, followed by 64 bytes of x,y coordinates
			const keyStart = 26; // After the SPKI header
			if (spkiKey[keyStart] === 0x04) {
				// Key includes 0x04 prefix
				rawPublicKey = spkiKey.slice(keyStart, keyStart + 65);
			} else if (spkiKey[keyStart] === 0x00 && spkiKey[keyStart + 1] === 0x04) {
				// 0x00 padding before 0x04
				rawPublicKey = spkiKey.slice(keyStart + 1, keyStart + 1 + 65);
			} else {
				// Assume the last 64 bytes are x,y and prepend 0x04
				const xyCoords = spkiKey.slice(-64);
				rawPublicKey = new Uint8Array(65);
				rawPublicKey[0] = 0x04;
				rawPublicKey.set(xyCoords, 1);
			}
		} else if (spkiKey.length === 65 && spkiKey[0] === 0x04) {
			// Already in raw format
			rawPublicKey = spkiKey;
		} else {
			// Try to find 0x04 marker
			let found = false;
			for (let i = 0; i <= spkiKey.length - 65; i++) {
				if (spkiKey[i] === 0x04) {
					rawPublicKey = spkiKey.slice(i, i + 65);
					found = true;
					// console.log('[PasskeyService] Found 0x04 at offset:', i);
					break;
				}
			}

			if (!found) {
				// Last resort: take last 64 bytes and prepend 0x04
				if (spkiKey.length >= 64) {
					const xyCoords = spkiKey.slice(-64);
					rawPublicKey = new Uint8Array(65);
					rawPublicKey[0] = 0x04;
					rawPublicKey.set(xyCoords, 1);
					// console.log('[PasskeyService] Using last 64 bytes with 0x04 prefix');
				} else {
					throw new PasskeyError(
						PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
						`Invalid SPKI key length: ${spkiKey.length}`
					);
				}
			}
		}

		if (rawPublicKey![0] !== 0x04 || rawPublicKey!.length !== 65) {
			console.error('[PasskeyService] Invalid public key format:', {
				firstByte: rawPublicKey![0],
				length: rawPublicKey!.length
			});
			throw new PasskeyError(
				PasskeyErrorCode.CREDENTIAL_CREATE_FAILED,
				`Invalid P-256 public key format`
			);
		}

		// console.log('[PasskeyService] Successfully extracted P-256 public key (65 bytes)');
		return rawPublicKey!;
	}

	/**
	 * Derive Sui address from secp256r1 public key
	 */
	async deriveSuiAddress(publicKey: Uint8Array): Promise<string> {
		// Import dynamically to avoid issues with SSR
		const { Secp256r1PublicKey } = await import('@mysten/sui/keypairs/secp256r1');

		// Create Secp256r1PublicKey from raw bytes
		// The SDK expects the 33-byte compressed format or 65-byte uncompressed
		const pubKey = new Secp256r1PublicKey(publicKey);

		return pubKey.toSuiAddress();
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): PasskeyConfig {
		return { ...this.config };
	}
}
