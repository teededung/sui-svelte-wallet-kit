import { registerEnokiWallets } from '@mysten/enoki';
import { getWallets } from '@wallet-standard/core';
import { PasskeyService } from '../../PasskeyService/index.js';
import { PasskeyWalletAdapter } from '../../adapters/PasskeyWalletAdapter.js';
import { MultisigWalletAdapter } from '../../adapters/MultisigWalletAdapter.js';
import {
	multisigStore,
	initializeMultisig,
	type MultisigConfig,
	type ResolverContext,
	type SignerConfig
} from '../../MultisigService/index.js';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1PublicKey } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1PublicKey } from '@mysten/sui/keypairs/secp256r1';
import { PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type {
	ZkLoginGoogleConfig,
	PasskeyConfig,
	MultisigModuleConfig,
	SuiModuleMultisigConfig,
	SuiAccount,
	SuiWalletAdapter,
	WalletWithStatus
} from '../types.js';
import { getPreferredRedirectUrlForOAuth, getConfiguredNetwork, isBrowser } from './core.js';
import type { ConnectionStatus } from '@suiet/wallet-sdk';

// NOTE:
// Svelte 5 does not allow exporting `$state` from a module if it is reassigned.
// This file therefore keeps any module-level state as plain variables (not `$state`),
// and UI/component state should live in `SuiModule.svelte`.

// Validation helpers
export const isSuspiciousEnokiConfig = (apiKey: unknown, googleId: unknown): boolean => {
	try {
		const suspiciousApiKey = typeof apiKey === 'string' && apiKey.length < 16;
		const suspiciousGoogleId =
			typeof googleId === 'string' && !googleId.endsWith('.apps.googleusercontent.com');
		return !!(suspiciousApiKey || suspiciousGoogleId);
	} catch {
		return false;
	}
};

export const isMultisigConfig = (config: SuiModuleMultisigConfig | null): boolean => {
	return config !== null && 'mode' in config;
};

export const isLegacyMultisigConfig = (
	config: SuiModuleMultisigConfig | null
): config is MultisigModuleConfig => {
	return config !== null && 'signers' in config && !('mode' in config);
};

// Enoki registration callback
export const registerEnokiWalletsCallback = (
	client: any,
	network: string,
	zkLoginGoogle: ZkLoginGoogleConfig
): void => {
	try {
		const googleProviderOptions: any = {
			clientId: zkLoginGoogle.googleClientId
		};
		try {
			const ru = getPreferredRedirectUrlForOAuth(zkLoginGoogle);
			if (ru) googleProviderOptions.redirectUrl = ru;
		} catch {}
		registerEnokiWallets({
			client,
			network: network as any,
			apiKey: zkLoginGoogle.apiKey,
			providers: {
				google: googleProviderOptions
			}
		});
	} catch (err) {
		try {
			console.error('[SuiModule] Failed to register Enoki wallets:', err);
		} catch {}
	}
};

// Enoki API key probe
export const probeEnokiApiKey = async (
	apiKey: string,
	network: string
): Promise<boolean | undefined> => {
	if (!isBrowser) return undefined;
	if (!apiKey) return undefined;
	try {
		const res = await fetch('https://api.enoki.mystenlabs.com/v1/app', {
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` }
		});
		if (res.status === 401 || res.status === 403) {
			try {
				console.error('[SuiModule] Enoki API key invalid or unauthorized');
			} catch {}
			return false;
		}
		if (!res.ok) {
			try {
				console.warn('[SuiModule] Enoki /v1/app returned non-OK status:', res.status);
			} catch {}
			return undefined;
		}
		return true;
	} catch (err) {
		try {
			console.warn('[SuiModule] Enoki API key probe failed:', err);
		} catch {}
		return undefined;
	}
};

// Passkey registration
export const registerPasskeyWallet = (
	passkeyConfig: PasskeyConfig,
	zkLoginGoogle: ZkLoginGoogleConfig | null | undefined,
	onDiscoveryRefresh: () => void
): PasskeyWalletAdapter | null => {
	if (!isBrowser) return null;
	if (!PasskeyService.isSupported()) {
		console.warn('[SuiModule] WebAuthn is not supported in this browser. Passkey wallet disabled.');
		return null;
	}

	if (!passkeyConfig.rpId || !passkeyConfig.rpName) {
		console.error('[SuiModule] Passkey config requires rpId and rpName.');
		return null;
	}

	const cfg = getConfiguredNetwork(zkLoginGoogle) || 'mainnet';
	const adapter = new PasskeyWalletAdapter({
		rpId: passkeyConfig.rpId,
		rpName: passkeyConfig.rpName,
		authenticatorAttachment: passkeyConfig.authenticatorAttachment,
		timeout: passkeyConfig.timeout,
		network: cfg
	});

	try {
		const wallets = getWallets();
		wallets.register(adapter as any);
	} catch (err) {
		console.error('[SuiModule] Failed to register Passkey wallet:', err);
		return null;
	}

	setTimeout(() => {
		onDiscoveryRefresh();
	}, 100);

	return adapter;
};

// Multisig: build resolver context
export const buildResolverContext = (
	passkeyAdapter: PasskeyWalletAdapter | null,
	wallet: WalletWithStatus | undefined,
	account: SuiAccount | undefined,
	walletAdapter: SuiWalletAdapter | undefined
): ResolverContext => {
	const ctx: ResolverContext = {
		connectedWallets: new Map()
	};

	if (passkeyAdapter && wallet?.name === 'Passkey') {
		const passkeyAccount = passkeyAdapter.accounts?.[0];
		if (passkeyAccount) {
			ctx.passkeyAddress = passkeyAccount.address;
			try {
				const pkBytes = (passkeyAccount as any).publicKey;
				if (pkBytes) {
					ctx.passkeyPublicKey = new PasskeyPublicKey(pkBytes);
					ctx.connectedWallets.set(passkeyAccount.address, {
						address: passkeyAccount.address,
						publicKey: ctx.passkeyPublicKey
					});
				}
			} catch {}
		}
	}

	if (wallet?.name === 'Sign in with Google' && account) {
		ctx.zkLoginAddress = account.address;
		ctx.connectedWallets.set(account.address, { address: account.address });
	}

	if (
		account &&
		walletAdapter &&
		wallet?.name !== 'Passkey' &&
		wallet?.name !== 'Sign in with Google'
	) {
		try {
			const addr = account.address;
			let pk: any = undefined;

			const accountPk = (account as any).publicKey;
			if (accountPk) {
				if (typeof accountPk.toRawBytes === 'function') {
					pk = accountPk;
				} else if (accountPk instanceof Uint8Array) {
					try {
						pk = new Ed25519PublicKey(accountPk);
					} catch {
						try {
							pk = new Secp256k1PublicKey(accountPk);
						} catch {}
					}
				}
			}

			ctx.connectedWallets.set(addr, { address: addr, publicKey: pk });
		} catch {}
	}

	return ctx;
};

// Multisig: get config key for legacy config
export const getMultisigConfigKey = (cfg: MultisigModuleConfig): string => {
	try {
		const signers = Array.isArray(cfg?.signers) ? cfg.signers : [];
		const normalized = signers.map((s) => {
			let pk = '';
			try {
				if (typeof s.publicKey === 'string') pk = s.publicKey;
				else if (s.publicKey instanceof Uint8Array) pk = toBase64(s.publicKey);
			} catch {}
			return {
				id: s.id,
				type: s.type,
				weight: s.weight,
				publicKey: pk,
				addressSeed: s.addressSeed || '',
				issuer: s.issuer || ''
			};
		});
		return JSON.stringify({
			threshold: cfg.threshold,
			name: cfg.name || '',
			signers: normalized
		});
	} catch {
		return `${cfg?.threshold ?? ''}:${cfg?.name ?? ''}`;
	}
};

// Multisig: register legacy adapter
export const registerLegacyMultisigAdapter = (
	legacyConfig: MultisigModuleConfig,
	zkLoginGoogle: ZkLoginGoogleConfig | null | undefined,
	onDiscoveryRefresh: () => void,
	onAccountUpdate: (account: SuiAccount) => void,
	onStatusUpdate: (status: ConnectionStatus) => void,
	onWalletAdapterUpdate: (adapter: SuiWalletAdapter) => void,
	onConnectionDataUpdate: (data: any) => void,
	existingAdapter: MultisigWalletAdapter | null
): MultisigWalletAdapter | null => {
	if (!legacyConfig.signers || legacyConfig.signers.length === 0) {
		console.error('[SuiModule] Multisig config requires at least one signer.');
		return null;
	}

	if (typeof legacyConfig.threshold !== 'number' || legacyConfig.threshold < 1) {
		console.error('[SuiModule] Multisig config requires a valid threshold.');
		return null;
	}

	const signers: SignerConfig[] = legacyConfig.signers.map((s) => {
		const signer: SignerConfig = {
			id: s.id,
			type: s.type,
			weight: s.weight,
			name: s.name,
			addressSeed: s.addressSeed,
			issuer: s.issuer
		};

		if (s.publicKey) {
			let pkBytes: Uint8Array;
			if (typeof s.publicKey === 'string') {
				pkBytes = fromBase64(s.publicKey);
			} else if (s.publicKey instanceof Uint8Array) {
				pkBytes = s.publicKey;
			} else {
				signer.publicKey = s.publicKey as any;
				return signer;
			}

			switch (s.type) {
				case 'ed25519':
					signer.publicKey = new Ed25519PublicKey(pkBytes);
					break;
				case 'secp256k1':
					signer.publicKey = new Secp256k1PublicKey(pkBytes);
					break;
				case 'secp256r1':
				case 'passkey':
					signer.publicKey = new Secp256r1PublicKey(pkBytes);
					break;
				default:
					signer.publicKey = pkBytes as any;
			}
		}

		return signer;
	});

	const cfg = getConfiguredNetwork(zkLoginGoogle) || 'mainnet';
	const adapterConfig = {
		threshold: legacyConfig.threshold,
		signers,
		name: legacyConfig.name,
		network: cfg,
		onSignatureRequest: legacyConfig.onSignatureRequest
			? async (signer: SignerConfig, txBytes: Uint8Array) => {
					const moduleSigner =
						legacyConfig.signers?.find((s) => s.id === signer.id) ??
						({
							id: signer.id,
							type: signer.type as any,
							weight: signer.weight,
							name: signer.name
						} as any);
					return await legacyConfig.onSignatureRequest!(moduleSigner, txBytes);
				}
			: undefined,
		onAddressChange: legacyConfig.onAddressChange
	};

	if (existingAdapter) {
		try {
			existingAdapter.updateConfig(adapterConfig as any);
			const nextAccount = (existingAdapter.accounts?.[0] as any) || null;
			if (
				nextAccount &&
				typeof existingAdapter.isConnected === 'function' &&
				existingAdapter.isConnected()
			) {
				onAccountUpdate(nextAccount);
				onStatusUpdate('connected' as ConnectionStatus);
				onWalletAdapterUpdate(existingAdapter as any);
				onConnectionDataUpdate({
					selectedAccountAddress: nextAccount.address,
					selectedChain: Array.isArray(nextAccount?.chains) ? nextAccount.chains[0] : undefined
				});
			}
		} catch (err) {
			console.error('[SuiModule] Failed to update Multisig wallet config:', err);
		}
		setTimeout(() => {
			onDiscoveryRefresh();
		}, 0);
		return existingAdapter;
	}

	const adapter = new MultisigWalletAdapter(adapterConfig as any);

	try {
		const wallets = getWallets();
		wallets.register(adapter as any);
	} catch (err) {
		console.error('[SuiModule] Failed to register Multisig wallet:', err);
		return null;
	}

	setTimeout(() => {
		onDiscoveryRefresh();
	}, 100);

	return adapter;
};

// Multisig: initialize new config
export const initializeNewMultisigConfig = (
	multisigConfig: MultisigConfig,
	zkLoginGoogle: ZkLoginGoogleConfig | null | undefined,
	buildResolverContextFn: () => ResolverContext,
	signTransactionFn: (tx: any, options?: any) => Promise<{ signature: string; bytes: Uint8Array }>,
	getCurrentWalletPublicKeyFn: () => Promise<{ publicKey: any; type: string } | null>
): void => {
	const network = multisigConfig.network || getConfiguredNetwork(zkLoginGoogle) || 'testnet';

	initializeMultisig(
		multisigConfig,
		{
			getResolverContext: buildResolverContextFn,
			signTransaction: signTransactionFn,
			getCurrentWalletPublicKey: getCurrentWalletPublicKeyFn
		},
		network
	);
};

// Helper hooks
export const isPasskeyWallet = (
	wallet: WalletWithStatus | undefined,
	passkeyAdapter: PasskeyWalletAdapter | null
): boolean => {
	return wallet?.name === 'Passkey' && !!passkeyAdapter;
};

export const usePasskeyAccount = (
	wallet: WalletWithStatus | undefined,
	passkeyAdapter: PasskeyWalletAdapter | null
) => {
	return {
		get isPasskey() {
			return isPasskeyWallet(wallet, passkeyAdapter);
		},
		get address() {
			if (!passkeyAdapter || wallet?.name !== 'Passkey') return null;
			return passkeyAdapter.accounts?.[0]?.address ?? null;
		},
		get publicKey() {
			if (!passkeyAdapter || wallet?.name !== 'Passkey') return null;
			return passkeyAdapter.accounts?.[0]?.publicKey ?? null;
		},
		get credentialId() {
			if (!passkeyAdapter || wallet?.name !== 'Passkey') return null;
			const acc = passkeyAdapter.accounts?.[0];
			return (acc as any)?.credentialId ?? null;
		},
		async getCredential() {
			if (!passkeyAdapter || wallet?.name !== 'Passkey') return null;
			const feat = passkeyAdapter.features?.['passkey:getCredential'];
			if (feat && typeof feat.getCredential === 'function') {
				return await feat.getCredential();
			}
			return null;
		}
	};
};

export const isMultisigWallet = (
	wallet: WalletWithStatus | undefined,
	multisigAdapter: MultisigWalletAdapter | null
): boolean => {
	return wallet?.name === 'Multisig' && !!multisigAdapter;
};

export const useMultisigAccount = (
	wallet: WalletWithStatus | undefined,
	multisigAdapter: MultisigWalletAdapter | null
) => {
	return {
		get isMultisig() {
			return isMultisigWallet(wallet, multisigAdapter);
		},
		get address() {
			if (!multisigAdapter || wallet?.name !== 'Multisig') return null;
			return multisigAdapter.accounts?.[0]?.address ?? null;
		},
		get threshold() {
			if (!multisigAdapter || wallet?.name !== 'Multisig') return null;
			return (multisigAdapter.accounts?.[0] as any)?.threshold ?? null;
		},
		get totalWeight() {
			if (!multisigAdapter || wallet?.name !== 'Multisig') return null;
			return (multisigAdapter.accounts?.[0] as any)?.totalWeight ?? null;
		},
		getConfig() {
			if (!multisigAdapter || wallet?.name !== 'Multisig') return null;
			return multisigAdapter.getConfig();
		},
		async getAvailableSigners() {
			if (!multisigAdapter || wallet?.name !== 'Multisig') return [];
			return await multisigAdapter.getAvailableSigners();
		}
	};
};

export const isZkLoginWallet = (walletAdapter: SuiWalletAdapter | undefined): boolean => {
	return !!walletAdapter?.features?.['enoki:getSession'];
};

export const getZkLoginInfo = async (
	walletAdapter: SuiWalletAdapter | undefined
): Promise<{ session: any; metadata: any } | null> => {
	if (!isZkLoginWallet(walletAdapter)) return null;
	try {
		const sessionFeat = walletAdapter?.features?.['enoki:getSession'];
		const metaFeat = walletAdapter?.features?.['enoki:getMetadata'];
		let session = null;
		let metadata = null;
		try {
			if (sessionFeat && typeof sessionFeat.getSession === 'function') {
				session = await sessionFeat.getSession();
			}
		} catch {}
		try {
			if (metaFeat && typeof metaFeat.getMetadata === 'function') {
				metadata = await metaFeat.getMetadata();
			}
		} catch {}
		return { session, metadata };
	} catch {
		return null;
	}
};
