/**
 * PasskeyWalletAdapter
 * Implements SuiWalletAdapter interface for passkey-based accounts
 * Based on Mysten Labs passkey-example: https://github.com/MystenLabs/passkey-example
 */

import type { WalletAccount } from '@wallet-standard/core';
import type {
	SuiWalletAdapter,
	SignAndExecuteTransactionParams,
	SignTransactionParams,
	SignTransactionResult,
	SignPersonalMessageParams,
	SignMessageResult
} from '../SuiModule/types.js';
import {
	PasskeyService,
	PasskeyError,
	PasskeyErrorCode,
	LocalStorageCredentialStorage,
	createEmptyStorage,
	addCredential,
	findCredentialsByRpId,
	type PasskeyConfig,
	type PasskeyCredential,
	type CredentialStorage,
	type StoredCredential
} from '../PasskeyService/index.js';
import { toBase64 } from '@mysten/sui/utils';
import { PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
import {
	PasskeyKeypair,
	BrowserPasskeyProvider,
	type BrowserPasswordProviderOptions
} from '@mysten/sui/keypairs/passkey';

// Passkey wallet icon (key emoji as data URL)
const PASSKEY_ICON =
	'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNS41IDcuNSAyLjMgMi4zYTEgMSAwIDAgMCAxLjQgMGwyLjEtMi4xYTEgMSAwIDAgMCAwLTEuNEwxOSA0Ii8+PHBhdGggZD0ibTIxIDJsLTkuNiA5LjYiLz48Y2lyY2xlIGN4PSI3LjUiIGN5PSIxNS41IiByPSI1LjUiLz48L3N2Zz4=';

/**
 * Extended WalletAccount for passkey accounts
 */
export interface PasskeyAccount extends WalletAccount {
	address: string;
	publicKey: Uint8Array;
	chains: readonly `sui:${string}`[];
	features: readonly `${string}:${string}`[];
	credentialId: string;
}

/** Wallet icon type (data URL format) */
export type WalletIconDataUrl =
	| `data:image/svg+xml;base64,${string}`
	| `data:image/webp;base64,${string}`
	| `data:image/png;base64,${string}`
	| `data:image/gif;base64,${string}`;

/**
 * Extended PasskeyConfig with optional storage
 */
export interface PasskeyAdapterConfig extends PasskeyConfig {
	storage?: CredentialStorage;
	network?: 'mainnet' | 'testnet' | 'devnet';
	/** Custom icon for the passkey wallet (must be a data URL in svg, png, webp, or gif format) */
	icon?: WalletIconDataUrl;
}

/**
 * PasskeyWalletAdapter class
 */
export class PasskeyWalletAdapter implements SuiWalletAdapter {
	readonly name = 'Passkey';
	readonly version = '1.0.0' as const;
	readonly icon: WalletIconDataUrl;
	readonly chains = ['sui:mainnet', 'sui:testnet', 'sui:devnet'] as const;

	private config: PasskeyAdapterConfig;
	private storage: CredentialStorage;
	private _accounts: PasskeyAccount[] = [];
	private _connected = false;
	private currentCredential: PasskeyCredential | null = null;
	private passkeyKeypair: PasskeyKeypair | null = null;
	private passkeyProvider: BrowserPasskeyProvider;

	constructor(config: PasskeyAdapterConfig) {
		this.config = config;
		this.storage = config.storage || new LocalStorageCredentialStorage();
		this.icon = config.icon || (PASSKEY_ICON as WalletIconDataUrl);

		// Create BrowserPasskeyProvider (same as Mysten Labs example)
		this.passkeyProvider = new BrowserPasskeyProvider(config.rpName, {
			rpName: config.rpName,
			rpId: config.rpId,
			authenticatorSelection: {
				authenticatorAttachment: config.authenticatorAttachment || 'platform'
			}
		} as BrowserPasswordProviderOptions);
	}

	get accounts(): readonly PasskeyAccount[] {
		return this._accounts;
	}

	get features() {
		return {
			'standard:connect': {
				connect: () => this.connect()
			},
			'standard:disconnect': {
				disconnect: () => this.disconnect()
			},
			'sui:signAndExecuteTransaction': {
				signAndExecuteTransaction: (params: SignAndExecuteTransactionParams) =>
					this.signAndExecuteTransaction(params)
			},
			'sui:signTransaction': {
				signTransaction: (params: SignTransactionParams) => this.signTransaction(params)
			},
			'sui:signPersonalMessage': {
				signPersonalMessage: (params: SignPersonalMessageParams) => this.signPersonalMessage(params)
			},
			'passkey:getCredential': {
				getCredential: () => this.getCredential()
			}
		} as const;
	}

	/**
	 * Connect to passkey wallet
	 * Always tries to authenticate with existing passkey first (allows recovery after localStorage clear)
	 * Falls back to creating new passkey if authentication fails
	 */
	async connect(): Promise<void> {
		if (!PasskeyService.isSupported()) {
			throw new PasskeyError(
				PasskeyErrorCode.WEBAUTHN_NOT_SUPPORTED,
				'WebAuthn is not supported in this browser'
			);
		}

		// Always try to authenticate first - this allows user to select existing passkey
		// even if localStorage was cleared
		// console.log('[PasskeyWalletAdapter] Attempting to authenticate with existing passkey...');
		try {
			await this.authenticateExistingWallet();
			return;
		} catch (error) {
			// If user cancelled or no passkey exists, fall back to creating new
			const isUserCancelled =
				error instanceof Error &&
				(error.message.includes('cancelled') ||
					error.message.includes('NotAllowedError') ||
					(error as any).name === 'NotAllowedError');

			if (isUserCancelled) {
				// console.log('[PasskeyWalletAdapter] User cancelled, trying to create new passkey...');
			} else {
				// console.warn('[PasskeyWalletAdapter] Authentication failed, creating new passkey...', error);
			}
		}

		// Create a fresh passkey instance
		// console.log('[PasskeyWalletAdapter] Creating passkey wallet...');
		await this.createNewWallet();
	}

	/**
	 * Silent connect - restore from storage without prompting
	 * Used for auto-connect on page refresh
	 * Returns true if successfully restored, false if no stored credentials
	 */
	async silentConnect(): Promise<boolean> {
		if (!PasskeyService.isSupported()) {
			return false;
		}

		try {
			const storedCredentials = await this.storage.get();
			const existingCredentials = storedCredentials
				? findCredentialsByRpId(storedCredentials, this.config.rpId)
				: [];

			if (existingCredentials.length === 0) {
				// console.log('[PasskeyWalletAdapter] No stored credentials for silent connect');
				return false;
			}

			// Use the most recently used credential
			const mostRecent = existingCredentials.sort(
				(a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt)
			)[0];

			// console.log('[PasskeyWalletAdapter] Silent connect - restoring from storage:', { suiAddress: mostRecent.suiAddress });

			// Restore PasskeyKeypair from stored public key
			// Note: This won't prompt user, but signing will prompt later
			const { fromBase64 } = await import('@mysten/sui/utils');
			const publicKeyBytes = fromBase64(mostRecent.publicKey);
			this.passkeyKeypair = new PasskeyKeypair(publicKeyBytes, this.passkeyProvider);

			// Some older stored entries may have an address derived differently.
			// Always trust the address derived from the public key used for signing.
			const derivedSuiAddress = this.passkeyKeypair.getPublicKey().toSuiAddress();
			if (mostRecent.suiAddress !== derivedSuiAddress) {
				try {
					const currentStorage = storedCredentials || createEmptyStorage();
					const updatedCredential: StoredCredential = {
						...mostRecent,
						suiAddress: derivedSuiAddress,
						lastUsedAt: Date.now()
					};
					const updatedStorage = addCredential(currentStorage, updatedCredential);
					await this.storage.set(updatedStorage);
				} catch {}
			}

			this.currentCredential = {
				credentialId: mostRecent.credentialId,
				publicKey: publicKeyBytes,
				suiAddress: derivedSuiAddress,
				createdAt: mostRecent.createdAt
			};

			this.setupAccount(this.currentCredential);
			this._connected = true;
			// console.log('[PasskeyWalletAdapter] Silent connect successful!');
			return true;
		} catch (error) {
			// console.warn('[PasskeyWalletAdapter] Silent connect failed:', error);
			return false;
		}
	}

	/**
	 * Authenticate with existing passkey using signAndRecover
	 * This prompts user once to select an existing passkey, then verifies against stored public keys
	 */
	private async authenticateExistingWallet(): Promise<void> {
		// console.log('[PasskeyWalletAdapter] Authenticating with existing passkey...');

		// Sign once to get possible public keys
		const testMessage = new TextEncoder().encode('Sui Passkey Authentication');
		const possiblePks = await PasskeyKeypair.signAndRecover(this.passkeyProvider, testMessage);

		// Get stored credentials to match against
		const currentStorage = (await this.storage.get()) || createEmptyStorage();
		const existingCredentials = findCredentialsByRpId(currentStorage, this.config.rpId);

		// Try to find a matching public key from stored credentials
		let matchedPk = null;
		let matchedCredential = null;

		for (const pk of possiblePks) {
			const pkBase64 = toBase64(pk.toRawBytes());
			const credential = existingCredentials.find((c) => c.publicKey === pkBase64);
			if (credential) {
				matchedPk = pk;
				matchedCredential = credential;
				break;
			}
		}

		if (matchedPk && matchedCredential) {
			// Found matching credential - use it
			const publicKeyBytes = matchedPk.toRawBytes();
			const suiAddress = matchedPk.toSuiAddress();

			// console.log('[PasskeyWalletAdapter] Matched existing credential:', { suiAddress, publicKeyBase64: toBase64(publicKeyBytes) });

			this.passkeyKeypair = new PasskeyKeypair(publicKeyBytes, this.passkeyProvider);

			// Update last used timestamp
			const updatedCredential: StoredCredential = {
				...matchedCredential,
				suiAddress,
				lastUsedAt: Date.now()
			};
			const updatedStorage = addCredential(currentStorage, updatedCredential);
			await this.storage.set(updatedStorage);

			this.currentCredential = {
				credentialId: matchedCredential.credentialId,
				publicKey: publicKeyBytes,
				suiAddress,
				createdAt: matchedCredential.createdAt
			};
		} else {
			// No match found - this is a new passkey, need second sign to confirm
			// console.log('[PasskeyWalletAdapter] No match found, confirming with second sign...');
			const { findCommonPublicKey } = await import('@mysten/sui/keypairs/passkey');

			const testMessage2 = new TextEncoder().encode('Sui Passkey Confirm');
			const possiblePks2 = await PasskeyKeypair.signAndRecover(this.passkeyProvider, testMessage2);

			const recoveredPk = findCommonPublicKey(possiblePks, possiblePks2);
			const publicKeyBytes = recoveredPk.toRawBytes();
			const suiAddress = recoveredPk.toSuiAddress();

			// console.log('[PasskeyWalletAdapter] New passkey confirmed:', { suiAddress, publicKeyBase64: toBase64(publicKeyBytes) });

			this.passkeyKeypair = new PasskeyKeypair(publicKeyBytes, this.passkeyProvider);

			// Save new credential
			const credentialIdBytes = new Uint8Array(32);
			crypto.getRandomValues(credentialIdBytes);
			const credentialId = toBase64(credentialIdBytes);

			const newStoredCredential: StoredCredential = {
				credentialId,
				publicKey: toBase64(publicKeyBytes),
				suiAddress,
				createdAt: Date.now(),
				rpId: this.config.rpId
			};

			const updatedStorage = addCredential(currentStorage, newStoredCredential);
			await this.storage.set(updatedStorage);

			this.currentCredential = {
				credentialId,
				publicKey: publicKeyBytes,
				suiAddress,
				createdAt: newStoredCredential.createdAt
			};
		}

		this.setupAccount(this.currentCredential);
		this._connected = true;
		// console.log('[PasskeyWalletAdapter] Authentication successful!');
	}

	/**
	 * Create/connect passkey wallet using PasskeyKeypair.getPasskeyInstance
	 * This always prompts user to select/create a passkey, ensuring public key matches
	 */
	private async createNewWallet(): Promise<void> {
		// console.log('[PasskeyWalletAdapter] Getting passkey instance...');

		// Use PasskeyKeypair.getPasskeyInstance (same as Mysten Labs example)
		// This prompts user to select or create a passkey
		this.passkeyKeypair = await PasskeyKeypair.getPasskeyInstance(this.passkeyProvider);

		const publicKey = this.passkeyKeypair.getPublicKey();
		const suiAddress = publicKey.toSuiAddress();
		const publicKeyBytes = publicKey.toRawBytes();

		// console.log('[PasskeyWalletAdapter] Passkey connected:', { suiAddress, publicKeyLength: publicKeyBytes.length, publicKeyBase64: toBase64(publicKeyBytes) });

		// Check if this address already exists in storage
		const currentStorage = (await this.storage.get()) || createEmptyStorage();
		const existingCredentials = findCredentialsByRpId(currentStorage, this.config.rpId);
		const existingCredential = existingCredentials.find((c) => c.suiAddress === suiAddress);

		if (existingCredential) {
			// Update existing credential with new public key (in case it changed)
			// console.log('[PasskeyWalletAdapter] Found existing credential, updating...');
			const updatedCredential: StoredCredential = {
				...existingCredential,
				publicKey: toBase64(publicKeyBytes),
				lastUsedAt: Date.now()
			};
			const updatedStorage = addCredential(currentStorage, updatedCredential);
			await this.storage.set(updatedStorage);

			this.currentCredential = {
				credentialId: existingCredential.credentialId,
				publicKey: publicKeyBytes,
				suiAddress,
				createdAt: existingCredential.createdAt
			};
		} else {
			// Create new credential entry
			// console.log('[PasskeyWalletAdapter] Creating new credential entry...');
			const credentialIdBytes = new Uint8Array(32);
			crypto.getRandomValues(credentialIdBytes);
			const credentialId = toBase64(credentialIdBytes);

			const newStoredCredential: StoredCredential = {
				credentialId,
				publicKey: toBase64(publicKeyBytes),
				suiAddress,
				createdAt: Date.now(),
				rpId: this.config.rpId
			};

			const updatedStorage = addCredential(currentStorage, newStoredCredential);
			await this.storage.set(updatedStorage);

			this.currentCredential = {
				credentialId,
				publicKey: publicKeyBytes,
				suiAddress,
				createdAt: newStoredCredential.createdAt
			};
		}

		this.setupAccount(this.currentCredential);
		this._connected = true;
		// console.log('[PasskeyWalletAdapter] Connected successfully!');
	}

	/**
	 * Disconnect from passkey wallet
	 */
	async disconnect(): Promise<void> {
		this._accounts = [];
		this._connected = false;
		this.currentCredential = null;
		this.passkeyKeypair = null;
	}

	/**
	 * Sign and execute a transaction
	 * Following Mysten Labs passkey-example approach
	 */
	async signAndExecuteTransaction(params: SignAndExecuteTransactionParams): Promise<any> {
		if (!this._connected || !this.currentCredential || !this.passkeyKeypair) {
			throw new PasskeyError(
				PasskeyErrorCode.INVALID_CREDENTIAL,
				'Not connected to passkey wallet'
			);
		}

		const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

		// Get network from chain
		const network = params.chain.replace('sui:', '') as 'mainnet' | 'testnet' | 'devnet';
		const client = new SuiClient({ url: getFullnodeUrl(network) });

		const transaction = params.transaction;

		// Use the verified address
		const senderAddress = this.passkeyKeypair.getPublicKey().toSuiAddress();

		// Ensure sender is set
		if (typeof transaction.setSender === 'function') {
			transaction.setSender(senderAddress);
		}

		// console.log('[PasskeyWalletAdapter] Signing transaction for address:', senderAddress);
		// console.log('[PasskeyWalletAdapter] Public key:', toBase64(this.passkeyKeypair.getPublicKey().toRawBytes()));

		// Build the transaction first
		const txBytes = await transaction.build({ client });
		// console.log('[PasskeyWalletAdapter] Transaction bytes:', toBase64(txBytes));

		// Sign the transaction bytes
		const { signature } = await this.passkeyKeypair.signTransaction(txBytes);

		// console.log('[PasskeyWalletAdapter] Transaction signed, signature:', signature);
		// console.log('[PasskeyWalletAdapter] Executing...');

		// Execute the signed transaction
		const result = await client.executeTransactionBlock({
			transactionBlock: txBytes,
			signature,
			options: {
				showEffects: true,
				showEvents: true
			}
		});

		return result;
	}

	/**
	 * Sign (but do NOT execute) a transaction.
	 * This is required for multisig "collect signatures" flows.
	 *
	 * Important: we intentionally do NOT override sender here. The caller may set
	 * sender to a multisig address to ensure all signers sign identical bytes.
	 */
	async signTransaction(params: SignTransactionParams): Promise<SignTransactionResult> {
		if (!this._connected || !this.currentCredential || !this.passkeyKeypair) {
			throw new PasskeyError(
				PasskeyErrorCode.INVALID_CREDENTIAL,
				'Not connected to passkey wallet'
			);
		}

		const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

		const network = params.chain.replace('sui:', '') as 'mainnet' | 'testnet' | 'devnet';
		const client = new SuiClient({ url: getFullnodeUrl(network) });

		const transaction = params.transaction;
		const txBytes = await transaction.build({ client });

		const { signature } = await this.passkeyKeypair.signTransaction(txBytes);

		return { signature, bytes: txBytes };
	}

	/**
	 * Sign a personal message
	 */
	async signPersonalMessage(params: SignPersonalMessageParams): Promise<SignMessageResult> {
		if (!this._connected || !this.passkeyKeypair) {
			throw new PasskeyError(
				PasskeyErrorCode.INVALID_CREDENTIAL,
				'Not connected to passkey wallet'
			);
		}

		// Sign using PasskeyKeypair
		const { signature } = await this.passkeyKeypair.signPersonalMessage(params.message);

		return {
			signature,
			messageBytes: toBase64(params.message)
		};
	}

	/**
	 * Get current credential
	 */
	async getCredential(): Promise<PasskeyCredential | null> {
		return this.currentCredential;
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this._connected;
	}

	/**
	 * Set up account from credential
	 */
	private setupAccount(credential: PasskeyCredential): void {
		const network = this.config.network || 'mainnet';
		let address = credential.suiAddress;
		try {
			// Ensure the displayed address matches the Passkey scheme address.
			// Passkey addresses are derived with the Passkey signature flag (not Secp256r1).
			address = new PasskeyPublicKey(credential.publicKey).toSuiAddress();
		} catch {}
		const account: PasskeyAccount = {
			address,
			publicKey: credential.publicKey,
			chains: [`sui:${network}`],
			features: [
				'sui:signAndExecuteTransaction' as const,
				'sui:signTransaction' as const,
				'sui:signPersonalMessage' as const,
				'passkey:getCredential' as const
			],
			credentialId: credential.credentialId
		};

		this._accounts = [account];
	}

	/**
	 * Get RPC URL for network using SDK's getFullnodeUrl
	 */
	private async getRpcUrl(network: 'mainnet' | 'testnet' | 'devnet'): Promise<string> {
		const { getFullnodeUrl } = await import('@mysten/sui/client');
		return getFullnodeUrl(network);
	}
}

/**
 * Create a PasskeyWalletAdapter instance
 */
export function createPasskeyWalletAdapter(config: PasskeyAdapterConfig): PasskeyWalletAdapter {
	return new PasskeyWalletAdapter(config);
}
