/**
 * Multisig Store using Svelte 5 Runes
 * Class-based reactive state management
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin';
import { toBase64 } from '@mysten/sui/utils';
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import type { PublicKey } from '@mysten/sui/cryptography';

import {
	MultisigError,
	MultisigErrorCode,
	type MultisigConfig,
	type MultisigState,
	type ResolvedSigner,
	type MultisigSigner,
	type MultisigProposal,
	type ResolverContext,
	type SignerSignatureStatus,
	type ExecuteResult
} from './MultisigTypes.js';
import { SignerResolver, parsePublicKey } from './SignerResolver.js';
import { isPreconfiguredMode, isDynamicMode } from './MultisigValidation.js';

/**
 * Context providers for Multisig
 */
export interface MultisigProviders {
	signTransaction: (
		tx: Transaction,
		options?: { sender?: string }
	) => Promise<{ signature: string; bytes: Uint8Array }>;
	getCurrentWalletPublicKey: () => Promise<{ publicKey: PublicKey; type: string } | null>;
	getResolverContext: () => ResolverContext;
}

/**
 * Derive multisig address from resolved signers
 */
function deriveMultisigAddress(signers: ResolvedSigner[], threshold: number): string | null {
	const resolvedSigners = signers.filter((s) => s.resolved && s.publicKey);
	if (resolvedSigners.length === 0) return null;

	// Check if threshold is reachable
	const totalWeight = resolvedSigners.reduce((sum, s) => sum + s.weight, 0);
	if (threshold > totalWeight) {
		// Don't log error - this is expected when user is still adding signers
		return null;
	}

	try {
		const publicKeys = resolvedSigners.map((signer) => {
			let pk: PublicKey;
			if (signer.type === 'zklogin' && signer.addressSeed && signer.issuer) {
				pk = toZkLoginPublicIdentifier(BigInt(signer.addressSeed), signer.issuer);
			} else if (signer.publicKey) {
				pk = signer.publicKey;
			} else {
				throw new Error(`Signer ${signer.id} has no public key`);
			}
			return { publicKey: pk, weight: signer.weight };
		});

		const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
			threshold,
			publicKeys
		});

		return multiSigPublicKey.toSuiAddress();
	} catch (error) {
		console.error('Failed to derive multisig address:', error);
		return null;
	}
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Multisig Store Class
 * Uses Svelte 5 Runes for reactive state
 */
export class MultisigStore {
	// Reactive state using $state
	#config = $state<MultisigConfig | null>(null);
	#threshold = $state(1);
	#mode = $state<'preconfigured' | 'dynamic' | null>(null);
	#resolvedSigners = $state<ResolvedSigner[]>([]);
	#rawSigners = $state<MultisigSigner[]>([]);
	#error = $state<string | null>(null);
	#network = $state<'mainnet' | 'testnet' | 'devnet'>('testnet');

	// Providers (set by SuiModule)
	#providers = $state<MultisigProviders | null>(null);

	// Resolver instance
	#resolver = new SignerResolver();

	// Derived state using $derived
	resolvedCount = $derived(this.#resolvedSigners.filter((s) => s.resolved).length);
	totalWeight = $derived(this.#resolvedSigners.reduce((sum, s) => sum + s.weight, 0));
	allResolved = $derived(
		this.resolvedCount === this.#resolvedSigners.length && this.#resolvedSigners.length > 0
	);

	address = $derived.by(() => {
		if (!this.allResolved) return null;
		return deriveMultisigAddress(this.#resolvedSigners, this.#threshold);
	});

	addressReady = $derived(!!this.address);
	isReady = $derived(!!this.address && this.#threshold <= this.totalWeight);

	// Public getters
	get config() {
		return this.#config;
	}
	get threshold() {
		return this.#threshold;
	}
	get mode() {
		return this.#mode;
	}
	get signers() {
		return this.#resolvedSigners;
	}
	get error() {
		return this.#error;
	}
	get network() {
		return this.#network;
	}
	get providers() {
		return this.#providers;
	}

	// State object for compatibility
	get state(): MultisigState {
		return {
			config: this.#config,
			threshold: this.#threshold,
			mode: this.#mode,
			signers: this.#resolvedSigners,
			resolvedCount: this.resolvedCount,
			totalWeight: this.totalWeight,
			address: this.address,
			addressReady: this.addressReady,
			isReady: this.isReady,
			error: this.#error
		};
	}

	/**
	 * Initialize with config
	 */
	initialize(config: MultisigConfig, network?: 'mainnet' | 'testnet' | 'devnet'): void {
		this.#config = config;
		this.#network = network || config.network || 'testnet';
		this.#error = null;

		if (isPreconfiguredMode(config)) {
			this.#mode = 'preconfigured';
			this.#threshold = config.threshold;
			this.#rawSigners = [...config.signers];
		} else if (isDynamicMode(config)) {
			this.#mode = 'dynamic';
			this.#threshold = config.defaultThreshold ?? 1;
			this.#rawSigners = [];

			// Load from storage if available
			if (config.storageKey) {
				this.loadFromStorage(config.storageKey);
			}
		}
	}

	/**
	 * Set providers (called by SuiModule)
	 */
	setProviders(providers: MultisigProviders): void {
		this.#providers = providers;
	}

	/**
	 * Resolve signers with current context
	 */
	resolveSigners(context?: ResolverContext): void {
		const ctx = context || this.#providers?.getResolverContext() || { connectedWallets: new Map() };

		if (this.#rawSigners.length === 0) {
			this.#resolvedSigners = [];
			return;
		}

		this.#resolvedSigners = this.#resolver.resolveAll(this.#rawSigners, ctx);
	}

	/**
	 * Set threshold (dynamic mode only)
	 */
	setThreshold(threshold: number): void {
		if (this.#mode !== 'dynamic') {
			throw new Error('Cannot change threshold in preconfigured mode');
		}
		this.#threshold = threshold;
	}

	/**
	 * Add signer from current wallet (dynamic mode only)
	 */
	async addSignerFromCurrentWallet(options?: { weight?: number; name?: string }): Promise<void> {
		if (this.#mode !== 'dynamic') {
			throw new Error('Cannot add signers in preconfigured mode');
		}

		if (!this.#providers) {
			throw new MultisigError(MultisigErrorCode.WALLET_NOT_CONNECTED, 'Multisig providers not set');
		}

		const resolverContext = this.#providers.getResolverContext();
		let signer: MultisigSigner;
		let signerAddress: string | undefined;

		// Get connected wallet addresses
		const connectedAddresses = Array.from(resolverContext.connectedWallets.keys());

		// Check for passkey first - use public key if available
		if (resolverContext.passkeyPublicKey || resolverContext.passkeyAddress) {
			signerAddress = resolverContext.passkeyAddress;

			// Check for duplicate
			if (this.#isDuplicateSigner('passkey', signerAddress)) {
				throw new MultisigError(
					MultisigErrorCode.INVALID_SIGNER,
					'This passkey is already added as a signer'
				);
			}

			// If we have public key, save as publicKey type for persistence
			if (resolverContext.passkeyPublicKey) {
				const pkBytes = resolverContext.passkeyPublicKey.toRawBytes();
				signer = {
					type: 'publicKey',
					publicKey: toBase64(pkBytes),
					keyType: 'passkey',
					weight: options?.weight ?? 1,
					name: options?.name ?? 'Passkey',
					address: signerAddress
				};
			} else {
				signer = {
					type: 'passkey',
					weight: options?.weight ?? 1,
					name: options?.name ?? 'Passkey',
					address: signerAddress
				};
			}
		}
		// Check for zkLogin (Sign in with Google) - get public key via signing
		else if (resolverContext.zkLoginAddress) {
			signerAddress = resolverContext.zkLoginAddress;

			// Check for duplicate
			if (this.#isDuplicateSigner('zklogin', signerAddress)) {
				throw new MultisigError(
					MultisigErrorCode.INVALID_SIGNER,
					'This zkLogin account is already added as a signer'
				);
			}

			// Try to get public key (this will sign a message for zkLogin)
			const walletInfo = await this.#providers.getCurrentWalletPublicKey();
			if (walletInfo && walletInfo.type === 'zklogin') {
				const pkBytes = walletInfo.publicKey.toRawBytes();
				signer = {
					type: 'publicKey',
					publicKey: toBase64(pkBytes),
					keyType: 'zklogin', // zkLogin public identifier
					weight: options?.weight ?? 1,
					name: options?.name ?? 'zkLogin',
					address: signerAddress
				};
			} else {
				// Fallback to zklogin type (will need to resolve later)
				signer = {
					type: 'zklogin',
					weight: options?.weight ?? 1,
					name: options?.name ?? 'zkLogin',
					address: signerAddress
				};
			}
		}
		// Try to get public key from wallet
		else {
			const walletInfo = await this.#providers.getCurrentWalletPublicKey();
			signerAddress = connectedAddresses[0];

			if (walletInfo) {
				// Got public key - use publicKey type
				const pkBytes = walletInfo.publicKey.toRawBytes();
				const derivedAddress = walletInfo.publicKey.toSuiAddress();
				signerAddress = derivedAddress || signerAddress;

				// Check for duplicate by address
				if (this.#isDuplicateSigner('publicKey', signerAddress, toBase64(pkBytes))) {
					throw new MultisigError(
						MultisigErrorCode.INVALID_SIGNER,
						'This wallet is already added as a signer'
					);
				}

				const keyType =
					walletInfo.type === 'secp256k1'
						? 'secp256k1'
						: walletInfo.type === 'secp256r1'
							? 'secp256r1'
							: 'ed25519';

				signer = {
					type: 'publicKey',
					publicKey: toBase64(pkBytes),
					keyType: keyType as 'ed25519' | 'secp256k1' | 'secp256r1',
					weight: options?.weight ?? 1,
					name: options?.name ?? 'Wallet',
					address: signerAddress
				};
			} else {
				// Cannot get public key from wallet - this is required for multisig
				if (connectedAddresses.length === 0) {
					throw new MultisigError(MultisigErrorCode.WALLET_NOT_CONNECTED, 'No wallet connected');
				}

				throw new MultisigError(
					MultisigErrorCode.WALLET_NOT_CONNECTED,
					'Could not get public key from wallet. This wallet may not support multisig. Try using a different wallet or Sign in with Google.'
				);
			}
		}

		this.#rawSigners = [...this.#rawSigners, signer];
		this.resolveSigners();
	}

	/**
	 * Check if a signer is already added (duplicate check)
	 */
	#isDuplicateSigner(type: string, address?: string, publicKeyBase64?: string): boolean {
		for (const existing of this.#rawSigners) {
			// Check by type first
			if (existing.type === type) {
				// For passkey/zklogin - only one of each type allowed
				if (type === 'passkey' || type === 'zklogin') {
					return true;
				}
				// For wallet type - check by address
				if (type === 'wallet' && existing.type === 'wallet' && existing.address === address) {
					return true;
				}
				// For publicKey type - check by public key
				if (
					type === 'publicKey' &&
					existing.type === 'publicKey' &&
					existing.publicKey === publicKeyBase64
				) {
					return true;
				}
			}
			// Also check publicKey signers by address
			if (existing.type === 'publicKey' && address && (existing as any).address === address) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Add signer (dynamic mode only)
	 */
	addSigner(signer: MultisigSigner): void {
		if (this.#mode !== 'dynamic') {
			throw new Error('Cannot add signers in preconfigured mode');
		}
		this.#rawSigners = [...this.#rawSigners, signer];
		this.resolveSigners();
	}

	/**
	 * Remove signer by ID (dynamic mode only)
	 */
	removeSigner(signerId: string): void {
		if (this.#mode !== 'dynamic') {
			throw new Error('Cannot remove signers in preconfigured mode');
		}

		const signerIndex = this.#resolvedSigners.findIndex((s) => s.id === signerId);
		if (signerIndex >= 0) {
			this.#rawSigners = this.#rawSigners.filter((_, i) => i !== signerIndex);
			this.resolveSigners();
		}
	}

	/**
	 * Update signer weight by ID (dynamic mode only)
	 */
	updateSignerWeight(signerId: string, weight: number): void {
		if (this.#mode !== 'dynamic') {
			throw new Error('Cannot update signers in preconfigured mode');
		}

		const signerIndex = this.#resolvedSigners.findIndex((s) => s.id === signerId);
		if (signerIndex >= 0 && weight >= 1) {
			// Update the easy signer weight
			this.#rawSigners = this.#rawSigners.map((s, i) => (i === signerIndex ? { ...s, weight } : s));
			this.resolveSigners();
		}
	}

	/**
	 * Create a proposal for signature collection
	 */
	async createProposal(tx: Transaction): Promise<MultisigProposal> {
		if (!this.isReady || !this.address) {
			throw new MultisigError(
				MultisigErrorCode.PROPOSAL_NOT_READY,
				'Multisig is not ready. Ensure all signers are resolved.'
			);
		}

		if (!this.#providers) {
			throw new MultisigError(MultisigErrorCode.WALLET_NOT_CONNECTED, 'Multisig providers not set');
		}

		const client = new SuiClient({ url: getFullnodeUrl(this.#network) });
		tx.setSender(this.address);

		// Get gas coin
		const coins = await client.getCoins({
			owner: this.address,
			coinType: '0x2::sui::SUI',
			limit: 1
		});

		const gasCoin = coins?.data?.[0];
		if (!gasCoin) {
			throw new MultisigError(
				MultisigErrorCode.PROPOSAL_NOT_READY,
				'No gas coin found for multisig address. Please fund the address first.'
			);
		}

		tx.setGasOwner(this.address);
		tx.setGasPayment([
			{
				objectId: gasCoin.coinObjectId,
				version: gasCoin.version,
				digest: gasCoin.digest
			}
		] as any);

		try {
			const rgp = await client.getReferenceGasPrice();
			tx.setGasPrice(Number(rgp));
		} catch {}

		tx.setGasBudget(10_000_000);

		const txBytes = await tx.build({ client });

		return this.#createProposalObject(tx, txBytes);
	}

	#createProposalObject(transaction: Transaction, txBytes: Uint8Array): MultisigProposal {
		const signatures = new Map<string, string>();
		let signedWeight = 0;
		const signers = this.#resolvedSigners;
		const threshold = this.#threshold;
		const multisigAddress = this.address!;
		const providers = this.#providers!;
		const network = this.#network;

		const getSignerStatus = (signerId: string): SignerSignatureStatus => {
			const signer = signers.find((s) => s.id === signerId);
			const signature = signatures.get(signerId);
			return {
				signerId,
				signed: !!signature,
				signature,
				error: signer?.error
			};
		};

		const getSignerStatuses = (): SignerSignatureStatus[] => {
			return signers.map((s) => getSignerStatus(s.id));
		};

		const signWithSigner = (signerId: string, signature: string): void => {
			const signer = signers.find((s) => s.id === signerId);
			if (!signer) {
				throw new MultisigError(
					MultisigErrorCode.SIGNER_MISMATCH,
					`Signer '${signerId}' not found`
				);
			}

			if (!signatures.has(signerId)) {
				signedWeight += signer.weight;
			}
			signatures.set(signerId, signature);
		};

		const signWithCurrentWallet = async (): Promise<void> => {
			const result = await providers.signTransaction(transaction, { sender: multisigAddress });
			if (!bytesEqual(result.bytes, txBytes)) {
				throw new MultisigError(
					MultisigErrorCode.SIGNER_MISMATCH,
					'Wallet produced different tx bytes. Reset proposal and rebuild before collecting signatures again.'
				);
			}
			const resolverContext = providers.getResolverContext();

			let matchedSigner: ResolvedSigner | undefined;

			const connectedAddresses = new Set(Array.from(resolverContext.connectedWallets.keys()));

			for (const signer of signers) {
				// Prefer a direct address match (covers passkey saved as 'publicKey', and any signer with a known address)
				if (signer.address && connectedAddresses.has(signer.address)) {
					matchedSigner = signer;
					break;
				}

				if (signer.type === 'passkey' && resolverContext.passkeyPublicKey) {
					matchedSigner = signer;
					break;
				}
				if (signer.type === 'zklogin' && resolverContext.zkLoginAddress) {
					matchedSigner = signer;
					break;
				}
				if (signer.type !== 'passkey' && signer.type !== 'zklogin') {
					for (const [address] of resolverContext.connectedWallets) {
						const signerAddress = signer.publicKey?.toSuiAddress();
						if (signerAddress === address) {
							matchedSigner = signer;
							break;
						}
					}
				}
			}

			if (!matchedSigner) {
				throw new MultisigError(
					MultisigErrorCode.SIGNER_MISMATCH,
					'Current wallet does not match any signer in the multisig'
				);
			}

			// Extra safety: ensure the produced signature matches the expected signer public key/address.
			// This prevents "looks signed in UI, but combine/execute fails" situations.
			try {
				const parsed: any = parseSerializedSignature(result.signature);
				const pk: any = parsed?.publicKey;
				const sigAddr =
					pk && typeof pk.toSuiAddress === 'function' ? (pk.toSuiAddress() as string) : undefined;
				const expectedAddr = matchedSigner.publicKey?.toSuiAddress?.() || matchedSigner.address;
				if (sigAddr && expectedAddr && sigAddr !== expectedAddr) {
					throw new MultisigError(
						MultisigErrorCode.SIGNER_MISMATCH,
						`Signature pubkey mismatch. Expected ${expectedAddr} but got ${sigAddr}. Clear saved demo data and re-add signers.`
					);
				}
			} catch (e) {
				// Ignore parse errors (some signature schemes may not be parsable here).
				if (e instanceof MultisigError) throw e;
			}

			// For Passkey signatures, verify locally before accepting it.
			if (matchedSigner.type === 'passkey' && matchedSigner.publicKey) {
				try {
					const ok = await (matchedSigner.publicKey as any).verifyTransaction?.(
						txBytes,
						result.signature
					);
					if (ok === false) {
						throw new MultisigError(
							MultisigErrorCode.SIGNER_MISMATCH,
							'Passkey signature failed local verification. Reset proposal and sign again.'
						);
					}
				} catch (e) {
					if (e instanceof MultisigError) throw e;
				}
			}

			signWithSigner(matchedSigner.id, result.signature);
		};

		const execute = async (): Promise<ExecuteResult> => {
			if (signedWeight < threshold) {
				throw new MultisigError(
					MultisigErrorCode.INSUFFICIENT_SIGNATURES,
					`Cannot execute: signed weight (${signedWeight}) < threshold (${threshold})`
				);
			}

			const pkEntries = signers
				.filter((s) => s.resolved && s.publicKey)
				.map((signer) => {
					let pk: PublicKey;
					if (signer.type === 'zklogin' && signer.addressSeed && signer.issuer) {
						pk = toZkLoginPublicIdentifier(BigInt(signer.addressSeed), signer.issuer);
					} else {
						pk = signer.publicKey!;
					}
					return { signerId: signer.id, publicKey: pk, weight: signer.weight };
				});

			const publicKeys = pkEntries.map(({ publicKey, weight }) => ({ publicKey, weight }));

			const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
				threshold,
				publicKeys
			});

			// Ensure we're combining against the same multisig address used to build the proposal bytes.
			const derivedMultisigAddress = multiSigPublicKey.toSuiAddress();
			if (derivedMultisigAddress !== multisigAddress) {
				throw new MultisigError(
					MultisigErrorCode.SIGNER_MISMATCH,
					`Multisig address mismatch. Proposal sender is ${multisigAddress} but current signer set derives ${derivedMultisigAddress}. Reset proposal and rebuild.`
				);
			}

			const signerIdByAddress = new Map<string, string>();
			for (const e of pkEntries) {
				try {
					signerIdByAddress.set(e.publicKey.toSuiAddress(), e.signerId);
				} catch {}
			}

			// MultiSigPublicKey may re-order keys internally; always follow its public key map order.
			const pkMap = multiSigPublicKey.getPublicKeys();
			const includedSignedWeight = pkMap.reduce((sum, entry) => {
				const addr = entry.publicKey.toSuiAddress();
				const signerId = signerIdByAddress.get(addr);
				return signerId && signatures.has(signerId) ? sum + entry.weight : sum;
			}, 0);
			if (includedSignedWeight < threshold) {
				throw new MultisigError(
					MultisigErrorCode.INSUFFICIENT_SIGNATURES,
					`Not enough signatures for the multisig public key map. Collected weight (${includedSignedWeight}) < threshold (${threshold}). Reset proposal and re-collect signatures.`
				);
			}

			// CombinePartialSignatures is order-sensitive. Always collect signatures in the same
			// order as the pk_map used inside MultiSigPublicKey.
			const orderedSigs: string[] = [];
			for (const entry of pkMap) {
				const addr = entry.publicKey.toSuiAddress();
				const signerId = signerIdByAddress.get(addr);
				const sig = signerId ? signatures.get(signerId) : undefined;
				if (!sig) continue;
				// Best-effort sanity check to detect swapped/mismatched signatures early.
				try {
					const parsed: any = parseSerializedSignature(sig);
					const pk: any = parsed?.publicKey;
					const sigAddr =
						pk && typeof pk.toSuiAddress === 'function' ? (pk.toSuiAddress() as string) : undefined;
					const expectedAddr = addr;
					if (sigAddr && sigAddr !== expectedAddr) {
						throw new MultisigError(
							MultisigErrorCode.SIGNER_MISMATCH,
							`Collected signature does not match signer public key. Expected ${expectedAddr} but got ${sigAddr}. Clear saved demo data and re-add signers.`
						);
					}
				} catch (err) {
					if (err instanceof MultisigError) throw err;
				}
				orderedSigs.push(sig);
			}

			if (orderedSigs.length === 0) {
				throw new MultisigError(
					MultisigErrorCode.INSUFFICIENT_SIGNATURES,
					'No signatures collected'
				);
			}

			const combinedSignature = multiSigPublicKey.combinePartialSignatures(orderedSigs);
			try {
				const ok = await (multiSigPublicKey as any).verifyTransaction?.(txBytes, combinedSignature);
				if (ok === false) {
					throw new MultisigError(
						MultisigErrorCode.EXECUTION_FAILED,
						'Combined multisig signature failed local verification. Reset proposal and re-collect signatures.'
					);
				}
			} catch (e) {
				if (e instanceof MultisigError) throw e;
			}
			const client = new SuiClient({ url: getFullnodeUrl(network) });

			try {
				const result = await client.executeTransactionBlock({
					transactionBlock: txBytes,
					signature: combinedSignature,
					options: { showEffects: true, showEvents: true }
				});

				return {
					digest: result.digest,
					effects: result.effects,
					events: result.events ?? undefined
				};
			} catch (error: any) {
				throw new MultisigError(
					MultisigErrorCode.EXECUTION_FAILED,
					`Transaction execution failed: ${error.message}`,
					error
				);
			}
		};

		return {
			id: `proposal-${Date.now()}`,
			transaction,
			txBytes,
			multisigAddress,
			threshold,
			signatures,
			get signedWeight() {
				return signedWeight;
			},
			get canExecute() {
				return signedWeight >= threshold;
			},
			signWithCurrentWallet,
			signWithSigner,
			execute,
			getSignerStatus,
			getSignerStatuses
		};
	}

	/**
	 * Save config to localStorage
	 */
	saveConfig(): void {
		if (this.#mode !== 'dynamic' || !this.#config) return;
		const config = this.#config as { storageKey?: string };
		if (!config.storageKey) return;

		try {
			const data = {
				signers: this.#rawSigners,
				threshold: this.#threshold
			};
			window.localStorage.setItem(config.storageKey, JSON.stringify(data));
		} catch (error) {
			console.error('Failed to save multisig config:', error);
		}
	}

	/**
	 * Load config from localStorage
	 */
	loadFromStorage(storageKey: string): boolean {
		if (typeof window === 'undefined') return false;

		try {
			const raw = window.localStorage.getItem(storageKey);
			if (!raw) return false;

			const data = JSON.parse(raw);
			if (Array.isArray(data.signers)) {
				// Normalize persisted signer addresses to match their public keys (prevents drift bugs).
				this.#rawSigners = data.signers.map((s: any) => {
					try {
						if (s && s.type === 'publicKey' && typeof s.publicKey === 'string' && s.keyType) {
							// Migration: older passkey entries were persisted as secp256r1.
							// Passkey signatures require the Passkey scheme/public key (different address flag).
							const keyType =
								s.name === 'Passkey' && s.keyType === 'secp256r1' ? 'passkey' : s.keyType;
							const pk = parsePublicKey(s.publicKey, keyType);
							const derived = pk.toSuiAddress();
							return { ...s, keyType, address: derived };
						}
					} catch {}
					return s;
				});
			}
			if (typeof data.threshold === 'number') {
				this.#threshold = data.threshold;
			}
			return true;
		} catch (error) {
			console.error('Failed to load multisig config:', error);
			return false;
		}
	}

	/**
	 * Clear config from localStorage
	 */
	clearConfig(): void {
		if (this.#mode !== 'dynamic' || !this.#config) return;
		const config = this.#config as { storageKey?: string };
		if (!config.storageKey) return;

		try {
			window.localStorage.removeItem(config.storageKey);
		} catch {}

		this.#rawSigners = [];
		this.#resolvedSigners = [];
		this.#threshold = (this.#config as any).defaultThreshold ?? 1;
	}

	/**
	 * Reset store
	 */
	reset(): void {
		this.#config = null;
		this.#threshold = 1;
		this.#mode = null;
		this.#resolvedSigners = [];
		this.#rawSigners = [];
		this.#error = null;
	}
}

// Global singleton instance
export const multisigStore = new MultisigStore();
