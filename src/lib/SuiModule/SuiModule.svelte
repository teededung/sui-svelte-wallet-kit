<script module lang="ts">
	import { ConnectionStatus, resolveAddressToSuiNSNames } from '@suiet/wallet-sdk';
	import { getWallets, type Wallet } from '@wallet-standard/core';
	import type {
		SuiWalletAdapter,
		WalletConfig,
		ZkLoginGoogleConfig,
		PasskeyConfig,
		MultisigModuleConfig,
		SuiModuleMultisigConfig,
		WalletWithStatus,
		SwitchWalletOptions,
		SuiAccount
	} from './types';
	import {
		multisigStore,
		type MultisigConfig,
		type ResolverContext
	} from '../MultisigService/index.js';
	import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
	import { Secp256k1PublicKey } from '@mysten/sui/keypairs/secp256k1';
	import { Secp256r1PublicKey } from '@mysten/sui/keypairs/secp256r1';
	import { PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
	import { parseSerializedSignature } from '@mysten/sui/cryptography';
	import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin';
	import { PasskeyService } from '../PasskeyService/index.js';
	import ConnectModal from '../ConnectModal/ConnectModal.svelte';

	// Import from extracted modules
	import {
		updateConnectionData,
		saveConnectionData,
		clearConnectionData,
		getConfiguredNetwork,
		getDefaultChain,
		getSuiClient,
		isBrowser
	} from './internal/core.js';
	import {
		setModuleWalletDiscovery as _setModuleWalletDiscovery,
		subscribeWalletDiscovery as _subscribeWalletDiscovery,
		refreshDiscoverySnapshot,
		incrementDiscoveryAttempt
	} from './internal/discovery.js';
	import * as sessionModule from './internal/session.svelte.js';
	import {
		signAndExecuteTransaction as txSignAndExecute,
		signTransaction as txSign,
		signMessage as txSignMessage,
		canSignMessage as txCanSignMessage,
		type SessionContext
	} from './internal/tx.js';
	import * as integrationsModule from './internal/integrations.svelte.js';

	// Core runtime state (kept in component for reactivity)
	let walletAdapter = $state<SuiWalletAdapter | undefined>();
	let status = $state(ConnectionStatus.DISCONNECTED);
	let _account = $state<SuiAccount | undefined>();
	let _wallet = $state<WalletWithStatus | undefined>();
	let _accountsSnapshot = $state<SuiAccount[]>([]);
	let _walletEventsOff = $state<(() => void) | undefined>();
	let _lastWalletSelection = $state<{ wallet: Wallet; installed: boolean } | undefined>();

	// Component-specific state (SuiNS, balance, UI)
	let _suiNames = $state<string[]>([]);
	let _suiNamesLoading = $state(false);
	let _suiNamesByAddress = $state<Record<string, string[]>>({});
	let _suiBalanceByAddress = $state<Record<string, string>>({});
	let _suiBalanceLoading = $state(false);
	let _lastRefreshKey = $state('');
	let _suiNSInternalUpdate = $state(false);
	let _suiNSPrefetched = $state(false);
	let _autoFetchSuiNS = $state(true);
	let _autoFetchBalance = $state(true);
	let _lastBalanceKey = $state('');
	let _balanceFetchedAtByKey = $state<Record<string, number>>({});
	let _balanceCacheTTLms = $state(2000);
	let _balanceInflightByKey: Record<string, Promise<string | null> | undefined> = {};
	let connectModal: any = $state();
	export let getConnectModal = () => connectModal;
	let _onConnect = $state(() => {});
	let _autoConnect = $state(false);
	let _walletConfig = $state<WalletConfig>({});
	let _zkLoginGoogle = $state<ZkLoginGoogleConfig | null>(null);
	let _passkeyConfig = $state<PasskeyConfig | null>(null);
	let _multisigConfig = $state<SuiModuleMultisigConfig | null>(null);

	// Integration state
	let _enokiProbeDone = $state(false);
	let _enokiKeyValid = $state<boolean | undefined>(undefined);
	let _enokiRegistered = $state(false);
	let _passkeyAdapter: any = $state(null);
	let _passkeyRegistered = $state(false);
	let _multisigAdapter: any = $state(null);
	let _multisigInitialized = $state(false);
	let _multisigRegisteredKey: string | null = $state(null);

	// Re-export helper functions
	const isMultisigConfig = integrationsModule.isMultisigConfig;
	const isLegacyMultisigConfig = integrationsModule.isLegacyMultisigConfig;
	const isSuspiciousEnokiConfig = integrationsModule.isSuspiciousEnokiConfig;
	const isSuiAccount = sessionModule.isSuiAccount;

	// Internal account management
	const account = {
		get value(): SuiAccount | undefined {
			return _account;
		},
		setAccount(account: SuiAccount | undefined): void {
			_account = account;
		},
		removeAccount(): void {
			_account = undefined;
		}
	};

	// Wrapper for getSuiClient that handles Enoki registration
	const getSuiClientWithEnoki = (chainIdLike: string) => {
		return getSuiClient(chainIdLike, {
			zkLoginGoogle: _zkLoginGoogle,
			onEnokiRegister: (client, network) => {
				integrationsModule.registerEnokiWalletsCallback(client, network, _zkLoginGoogle!);
			},
			isSuspiciousEnokiConfig: isSuspiciousEnokiConfig
		});
	};

	// Create session state object for passing to session functions
	const createSessionState = () => ({
		walletAdapter: {
			get: () => walletAdapter,
			set: (v: SuiWalletAdapter | undefined) => (walletAdapter = v)
		},
		status: { get: () => status, set: (v: ConnectionStatus) => (status = v) },
		account,
		wallet: { get: () => _wallet, set: (v: WalletWithStatus | undefined) => (_wallet = v) },
		accountsSnapshot: {
			get: () => _accountsSnapshot,
			set: (v: SuiAccount[]) => (_accountsSnapshot = v)
		},
		walletEventsOff: {
			get: () => _walletEventsOff,
			set: (v: (() => void) | undefined) => (_walletEventsOff = v)
		},
		lastWalletSelection: {
			get: () => _lastWalletSelection,
			set: (v: { wallet: Wallet; installed: boolean } | undefined) => (_lastWalletSelection = v)
		}
	});

	// Wrapper functions that use session module with local state
	const setAccountChainsInPlace = (chains: readonly `${string}:${string}`[]): void => {
		sessionModule.setAccountChainsInPlace(account, chains, _zkLoginGoogle);
	};

	const attachWalletNetworkListener = (): void => {
		sessionModule.attachWalletNetworkListener(createSessionState(), _zkLoginGoogle);
	};

	const autoConnectWallet = async (): Promise<void> => {
		await sessionModule.autoConnectWallet(
			_autoConnect,
			availableWallets,
			createSessionState(),
			_zkLoginGoogle,
			_onConnect,
			_passkeyAdapter
		);
	};

	// Fetch SuiNS names only for the active account
	const refreshSuiNamesForActive = async () => {
		if (!account.value?.address) {
			_suiNamesLoading = false;
			return;
		}

		const activeAddr = account.value.address;

		// Keep cached value while loading
		const cachedNames = _suiNamesByAddress[activeAddr];
		if (Array.isArray(cachedNames)) {
			_suiNames = cachedNames;
		} else {
			_suiNames = [];
		}

		_suiNamesLoading = true;

		try {
			const chainId = account.value?.chains?.[0] || getDefaultChain(_zkLoginGoogle);
			const client = getSuiClientWithEnoki(chainId);
			const names = await resolveAddressToSuiNSNames(client, activeAddr);
			_suiNames = Array.isArray(names) ? names : [];
			_suiNamesByAddress = { ..._suiNamesByAddress, [activeAddr]: _suiNames };

			const hasLabel =
				typeof account.value.label === 'string' && account.value.label.trim().length > 0;
			if (!hasLabel && _suiNames.length > 0) {
				setAccountLabelInPlace(_suiNames[0]);
			}
		} catch (err) {
			// ignore silently
		} finally {
			_suiNamesLoading = false;
		}
	};

	// Fetch SUI coin balance for provided address (default: active account)
	// options.force = true to bypass TTL; options.ttlMs to override default TTL for this call
	export const refreshSuiBalance = async (
		targetAddress: string,
		options: { force?: boolean; ttlMs?: number } = {}
	) => {
		const owner = targetAddress ?? account.value?.address;
		if (!owner) return null;
		const chainId = account.value?.chains?.[0] || getDefaultChain(_zkLoginGoogle);
		const key = `${owner}|${chainId}`;
		const now = Date.now();
		const lastFetchedAt = _balanceFetchedAtByKey[key] || 0;
		const ttl = typeof options.ttlMs === 'number' ? Math.max(0, options.ttlMs) : _balanceCacheTTLms;
		const isFresh = now - lastFetchedAt < ttl;

		if (_balanceInflightByKey[key]) {
			return _balanceInflightByKey[key];
		}

		if (!options.force && isFresh) {
			return _suiBalanceByAddress[owner] ?? null;
		}

		_lastBalanceKey = key;
		_suiBalanceLoading = true;
		const fetchPromise = (async () => {
			try {
				const client = getSuiClientWithEnoki(chainId);
				const res = await client.getBalance({ owner, coinType: '0x2::sui::SUI' });
				const total = res?.totalBalance ?? '0';
				_suiBalanceByAddress = { ..._suiBalanceByAddress, [owner]: total };
				_balanceFetchedAtByKey = { ..._balanceFetchedAtByKey, [key]: Date.now() };
				return total;
			} catch (_) {
				return null;
			} finally {
				delete _balanceInflightByKey[key];
				_suiBalanceLoading = false;
			}
		})();

		_balanceInflightByKey[key] = fetchPromise;
		return fetchPromise;
	};

	export const setSuiBalanceCacheTTL = (ms: number) => {
		const next = Number.isFinite(ms) ? Math.max(0, ms) : _balanceCacheTTLms;
		_balanceCacheTTLms = next;
	};

	// Fetch SuiNS names for all accounts (use on connect/import)
	const refreshSuiNamesForAll = async () => {
		_suiNamesLoading = true;
		_suiNames = [];
		_suiNamesByAddress = {};

		if (!account.value?.address) {
			_suiNamesLoading = false;
			return;
		}

		try {
			const activeAddr = account.value.address;
			const activeChain = account.value?.chains?.[0] || getDefaultChain(_zkLoginGoogle);
			const activeClient = getSuiClientWithEnoki(activeChain);
			const activeNames = await resolveAddressToSuiNSNames(activeClient, activeAddr);
			_suiNames = Array.isArray(activeNames) ? activeNames : [];
			_suiNamesByAddress = { ..._suiNamesByAddress, [activeAddr]: _suiNames };

			const hasLabel =
				typeof account.value.label === 'string' && account.value.label.trim().length > 0;

			if (!hasLabel && _suiNames.length > 0) {
				setAccountLabelInPlace(_suiNames[0]);
			}

			const allAccounts = Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];
			const otherAccounts = allAccounts.filter((acc) => acc?.address && acc.address !== activeAddr);
			const results = await Promise.allSettled(
				otherAccounts.map(async (acc) => {
					const client = getSuiClientWithEnoki(acc?.chains?.[0] || activeChain);
					const list = await resolveAddressToSuiNSNames(client, acc.address);
					return { address: acc.address, names: Array.isArray(list) ? list : [] };
				})
			);

			const mapping: Record<string, string[]> = {};
			for (const r of results) {
				if (r.status === 'fulfilled') {
					mapping[r.value.address] = r.value.names;
				} else if (r.status === 'rejected' && (r.reason as any)?.address) {
					mapping[(r.reason as any).address] = [];
				}
			}
			_suiNamesByAddress = { ..._suiNamesByAddress, ...mapping };
		} catch (err) {
			// ignore silently
		} finally {
			_suiNamesLoading = false;
		}
	};

	const setAccountLabelInPlace = (name: string): void => {
		if (!account.value) return;
		try {
			const desc = Object.getOwnPropertyDescriptor(account.value, 'label');
			if (desc && desc.writable) {
				(account.value as SuiAccount & { label?: string }).label = name || undefined;
			} else {
				Object.defineProperty(account.value, 'label', {
					value: name || undefined,
					writable: true,
					configurable: true,
					enumerable: true
				});
			}
		} catch (_) {
			// As a last resort, do a shallow copy without losing essential fields
			account.setAccount({
				...account.value,
				address: account.value.address,
				chains: account.value.chains,
				label: name || undefined
			});
			return;
		}
		// Re-assign same object to trigger reactivity, but suppress refresh effect once
		_suiNSInternalUpdate = true;
		account.setAccount(account.value);
		queueMicrotask(() => {
			_suiNSInternalUpdate = false;
		});
	};

	export const setAccountLabel = (name: string) => {
		setAccountLabelInPlace(name);
	};

	// Hook-style getter for current account
	export const useCurrentAccount = () => _account;

	// Hook-style getter for all available accounts
	export const useAccounts = () => (Array.isArray(_accountsSnapshot) ? _accountsSnapshot : []);

	// Export account loading state
	export const accountLoading = {
		get value() {
			return status === ConnectionStatus.CONNECTING;
		}
	};

	export const suiNames = {
		get value() {
			return _suiNames;
		},
		clear() {
			_suiNames = [];
		}
	};

	export const suiNamesLoading = {
		get value() {
			return _suiNamesLoading;
		}
	};

	export const suiBalance = {
		get value() {
			const addr = account.value?.address;
			return addr ? (_suiBalanceByAddress[addr] ?? null) : null;
		}
	};

	export const suiBalanceLoading = {
		get value() {
			return _suiBalanceLoading;
		}
	};

	export const suiBalanceByAddress = {
		get value() {
			return _suiBalanceByAddress;
		}
	};

	export const suiNamesByAddress = {
		get value() {
			return _suiNamesByAddress;
		}
	};

	export const useSuiClient = () => {
		let chainId;
		if (account.value?.chains?.[0]) {
			chainId = account.value.chains[0];
		} else {
			const cfg = getConfiguredNetwork(_zkLoginGoogle);
			if (cfg) {
				chainId = `sui:${cfg}`;
			} else {
				chainId = getDefaultChain(_zkLoginGoogle);
			}
		}
		return getSuiClientWithEnoki(chainId);
	};

	export const activeAccountIndex = sessionModule.activeAccountIndex(createSessionState());

	export const switchAccount = (selector: number | string | SuiAccount): boolean => {
		if (status !== ConnectionStatus.CONNECTED) {
			throw Error('wallet is not connected');
		}
		const result = sessionModule.switchAccount(selector, createSessionState(), _zkLoginGoogle);
		if (result) {
			const cachedNames = _suiNamesByAddress[account.value?.address || ''];
			if (Array.isArray(cachedNames)) {
				_suiNames = cachedNames;
			}
		}
		return result;
	};

	// Expose connected wallet info
	// Hook-style getter for current wallet info
	export const useCurrentWallet = () => {
		const base = _wallet || {};
		return {
			...base,
			name: _wallet?.name ?? '',
			iconUrl: _wallet?.iconUrl ?? _wallet?.icon ?? '',
			connectionStatus: status
		};
	};

	export const lastWalletSelection = {
		get value() {
			return _lastWalletSelection;
		},
		clear() {
			_lastWalletSelection = undefined;
		}
	};

	export const connect = async (wallet: WalletWithStatus): Promise<void> => {
		await sessionModule.connect(
			wallet,
			createSessionState(),
			_zkLoginGoogle,
			_onConnect,
			_passkeyAdapter
		);
		saveConnectionData(wallet.name, _autoConnect);
		attachWalletNetworkListener();
	};

	export const disconnect = (): void => {
		sessionModule.disconnect(createSessionState());
		clearConnectionData();
		// Clear component-specific state
		_suiNames = [];
		_suiNamesLoading = false;
		_suiNamesByAddress = {};
		_suiBalanceByAddress = {};
		_suiBalanceLoading = false;
		_lastRefreshKey = '';
		_lastBalanceKey = '';
		_balanceFetchedAtByKey = {};
		try {
			for (const k of Object.keys(_balanceInflightByKey)) delete _balanceInflightByKey[k];
		} catch {}
		_suiNSPrefetched = false;
		_suiNSInternalUpdate = false;
	};

	export const connectWithModal = async (
		onSelection?: (payload: { wallet: Wallet; installed: boolean; connected: boolean }) => void
	) => {
		return await sessionModule.connectWithModal(
			connectModal,
			onSelection,
			createSessionState(),
			_zkLoginGoogle,
			_onConnect,
			_passkeyAdapter
		);
	};

	export const switchWallet = async (options: SwitchWalletOptions = {}) => {
		return await sessionModule.switchWallet(
			getConnectModal,
			options,
			createSessionState(),
			_zkLoginGoogle,
			_onConnect,
			_passkeyAdapter
		);
	};

	// Create session context for tx functions
	const sessionContext: SessionContext = {
		getAccount: () => account.value,
		getAdapter: () => walletAdapter,
		getChain: (zkLoginGoogle: any) => {
			const acct = account.value;
			return Array.isArray(acct?.chains) && acct.chains[0]
				? acct.chains[0]
				: getDefaultChain(zkLoginGoogle);
		},
		getStatus: () => status,
		ensureCallable: () => {
			if (status !== ConnectionStatus.CONNECTED) {
				throw Error('wallet is not connected');
			}
		}
	};

	export const signAndExecuteTransaction = async (transaction: any): Promise<any> => {
		return await txSignAndExecute(transaction, sessionContext, _zkLoginGoogle);
	};

	export const signTransaction = async (
		transaction: any,
		options: { sender?: string } = {}
	): Promise<{ signature: string; bytes: Uint8Array }> => {
		return await txSign(transaction, options, sessionContext, _zkLoginGoogle);
	};

	export const signMessage = async (
		message: string | Uint8Array
	): Promise<{ signature: string; messageBytes: string }> => {
		return await txSignMessage(message, sessionContext, _zkLoginGoogle);
	};

	export const canSignMessage = (): boolean => {
		return txCanSignMessage(sessionContext);
	};

	// Integration helpers (re-exported from integrations module)
	export const isPasskeyWallet = (): boolean => {
		return integrationsModule.isPasskeyWallet(_wallet, _passkeyAdapter);
	};

	export const usePasskeyAccount = () => {
		return integrationsModule.usePasskeyAccount(_wallet, _passkeyAdapter);
	};

	export const isMultisigWallet = (): boolean => {
		return integrationsModule.isMultisigWallet(_wallet, _multisigAdapter);
	};

	export const useMultisigAccount = () => {
		return integrationsModule.useMultisigAccount(_wallet, _multisigAdapter);
	};

	export const isZkLoginWallet = (): boolean => {
		return integrationsModule.isZkLoginWallet(walletAdapter);
	};

	export const getZkLoginInfo = async (): Promise<{ session: any; metadata: any } | null> => {
		return await integrationsModule.getZkLoginInfo(walletAdapter);
	};

	export const walletAdapters: SuiWalletAdapter[] = [];
	export const availableWallets: WalletWithStatus[] = [];

	// Backward-compatible exports for wallet discovery APIs
	// (keep the original signature that mutates the exported arrays in-place)
	export const setModuleWalletDiscovery = (
		adapters: SuiWalletAdapter[],
		wallets: WalletWithStatus[]
	): void => {
		_setModuleWalletDiscovery(adapters, wallets, walletAdapters, availableWallets);
	};

	export const subscribeWalletDiscovery = (
		callback: (adapters: SuiWalletAdapter[], wallets: WalletWithStatus[]) => void
	): (() => void) => {
		const off = _subscribeWalletDiscovery(callback);
		// Emit current snapshot immediately (original behavior)
		try {
			callback(walletAdapters, availableWallets);
		} catch {}
		return off;
	};

	let _walletsRegistryOff: (() => void) | undefined = undefined;
	let _discoveryInitialized = false;

	const refreshDiscoverySnapshotWrapper = (attemptLabel: number | string): void => {
		const { adapters, wallets } = refreshDiscoverySnapshot(attemptLabel, _walletConfig);
		setModuleWalletDiscovery(adapters, wallets);
	};

	export const initWalletDiscovery = (): void => {
		if (!isBrowser) return;
		if (_discoveryInitialized) {
			const attempt = incrementDiscoveryAttempt();
			refreshDiscoverySnapshotWrapper(attempt);
			return;
		}
		_discoveryInitialized = true;
		try {
			if (_zkLoginGoogle) {
				const cfg = getConfiguredNetwork(_zkLoginGoogle) || 'mainnet';
				getSuiClientWithEnoki(`sui:${cfg}`);
			}
		} catch {}

		try {
			if (_zkLoginGoogle && !_enokiProbeDone) {
				_enokiProbeDone = true;
				const apiKey = _zkLoginGoogle?.apiKey;
				const configured = getConfiguredNetwork(_zkLoginGoogle);
				const chainId =
					account.value?.chains?.[0] ||
					(configured ? `sui:${configured}` : getDefaultChain(_zkLoginGoogle));
				const network = configured || chainId?.split?.(':')?.[1] || 'mainnet';
				if (!isSuspiciousEnokiConfig(apiKey, _zkLoginGoogle?.googleClientId)) {
					setTimeout(() => {
						integrationsModule.probeEnokiApiKey(apiKey, network).then((valid) => {
							if (valid !== undefined) _enokiKeyValid = valid;
						});
					}, 0);
				}
			}
		} catch {}
		try {
			if (typeof _walletsRegistryOff === 'function') {
				_walletsRegistryOff();
				_walletsRegistryOff = undefined;
			}
		} catch {}

		const delays = [0, 50, 200, 600, 1200];
		for (const d of delays) {
			setTimeout(() => {
				const attempt = incrementDiscoveryAttempt();
				refreshDiscoverySnapshotWrapper(attempt);
			}, d);
		}

		try {
			const registry = getWallets?.();
			const registryOn =
				registry && 'on' in registry
					? (registry.on as (event: string, callback: (wallet: Wallet) => void) => () => void)
					: undefined;
			if (registryOn && typeof registryOn === 'function') {
				_walletsRegistryOff = registryOn('register', (wallet: Wallet) => {
					try {
						const attempt = incrementDiscoveryAttempt();
					} catch {}
					refreshDiscoverySnapshotWrapper(incrementDiscoveryAttempt());
				});
			}
		} catch {}
	};
</script>

<script lang="ts">
	const props = $props<{
		onConnect?: () => void;
		autoConnect?: boolean;
		autoSuiNS?: boolean;
		autoSuiBalance?: boolean;
		walletConfig?: WalletConfig;
		zkLoginGoogle?: ZkLoginGoogleConfig | null;
		passkey?: PasskeyConfig | null;
		multisig?: SuiModuleMultisigConfig | null;
		children?: import('svelte').Snippet;
	}>();

	// Track previous zkLoginGoogle key to detect actual config changes for probe reset
	let _prevZkLoginGoogleKey: string | null = null;

	$effect(() => {
		if (props.onConnect) {
			_onConnect = props.onConnect;
		}
		_autoConnect = props.autoConnect ?? false;
		_autoFetchSuiNS = !!(props.autoSuiNS ?? true);
		_autoFetchBalance = !!(props.autoSuiBalance ?? true);
		_walletConfig = props.walletConfig || {};
		_zkLoginGoogle = props.zkLoginGoogle || null;
		_passkeyConfig = props.passkey || null;

		// Handle multisig config - support both legacy and new MultisigConfig
		if (props.multisig) {
			_multisigConfig = props.multisig;
		} else {
			_multisigConfig = null;
		}

		// Only reset probe state if zkLoginGoogle config actually changed
		const currentKey = props.zkLoginGoogle
			? `${props.zkLoginGoogle.apiKey}-${props.zkLoginGoogle.googleClientId}`
			: null;
		if (currentKey !== _prevZkLoginGoogleKey) {
			_prevZkLoginGoogleKey = currentKey;
			// Reset probe state to allow re-validation on prop change
			_enokiProbeDone = false;
			_enokiKeyValid = undefined;
		}
	});

	// Mirror discovery to instance state for reactive UI updates
	let _discoveredAdapters = $state<SuiWalletAdapter[]>([]);
	let _availableWalletsState = $state<WalletWithStatus[]>([]);
	let _availableWalletsVisible = $state<WalletWithStatus[]>([]);

	// Register Enoki wallets when zkLoginGoogle config is available
	$effect(() => {
		if (_zkLoginGoogle && !_enokiRegistered && isBrowser) {
			_enokiRegistered = true;
			const cfg = getConfiguredNetwork(_zkLoginGoogle) || 'mainnet';
			getSuiClientWithEnoki(`sui:${cfg}`);
			setTimeout(() => {
				const attempt = incrementDiscoveryAttempt();
				refreshDiscoverySnapshotWrapper(attempt);
			}, 100);
		}
	});

	let _autoConnectAttempted = false;

	// Register Passkey wallet when config is available
	$effect(() => {
		if (_passkeyConfig && !_passkeyRegistered && isBrowser) {
			_passkeyAdapter = integrationsModule.registerPasskeyWallet(
				_passkeyConfig,
				_zkLoginGoogle,
				() => {
					const attempt = incrementDiscoveryAttempt();
					refreshDiscoverySnapshotWrapper(attempt);
				}
			);
			if (_passkeyAdapter) {
				_passkeyRegistered = true;
			}
		}
	});

	// Helper to build resolver context
	const buildResolverContext = (): ResolverContext => {
		return integrationsModule.buildResolverContext(
			_passkeyAdapter,
			_wallet,
			_account,
			walletAdapter
		);
	};

	// Initialize Multisig when config is available (new MultisigConfig)
	$effect(() => {
		if (
			!_multisigConfig ||
			!isBrowser ||
			_multisigInitialized ||
			!isMultisigConfig(_multisigConfig)
		) {
			return;
		}
		_multisigInitialized = true;

		const multisigConfig = _multisigConfig as MultisigConfig;

		const getCurrentWalletPublicKey = async () => {
			if (!_account || !walletAdapter) return null;
			try {
				if (_wallet?.name === 'Passkey' && _passkeyAdapter) {
					const passkeyAccount = _passkeyAdapter.accounts?.[0];
					if (passkeyAccount) {
						const pkBytes = (passkeyAccount as any).publicKey;
						if (pkBytes) {
							return { publicKey: new PasskeyPublicKey(pkBytes), type: 'passkey' };
						}
					}
				}

				if (_wallet?.name === 'Sign in with Google') {
					try {
						const msg = 'Sui Svelte Wallet Kit: public key probe';
						const sigRes = await signMessage(msg);
						const parsed: any = parseSerializedSignature(sigRes.signature);
						if (parsed?.publicKey) {
							let pk: any = parsed.publicKey;
							if (pk instanceof Uint8Array) {
								pk = new ZkLoginPublicIdentifier(pk);
							}
							return { publicKey: pk, type: 'zklogin' };
						}
					} catch (e) {
						console.warn('[SuiModule] Failed to get zkLogin public key:', e);
					}
					return null;
				}

				const pkFeature = walletAdapter.features?.['sui:publicKey'] as any;
				if (pkFeature && typeof pkFeature.getPublicKey === 'function') {
					const pk = await pkFeature.getPublicKey();
					if (pk) {
						const keyType = pk.flag === 0 ? 'ed25519' : pk.flag === 1 ? 'secp256k1' : 'secp256r1';
						return { publicKey: pk, type: keyType };
					}
				}

				const accountPk = (_account as any).publicKey;
				if (accountPk) {
					if (typeof accountPk.toRawBytes === 'function') {
						const flag = accountPk.flag ?? 0;
						const keyType = flag === 0 ? 'ed25519' : flag === 1 ? 'secp256k1' : 'secp256r1';
						return { publicKey: accountPk, type: keyType };
					}
					if (accountPk instanceof Uint8Array) {
						try {
							const pk = new Ed25519PublicKey(accountPk);
							return { publicKey: pk, type: 'ed25519' };
						} catch {
							try {
								const pk = new Secp256k1PublicKey(accountPk);
								return { publicKey: pk, type: 'secp256k1' };
							} catch {}
						}
					}
				}

				try {
					const msg = 'Sui Svelte Wallet Kit: public key probe';
					const sigRes = await signMessage(msg);
					const parsed: any = parseSerializedSignature(sigRes.signature);
					const scheme = parsed?.signatureScheme ?? parsed?.scheme;
					const inferType = (s: string) => {
						const lower = s?.toLowerCase() || '';
						if (lower.includes('ed25519')) return 'ed25519';
						if (lower.includes('secp256k1')) return 'secp256k1';
						if (lower.includes('secp256r1')) return 'secp256r1';
						return 'ed25519';
					};

					let pk = parsed?.publicKey;
					if (pk instanceof Uint8Array) {
						const keyType = inferType(scheme);
						if (keyType === 'ed25519') pk = new Ed25519PublicKey(pk);
						else if (keyType === 'secp256k1') pk = new Secp256k1PublicKey(pk);
						else pk = new Secp256r1PublicKey(pk);
						return { publicKey: pk, type: keyType };
					}
					if (pk && typeof pk.toRawBytes === 'function') {
						return { publicKey: pk, type: inferType(scheme) };
					}
				} catch (e) {
					console.warn('[SuiModule] Failed to get public key via signing:', e);
				}

				return null;
			} catch {
				return null;
			}
		};

		integrationsModule.initializeNewMultisigConfig(
			multisigConfig,
			_zkLoginGoogle,
			buildResolverContext,
			async (tx, options) => await signTransaction(tx, options),
			getCurrentWalletPublicKey
		);
	});

	// Update Multisig resolver context when wallet changes
	$effect(() => {
		if (_multisigConfig && _account) {
			multisigStore.resolveSigners(buildResolverContext());
		}
	});

	// Register Multisig wallet when config is available (legacy MultisigModuleConfig only)
	$effect(() => {
		if (!_multisigConfig || !isBrowser || isMultisigConfig(_multisigConfig)) {
			return;
		}

		const legacyConfig = _multisigConfig as MultisigModuleConfig;
		const nextKey = integrationsModule.getMultisigConfigKey(legacyConfig);

		if (_multisigAdapter && _multisigRegisteredKey === nextKey) {
			return;
		}

		const adapter = integrationsModule.registerLegacyMultisigAdapter(
			legacyConfig,
			_zkLoginGoogle,
			() => {
				const attempt = incrementDiscoveryAttempt();
				refreshDiscoverySnapshotWrapper(attempt);
			},
			(acc) => {
				_accountsSnapshot = [acc];
				account.setAccount(acc);
			},
			(s) => {
				status = s;
			},
			(adapter) => {
				walletAdapter = adapter;
			},
			(data) => {
				updateConnectionData(data);
			},
			_multisigAdapter
		);

		if (adapter) {
			_multisigAdapter = adapter;
			_multisigRegisteredKey = nextKey;
		}
	});

	$effect(() => {
		const off = subscribeWalletDiscovery((adapters, wallets) => {
			_discoveredAdapters = Array.isArray(adapters) ? adapters.slice() : [];
			_availableWalletsState = Array.isArray(wallets) ? wallets.slice() : [];
		});
		initWalletDiscovery();
		return () => {
			try {
				off?.();
			} catch {}
		};
	});

	$effect.pre(() => {
		initWalletDiscovery();
	});

	// Filter visible wallets based on zkLoginGoogle, passkey, and multisig options
	$effect(() => {
		const wallets = Array.isArray(_availableWalletsState) ? _availableWalletsState : [];
		const canShowGoogle =
			!!(_zkLoginGoogle && _zkLoginGoogle.apiKey && _zkLoginGoogle.googleClientId) &&
			_enokiKeyValid !== false;
		const canShowPasskey =
			!!(_passkeyConfig && _passkeyConfig.rpId && _passkeyConfig.rpName) &&
			PasskeyService.isSupported();
		const canShowMultisig = !!(
			_multisigConfig &&
			isLegacyMultisigConfig(_multisigConfig) &&
			_multisigConfig.signers &&
			_multisigConfig.signers.length > 0
		);

		_availableWalletsVisible = wallets.filter((w) => {
			if (w?.name === 'Sign in with Google' && !canShowGoogle) return false;
			if (w?.name === 'Passkey' && !canShowPasskey) return false;
			if (w?.name === 'Multisig' && !canShowMultisig) return false;
			return true;
		});
	});

	// Auto-connect wallet when conditions are met
	// This effect monitors wallet availability and automatically connects if auto-connect is enabled
	$effect(() => {
		// Skip if auto-connect feature is disabled
		if (!_autoConnect) return;
		// Skip if already attempted auto-connect (prevent multiple attempts)
		if (_autoConnectAttempted) return;
		// Skip if user is already connected (account exists)
		if (account.value) return;
		// Skip if no wallets are available yet
		if (!Array.isArray(_availableWalletsState) || _availableWalletsState.length === 0) return;
		// Skip if a connection attempt is already in progress
		if (status === ConnectionStatus.CONNECTING) return;
		// Mark as attempted before proceeding
		_autoConnectAttempted = true;
		// All conditions met, proceed with auto-connect
		autoConnectWallet();
	});

	// Refresh SuiNS names when chains or address change
	$effect(() => {
		if (_suiNSInternalUpdate) return; // avoid duplicate fetch after label reassign
		const key = account.value ? `${account.value.address}|${account.value.chains?.[0] ?? ''}` : '';
		if (_autoFetchSuiNS && key && key !== _lastRefreshKey) {
			_lastRefreshKey = key;
			if (!_suiNSPrefetched) {
				_suiNSPrefetched = true;
				refreshSuiNamesForAll();
			} else {
				refreshSuiNamesForActive();
			}
		}
	});

	// Auto fetch SUI balance on account/chain change (independent from SuiNS setting)
	$effect(() => {
		if (!_autoFetchBalance) return;
		const addr = account.value?.address;
		const chain = account.value?.chains?.[0] ?? '';
		if (!addr) return;
		const key = `${addr}|${chain}`;
		if (key !== _lastBalanceKey) {
			refreshSuiBalance(addr);
		}
	});
</script>

<ConnectModal
	bind:this={connectModal}
	availableWallets={_availableWalletsVisible}
	zkLoginGoogle={_zkLoginGoogle}
	onPickInstalled={(wallet) => {
		// Disconnect current wallet first, then fire connect immediately to allow OAuth popup (Enoki)
		try {
			if (_wallet) disconnect();
		} catch {}
		connect(wallet);
	}}
/>

{@render props.children?.()}
