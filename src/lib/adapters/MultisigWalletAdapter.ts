/**
 * MultisigWalletAdapter
 * Implements SuiWalletAdapter interface for multisig accounts
 */

import type { WalletAccount } from '@wallet-standard/core';
import type {
	SuiWalletAdapter,
	SignAndExecuteTransactionParams,
	SignPersonalMessageParams,
	SignMessageResult
} from '../SuiModule/types.js';
import {
	MultisigService,
	MultisigError,
	MultisigErrorCode,
	type MultisigConfig,
	type SignerConfig,
	type SignerStatus
} from '../MultisigService/index.js';
import { toBase64 } from '@mysten/sui/utils';

// Multisig wallet icon (users emoji as data URL)
const MULTISIG_ICON =
	'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNiAyMXYtMmE0IDQgMCAwIDAtNC00SDZhNCA0IDAgMCAwLTQgNHYyIi8+PGNpcmNsZSBjeD0iOSIgY3k9IjciIHI9IjQiLz48cGF0aCBkPSJNMjIgMjF2LTJhNCA0IDAgMCAwLTMtMy44NyIvPjxwYXRoIGQ9Ik0xNiAzLjEzYTQgNCAwIDAgMSAwIDcuNzUiLz48L3N2Zz4=';

/** Wallet icon type (data URL format) */
export type WalletIconDataUrl =
	| `data:image/svg+xml;base64,${string}`
	| `data:image/webp;base64,${string}`
	| `data:image/png;base64,${string}`
	| `data:image/gif;base64,${string}`;

/**
 * Extended WalletAccount for multisig accounts
 */
export interface MultisigAccount extends WalletAccount {
	address: string;
	publicKey: Uint8Array;
	chains: readonly `sui:${string}`[];
	features: readonly `${string}:${string}`[];
	/** Multisig threshold */
	threshold: number;
	/** Total weight of all signers */
	totalWeight: number;
}

/**
 * Signer provider interface - adapters that can sign for multisig
 */
export interface SignerProvider {
	/** Signer ID matching SignerConfig.id */
	signerId: string;
	/** Sign transaction bytes, return signature */
	signTransaction(txBytes: Uint8Array): Promise<{ signature: string }>;
	/** Sign personal message, return signature */
	signPersonalMessage(message: Uint8Array): Promise<{ signature: string }>;
	/** Check if signer is available */
	isAvailable(): Promise<boolean>;
}

/**
 * Callback for requesting signature from a signer
 */
export type SignatureRequestCallback = (
	signer: SignerConfig,
	txBytes: Uint8Array
) => Promise<{ signature: string } | null>;

/**
 * Extended MultisigConfig with adapter options
 */
export interface MultisigAdapterConfig extends MultisigConfig {
	network?: 'mainnet' | 'testnet' | 'devnet';
	/** Custom icon for the multisig wallet */
	icon?: WalletIconDataUrl;
	/** Signer providers for automatic signing */
	signerProviders?: SignerProvider[];
	/** Callback to request signature from user */
	onSignatureRequest?: SignatureRequestCallback;
	/** Callback when address changes (due to config update) */
	onAddressChange?: (oldAddress: string, newAddress: string) => void;
}

/**
 * MultisigWalletAdapter class
 */
export class MultisigWalletAdapter implements SuiWalletAdapter {
	readonly name = 'Multisig';
	readonly version = '1.0.0' as const;
	readonly icon: WalletIconDataUrl;
	readonly chains = ['sui:mainnet', 'sui:testnet', 'sui:devnet'] as const;

	private config: MultisigAdapterConfig;
	private service: MultisigService;
	private _accounts: MultisigAccount[] = [];
	private _connected = false;
	private signerProviders: Map<string, SignerProvider> = new Map();

	constructor(config: MultisigAdapterConfig) {
		this.config = config;
		this.service = new MultisigService(config);
		this.icon = config.icon || (MULTISIG_ICON as WalletIconDataUrl);

		// Register signer providers
		if (config.signerProviders) {
			for (const provider of config.signerProviders) {
				this.signerProviders.set(provider.signerId, provider);
			}
		}
	}

	get accounts(): readonly MultisigAccount[] {
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
			'sui:signPersonalMessage': {
				signPersonalMessage: (params: SignPersonalMessageParams) => this.signPersonalMessage(params)
			},
			'multisig:getConfig': {
				getConfig: () => this.getConfig()
			},
			'multisig:getAvailableSigners': {
				getAvailableSigners: () => this.getAvailableSigners()
			}
		} as const;
	}

	/**
	 * Connect to multisig wallet
	 */
	async connect(): Promise<void> {
		const address = this.service.getAddress();
		const multiSigPk = this.service.getMultiSigPublicKey();

		this.setupAccount(address, multiSigPk.toRawBytes());
		this._connected = true;
	}

	/**
	 * Disconnect from multisig wallet
	 */
	async disconnect(): Promise<void> {
		this._accounts = [];
		this._connected = false;
	}

	/**
	 * Sign and execute a transaction
	 */
	async signAndExecuteTransaction(params: SignAndExecuteTransactionParams): Promise<any> {
		if (!this._connected) {
			throw new MultisigError(MultisigErrorCode.INVALID_CONFIG, 'Not connected to multisig wallet');
		}

		const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

		// Get network from chain
		const network = params.chain.replace('sui:', '') as 'mainnet' | 'testnet' | 'devnet';
		const client = new SuiClient({ url: getFullnodeUrl(network) });

		const transaction = params.transaction;
		const senderAddress = this.service.getAddress();

		// Ensure sender is set
		if (typeof transaction.setSender === 'function') {
			transaction.setSender(senderAddress);
		}

		// Build the transaction
		const txBytes = await transaction.build({ client });

		// Collect signatures
		const signatures = await this.collectSignatures(txBytes);

		// Combine signatures
		const combinedSignature = this.service.combineSignatures(signatures);

		// Execute the transaction
		const result = await client.executeTransactionBlock({
			transactionBlock: txBytes,
			signature: combinedSignature,
			options: {
				showEffects: true,
				showEvents: true
			}
		});

		return result;
	}

	/**
	 * Sign a personal message
	 */
	async signPersonalMessage(params: SignPersonalMessageParams): Promise<SignMessageResult> {
		if (!this._connected) {
			throw new MultisigError(MultisigErrorCode.INVALID_CONFIG, 'Not connected to multisig wallet');
		}

		// Collect signatures for message
		const signatures = await this.collectMessageSignatures(params.message);

		// Combine signatures
		const combinedSignature = this.service.combineSignatures(signatures);

		return {
			signature: combinedSignature,
			messageBytes: toBase64(params.message)
		};
	}

	/**
	 * Collect signatures from signers for transaction
	 */
	private async collectSignatures(txBytes: Uint8Array): Promise<string[]> {
		const signatures: string[] = [];
		let collectedWeight = 0;
		const threshold = this.config.threshold;
		const signers = this.service.getSigners();

		for (const signer of signers) {
			if (collectedWeight >= threshold) {
				break; // Threshold met
			}

			try {
				let signature: string | null = null;

				// Try signer provider first
				const provider = this.signerProviders.get(signer.id);
				if (provider) {
					const isAvailable = await provider.isAvailable();
					if (isAvailable) {
						const result = await provider.signTransaction(txBytes);
						signature = result.signature;
					}
				}

				// Fall back to callback
				if (!signature && this.config.onSignatureRequest) {
					const result = await this.config.onSignatureRequest(signer, txBytes);
					if (result) {
						signature = result.signature;
					}
				}

				if (signature) {
					signatures.push(signature);
					collectedWeight += signer.weight;
				}
			} catch (error) {
				// Skip this signer on error, continue to next
				console.warn(`[MultisigWalletAdapter] Signer ${signer.id} failed:`, error);
			}
		}

		if (collectedWeight < threshold) {
			throw new MultisigError(
				MultisigErrorCode.INSUFFICIENT_SIGNATURES,
				`Collected weight (${collectedWeight}) is less than threshold (${threshold})`
			);
		}

		return signatures;
	}

	/**
	 * Collect signatures from signers for personal message
	 */
	private async collectMessageSignatures(message: Uint8Array): Promise<string[]> {
		const signatures: string[] = [];
		let collectedWeight = 0;
		const threshold = this.config.threshold;
		const signers = this.service.getSigners();

		for (const signer of signers) {
			if (collectedWeight >= threshold) {
				break;
			}

			try {
				const provider = this.signerProviders.get(signer.id);
				if (provider) {
					const isAvailable = await provider.isAvailable();
					if (isAvailable) {
						const result = await provider.signPersonalMessage(message);
						signatures.push(result.signature);
						collectedWeight += signer.weight;
					}
				}
			} catch (error) {
				console.warn(`[MultisigWalletAdapter] Signer ${signer.id} failed:`, error);
			}
		}

		if (collectedWeight < threshold) {
			throw new MultisigError(
				MultisigErrorCode.INSUFFICIENT_SIGNATURES,
				`Collected weight (${collectedWeight}) is less than threshold (${threshold})`
			);
		}

		return signatures;
	}

	/**
	 * Get current multisig configuration
	 */
	getConfig(): MultisigConfig {
		return this.service.getConfig();
	}

	/**
	 * Get available signers with their status
	 */
	async getAvailableSigners(): Promise<SignerStatus[]> {
		const signers = this.service.getSigners();
		const statuses: SignerStatus[] = [];

		for (const signer of signers) {
			let available = false;

			const provider = this.signerProviders.get(signer.id);
			if (provider) {
				try {
					available = await provider.isAvailable();
				} catch {
					available = false;
				}
			}

			statuses.push({
				id: signer.id,
				name: signer.name,
				type: signer.type,
				weight: signer.weight,
				available,
				signed: false
			});
		}

		return statuses;
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this._connected;
	}

	/**
	 * Get MultisigService instance
	 */
	getService(): MultisigService {
		return this.service;
	}

	/**
	 * Update multisig configuration
	 */
	updateConfig(newConfig: MultisigAdapterConfig): void {
		const oldAddress = this.service.getAddress();

		this.config = newConfig;
		this.service = new MultisigService(newConfig);

		// Update signer providers
		this.signerProviders.clear();
		if (newConfig.signerProviders) {
			for (const provider of newConfig.signerProviders) {
				this.signerProviders.set(provider.signerId, provider);
			}
		}

		const newAddress = this.service.getAddress();

		// Update account if connected
		if (this._connected) {
			const multiSigPk = this.service.getMultiSigPublicKey();
			this.setupAccount(newAddress, multiSigPk.toRawBytes());
		}

		// Notify address change
		if (oldAddress !== newAddress && this.config.onAddressChange) {
			this.config.onAddressChange(oldAddress, newAddress);
		}
	}

	/**
	 * Add a signer provider
	 */
	addSignerProvider(provider: SignerProvider): void {
		this.signerProviders.set(provider.signerId, provider);
	}

	/**
	 * Remove a signer provider
	 */
	removeSignerProvider(signerId: string): void {
		this.signerProviders.delete(signerId);
	}

	/**
	 * Set up account from address
	 */
	private setupAccount(address: string, publicKey: Uint8Array): void {
		const network = this.config.network || 'mainnet';
		const account: MultisigAccount = {
			address,
			publicKey,
			chains: [`sui:${network}`],
			features: [
				'sui:signAndExecuteTransaction' as const,
				'sui:signPersonalMessage' as const,
				'multisig:getConfig' as const,
				'multisig:getAvailableSigners' as const
			],
			threshold: this.config.threshold,
			totalWeight: this.service.getTotalWeight()
		};

		this._accounts = [account];
	}
}

/**
 * Create a MultisigWalletAdapter instance
 */
export function createMultisigWalletAdapter(config: MultisigAdapterConfig): MultisigWalletAdapter {
	return new MultisigWalletAdapter(config);
}
