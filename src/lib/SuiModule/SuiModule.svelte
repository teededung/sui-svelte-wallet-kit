<script module lang="ts">
	import {
		AllDefaultWallets,
		ConnectionStatus,
		WalletRadar,
		resolveAddressToSuiNSNames
	} from '@suiet/wallet-sdk';
	import ConnectModal from '../ConnectModal/ConnectModal.svelte';
	import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
	import { getWallets } from '@wallet-standard/core';
	import type { Wallet, WalletAccount } from '@wallet-standard/core';
	import { registerEnokiWallets } from '@mysten/enoki';
	import type {
		SuiWalletAdapter,
		WalletConfig,
		ZkLoginGoogleConfig,
		ConnectionData,
		WalletChangePayload,
		WalletWithStatus,
		ModalResponse,
		SwitchWalletOptions,
		SuiNetwork
	} from './types';

	let walletAdapter = $state<SuiWalletAdapter | undefined>();
	let status = $state(ConnectionStatus.DISCONNECTED);
	let _account = $state<WalletAccount | undefined>();
	let _wallet = $state<Wallet | WalletWithStatus | undefined>();
	let _suiNames = $state<string[]>([]);
	let _suiNamesLoading = $state(false);
	let _suiNamesByAddress = $state<Record<string, string[]>>({});
	let _suiBalanceByAddress = $state<Record<string, string>>({});
	let _suiBalanceLoading = $state(false);
	let _lastRefreshKey = $state('');
	let _lastAccountsKey = $state('');
	let _suiNSInternalUpdate = $state(false);
	let _suiNSPrefetched = $state(false);
	let _walletEventsOff = $state<(() => void) | undefined>();
	let _autoFetchSuiNS = $state(true);
	let _autoFetchBalance = $state(true);
	let _lastBalanceKey = $state('');
	let _balanceFetchedAtByKey = $state<Record<string, number>>({}); // key: owner|chain -> timestamp
	let _balanceCacheTTLms = $state(2000); // default cache TTL for balance
	let _balanceInflightByKey: Record<string, Promise<string | null> | undefined> = {}; // key -> Promise
	let _accountsSnapshot = $state<WalletAccount[]>([]);
	let connectModal: any = $state();
	export let getConnectModal = () => connectModal;
	let _onConnect = $state(() => {});
	let _autoConnect = $state(false);
	let _lastWalletSelection = $state<{ wallet: Wallet; installed: boolean } | undefined>();
	let _walletConfig = $state<WalletConfig>({});
	let _zkLoginGoogle = $state<ZkLoginGoogleConfig | null>(null);
	let _enokiProbeDone = $state(false);
	let _enokiKeyValid = $state<boolean | undefined>(undefined);

	const STORAGE_KEY = 'sui-module-connection';

	// Environment guards
	const isBrowser = typeof window !== 'undefined';
	const hasLocalStorage = () => isBrowser && !!window.localStorage;

	// Compute a safe redirect URL for OAuth providers (force root path to avoid route mismatches)
	const getSafeRedirectUrlForOAuth = () => {
		if (!isBrowser) return undefined;
		try {
			const url = new URL(window.location.href);
			url.hash = '';
			url.search = '';
			url.pathname = '/';
			return url.toString();
		} catch {
			return undefined;
		}
	};

	// Normalize and validate absolute URL (http/https only)
	const normalizeAbsoluteUrl = (value: unknown): string | undefined => {
		try {
			if (typeof value !== 'string' || value.trim().length === 0) return undefined;
			const url = new URL(value);
			if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
			return undefined;
		} catch {
			return undefined;
		}
	};

	// Pick best redirect URL from provided list (prefer same-origin and root path)
	const pickRedirectFromList = (list: unknown): string | undefined => {
		if (!isBrowser) return undefined;
		try {
			const values = Array.isArray(list) ? list : [];
			const valid = values.map((v) => normalizeAbsoluteUrl(v)).filter((v) => typeof v === 'string');
			if (valid.length === 0) return undefined;
			const current = new URL(window.location.href);
			const sameOrigin = valid.filter((u) => {
				try {
					return new URL(u).origin === current.origin;
				} catch {
					return false;
				}
			});
			if (sameOrigin.length > 0) {
				const root = sameOrigin.find((u) => {
					try {
						return new URL(u).pathname === '/';
					} catch {
						return false;
					}
				});
				return root || sameOrigin[0];
			}
			return valid[0];
		} catch {
			return undefined;
		}
	};

	// Determine preferred redirect URL from config or fallback to safe root
	const getPreferredRedirectUrlForOAuth = () => {
		try {
			const fromSingle = normalizeAbsoluteUrl(_zkLoginGoogle?.redirectUrl);
			if (fromSingle) return fromSingle;
			const fromList = pickRedirectFromList(_zkLoginGoogle?.redirectUrls);
			if (fromList) return fromList;
			return getSafeRedirectUrlForOAuth();
		} catch {
			return getSafeRedirectUrlForOAuth();
		}
	};

	const _clientCache: Record<string, SuiClient> = {};
	const getSuiClient = (chainIdLike: string) => {
		const network = chainIdLike?.split?.(':')?.[1] || 'mainnet';
		if (!_clientCache[network]) {
			_clientCache[network] = new SuiClient({
				url: getFullnodeUrl(network as any),
				network
			});

			// Register Enoki wallets only when zkLoginGoogle is enabled and in browser environment
			if (_zkLoginGoogle && isBrowser) {
				const apiKey = _zkLoginGoogle?.apiKey;
				const googleId = _zkLoginGoogle?.googleClientId;

				// Basic validation and developer-friendly logs
				if (!apiKey || !googleId) {
					_enokiKeyValid = false;
					try {
						const missing = [!apiKey ? 'apiKey' : null, !googleId ? 'googleClientId' : null]
							.filter(Boolean)
							.join(', ');
						console.error(
							`[SuiModule] Enoki zkLogin is enabled but missing: ${missing}. Provide zkLoginGoogle={ apiKey, googleClientId }. See docs: https://docs.enoki.mystenlabs.com/ts-sdk/sign-in`
						);
					} catch {}
				} else {
					if (isSuspiciousEnokiConfig(apiKey, googleId)) {
						_enokiKeyValid = false;
						try {
							console.error(
								`[SuiModule] Enoki config looks unusual: ${
									typeof apiKey === 'string' && apiKey.length < 16 ? 'apiKey too short; ' : ''
								}${
									typeof googleId === 'string' && !googleId.endsWith('.apps.googleusercontent.com')
										? 'googleClientId should typically end with .apps.googleusercontent.com; '
										: ''
								}please verify`
							);
						} catch {}
						// Skip registering Enoki if suspicious
					} else {
						try {
							const googleProviderOptions: any = {
								clientId: googleId
							};
							try {
								const ru = getPreferredRedirectUrlForOAuth();
								if (ru) googleProviderOptions.redirectUrl = ru;
							} catch {}
							registerEnokiWallets({
								client: _clientCache[network],
								network: network as any,
								apiKey,
								providers: {
									google: googleProviderOptions
								}
							});
						} catch (err) {
							try {
								console.error('[SuiModule] Failed to register Enoki wallets:', err);
							} catch {}
						}
					}
				}
			}
		}
		return _clientCache[network];
	};

	const saveConnectionData = (walletName: string): void => {
		if (!_autoConnect || !hasLocalStorage()) return;
		const current = getConnectionData() || {};
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...current, walletName, autoConnect: true })
		);
	};

	const getConnectionData = (): ConnectionData | null => {
		if (!hasLocalStorage()) return null;
		const data = window.localStorage.getItem(STORAGE_KEY);
		return data ? (JSON.parse(data) as ConnectionData) : null;
	};

	const updateConnectionData = (partial: Partial<ConnectionData>): void => {
		if (!hasLocalStorage()) return;
		const current = getConnectionData() || {};
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
	};

	const clearConnectionData = () => {
		if (!hasLocalStorage()) return;
		window.localStorage.removeItem(STORAGE_KEY);
	};

	/**
	 * Get configured network from zkLoginGoogle.network (only for zkLogin wallets)
	 */
	const getConfiguredNetwork = (): SuiNetwork | undefined => {
		try {
			const net = _zkLoginGoogle?.network;
			if (net === 'mainnet' || net === 'testnet' || net === 'devnet') return net;
		} catch {}
		return undefined;
	};

	const getDefaultChain = () => {
		// Priority 1: zkLoginGoogle.network (for zkLogin wallet consistency before/after connect)
		const cfg = getConfiguredNetwork();
		if (cfg) return `sui:${cfg}`;

		// Priority 2: localStorage (previous session)
		try {
			const selected = getConnectionData()?.selectedChain;
			if (typeof selected === 'string' && selected.startsWith('sui:')) return selected;
		} catch {}

		// Priority 3: fallback to mainnet
		return 'sui:mainnet';
	};

	const isSuiAccount = (acc: unknown): acc is WalletAccount =>
		typeof acc === 'object' &&
		acc !== null &&
		'chains' in acc &&
		Array.isArray((acc as WalletAccount).chains) &&
		(acc as WalletAccount).chains.some((c) => typeof c === 'string' && c.startsWith('sui:'));

	const setAccountChainsInPlace = (chains: readonly `${string}:${string}`[]): void => {
		if (!account.value) return;
		try {
			const desc = Object.getOwnPropertyDescriptor(account.value, 'chains');
			if (desc && desc.writable) {
				(account.value as WalletAccount & { chains: readonly `${string}:${string}`[] }).chains =
					chains || account.value.chains;
			} else {
				Object.defineProperty(account.value, 'chains', {
					value: chains || account.value.chains,
					writable: true,
					configurable: true,
					enumerable: true
				});
			}
		} catch (_) {
			account.setAccount({
				...account.value,
				address: account.value.address,
				chains: chains || account.value.chains
			});
			return;
		}
		account.setAccount(account.value);
	};

	const attachWalletNetworkListener = () => {
		if (!isBrowser) return;
		try {
			if (typeof _walletEventsOff === 'function') {
				_walletEventsOff();
				_walletEventsOff = undefined;
			}

			const wallets = getWallets().get();
			const activeAddr = account.value?.address;
			if (!activeAddr) return;
			const byName = wallets.find(
				(w) => w.name === _wallet?.name && w.accounts?.some?.((a) => a.address === activeAddr)
			);
			const byAddr = wallets.find((w) => w.accounts?.some?.((a) => a.address === activeAddr));
			const active = byName || byAddr;
			if (!active) return;

			const eventsFeature = active.features?.['standard:events'] as {
				on?: (event: string, callback: (payload: WalletChangePayload) => void) => () => void;
			};
			if (!eventsFeature || typeof eventsFeature.on !== 'function') return;

			_walletEventsOff = eventsFeature.on('change', async (payload: WalletChangePayload) => {
				const { accounts, chains } = payload || {};
				// Some wallets emit `chains` directly on network change
				if (Array.isArray(chains) && chains.length > 0) {
					setAccountChainsInPlace(chains as readonly `${string}:${string}`[]);
					updateConnectionData({ selectedChain: chains[0] });
					return;
				}

				// Accounts change
				if (!Array.isArray(accounts) || accounts.length === 0) return;
				const suiAccounts = accounts.filter(isSuiAccount);
				if (suiAccounts.length === 0) return;
				_accountsSnapshot = suiAccounts;
				const lower = (s: string) => s.toLowerCase();
				const currentAddr = lower(activeAddr);
				const nextAccount =
					suiAccounts.find((a) => lower(a.address) === currentAddr) || suiAccounts[0];
				if (!nextAccount) return;

				account.setAccount(nextAccount);
				const effChains = Array.isArray(nextAccount.chains)
					? nextAccount.chains
					: account.value?.chains;
				if (Array.isArray(effChains) && effChains.length > 0) {
					setAccountChainsInPlace(effChains as readonly `${string}:${string}`[]);
				}
				updateConnectionData({
					selectedAccountAddress: nextAccount.address,
					selectedChain: Array.isArray(nextAccount?.chains) ? nextAccount.chains[0] : undefined
				});
				// Let reactive effects handle SuiNS and balance fetching
			});
		} catch (_) {
			// ignore
		}
	};

	const autoConnectWallet = async () => {
		if (!_autoConnect) return;

		const connectionData = getConnectionData();
		if (!connectionData?.autoConnect) return;

		const wallet = availableWallets.find((w) => w.name === connectionData.walletName);
		if (wallet && wallet.installed) {
			await connect(wallet);
		}
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
			const chainId = account.value?.chains?.[0] || getDefaultChain();
			const client = getSuiClient(chainId);
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
		const chainId = account.value?.chains?.[0] || getDefaultChain();
		const key = `${owner}|${chainId}`;
		const now = Date.now();
		const lastFetchedAt = _balanceFetchedAtByKey[key] || 0;
		const ttl = typeof options.ttlMs === 'number' ? Math.max(0, options.ttlMs) : _balanceCacheTTLms;
		const isFresh = now - lastFetchedAt < ttl;

		// Return in-flight promise if there is one (dedupe concurrent calls)
		if (_balanceInflightByKey[key]) {
			return _balanceInflightByKey[key];
		}

		// Respect TTL unless force is requested
		if (!options.force && isFresh) {
			return _suiBalanceByAddress[owner] ?? null;
		}

		_lastBalanceKey = key;
		_suiBalanceLoading = true;
		const fetchPromise = (async () => {
			try {
				const client = getSuiClient(chainId);
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
			const activeChain = account.value?.chains?.[0] || getDefaultChain();
			const activeClient = getSuiClient(activeChain);
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
					const client = getSuiClient(acc?.chains?.[0] || activeChain);
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
				(account.value as WalletAccount & { label?: string }).label = name || undefined;
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

	// Internal account management (not exported)
	const account = {
		get value(): WalletAccount | undefined {
			return _account;
		},
		setAccount(account: WalletAccount | undefined): void {
			_account = account;
		},
		removeAccount(): void {
			_account = undefined;
		}
	};

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
		// Priority: wallet's active chain > zkLoginGoogle.network > localStorage > mainnet
		let chainId;
		if (account.value?.chains?.[0]) {
			// Use chain from connected wallet (read from wallet extension)
			chainId = account.value.chains[0];
		} else {
			// Fallback when not connected: use zkLogin config or localStorage or mainnet
			const cfg = getConfiguredNetwork();
			if (cfg) {
				chainId = `sui:${cfg}`;
			} else {
				chainId = getDefaultChain();
			}
		}
		return getSuiClient(chainId);
	};

	export const activeAccountIndex = {
		get value() {
			if (!account.value) return -1;
			const list = Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];
			return list.findIndex((acc) => acc.address === account.value!.address);
		}
	};

	export const switchAccount = (selector: number | string | WalletAccount): boolean => {
		ensureCallable();
		const list = Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];

		let nextAccount: WalletAccount | undefined = undefined;
		if (typeof selector === 'number') {
			nextAccount = list[selector];
		} else if (typeof selector === 'string') {
			const target = selector.toLowerCase();
			nextAccount = list.find((acc) => acc.address.toLowerCase() === target);
		} else if (selector && typeof selector === 'object' && 'address' in selector) {
			const target = selector.address?.toLowerCase();
			nextAccount = list.find((acc) => acc.address.toLowerCase() === target) || selector;
		}

		if (!nextAccount) return false;
		account.setAccount(nextAccount);
		if (!Array.isArray(nextAccount?.chains) || nextAccount.chains.length === 0) {
			setAccountChainsInPlace([getDefaultChain() as `${string}:${string}`]);
		}
		updateConnectionData({
			selectedAccountAddress: nextAccount.address,
			selectedChain:
				Array.isArray(nextAccount?.chains) && nextAccount.chains[0]
					? nextAccount.chains[0]
					: getDefaultChain()
		});
		
		// Update _suiNames immediately from cache if available
		const cachedNames = _suiNamesByAddress[nextAccount.address];
		if (Array.isArray(cachedNames)) {
			_suiNames = cachedNames;
		}
		
		return true;
	};

	// Expose connected wallet info
	// Hook-style getter for current wallet info
	export const useCurrentWallet = () => {
		const base = _wallet || {};
		return {
			...base,
			name: _wallet?.name ?? '',
			iconUrl: (_wallet as any)?.iconUrl ?? _wallet?.icon ?? '',
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

	export const connectWithModal = async (
		onSelection?: (payload: { wallet: Wallet; installed: boolean; connected: boolean }) => void
	) => {
		if (account.value) return { connected: true, alreadyConnected: true };
		// Reuse the internal selection loop so behavior is consistent with switchWallet
		while (true) {
			const result: ModalResponse | undefined = await connectModal?.openAndWaitForResponse();
			if (!result)
				return { wallet: undefined, installed: false, connected: false, cancelled: true };
			const selectedWallet = result?.wallet ?? (result as unknown as Wallet);
			const installed =
				typeof result === 'object'
					? !!result?.installed
					: !!(selectedWallet as WalletWithStatus)?.installed;
			_lastWalletSelection = { wallet: selectedWallet, installed: !!installed };
			try {
				onSelection?.({ wallet: selectedWallet, installed, connected: false });
			} catch {}
			if (!installed) continue;
			// If modal already started the connect (to preserve user gesture), skip re-calling connect
			if (!result?.started) {
				await connect(selectedWallet);
			}
			return { wallet: selectedWallet, installed: true, connected: true };
		}
	};

	export const connect = async (wallet: Wallet | WalletWithStatus): Promise<void> => {
		walletAdapter = (wallet as WalletWithStatus)?.adapter;
		if (walletAdapter) {
			status = ConnectionStatus.CONNECTING;
			try {
				// Prefer adapter.connect when available
				if (typeof walletAdapter.connect === 'function') {
					await walletAdapter.connect();
				} else if (
					walletAdapter?.features?.['standard:connect'] &&
					typeof walletAdapter.features['standard:connect'].connect === 'function'
				) {
					// Fallback to Wallet Standard connect (e.g., Enoki zkLogin)
					await walletAdapter.features['standard:connect'].connect();
				} else {
					throw new Error('No compatible connect method on wallet');
				}

				const rawAccounts = Array.isArray(walletAdapter.accounts) ? walletAdapter.accounts : [];
				const allAccounts = rawAccounts.filter(isSuiAccount);
				_accountsSnapshot = allAccounts;
				const connectionData = getConnectionData();
				const preferredAddress = connectionData?.selectedAccountAddress?.toLowerCase();
				let selectedAccount = allAccounts[0];
				if (preferredAddress) {
					const found = allAccounts.find((acc) => acc.address.toLowerCase() === preferredAddress);
					if (found) selectedAccount = found;
				}

				account.setAccount(selectedAccount);
				// Ensure account has a valid chain identifier
				if (!Array.isArray(selectedAccount?.chains) || selectedAccount.chains.length === 0) {
					const defaultChain = getDefaultChain() as `${string}:${string}`;
					setAccountChainsInPlace([defaultChain]);
				}
				_wallet = wallet;
				status = ConnectionStatus.CONNECTED;
				saveConnectionData(wallet.name);
				updateConnectionData({
					selectedAccountAddress: selectedAccount?.address,
					selectedChain:
						Array.isArray(selectedAccount?.chains) && selectedAccount.chains[0]
							? selectedAccount.chains[0]
							: getDefaultChain()
				});
				_onConnect();
				// Attach network change listener for the active wallet
				attachWalletNetworkListener();
				// Let reactive effects prefetch balance/names after connect
			} catch {
				status = ConnectionStatus.DISCONNECTED;
			}
		}
	};

	export const disconnect = (): void => {
		// Support both Wallet Standard and adapter-specific disconnect
		try {
			const std = walletAdapter?.features?.['standard:disconnect'];
			if (std && typeof std.disconnect === 'function') {
				try {
					std.disconnect();
				} catch {}
			} else if (walletAdapter && typeof walletAdapter.disconnect === 'function') {
				try {
					walletAdapter.disconnect();
				} catch {}
			}
		} catch {}
		account.removeAccount();
		status = ConnectionStatus.DISCONNECTED;
		clearConnectionData();
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
		_accountsSnapshot = [];
		_suiNSPrefetched = false;
		_suiNSInternalUpdate = false;
		if (typeof _walletEventsOff === 'function') {
			_walletEventsOff();
			_walletEventsOff = undefined;
		}
		walletAdapter = undefined;
		_wallet = undefined;
	};

	// Programmatic wallet switch with modal and callbacks
	// options.onSelection({ wallet, installed, connected:false }) -> notify every pick
	// options.shouldConnect({ selectedWallet, currentWallet }) -> boolean to decide proceeding
	// options.onBeforeDisconnect(currentWallet, selectedWallet)
	// options.onConnected(newWallet)
	// options.onCancel()
	export const switchWallet = async (options: SwitchWalletOptions = {}) => {
		try {
			const modal = typeof getConnectModal === 'function' ? getConnectModal() : undefined;
			if (!modal) return { connected: false, cancelled: true };
			while (true) {
				const result: ModalResponse | undefined = await modal.openAndWaitForResponse();
				if (!result) {
					try {
						options?.onCancel?.();
					} catch {}
					return { connected: false, cancelled: true };
				}
				const selectedWallet = result?.wallet ?? (result as unknown as Wallet);
				const installed =
					typeof result === 'object'
						? !!result?.installed
						: !!(selectedWallet as WalletWithStatus)?.installed;
				_lastWalletSelection = { wallet: selectedWallet, installed: !!installed };
				try {
					options?.onSelection?.({ wallet: selectedWallet, installed, connected: false });
				} catch {}
				if (!installed) {
					continue;
				}

				const proceed =
					typeof options?.shouldConnect === 'function'
						? !!options.shouldConnect({ selectedWallet, currentWallet: _wallet })
						: true;
				if (!proceed) {
					return { wallet: selectedWallet, installed: true, connected: false, skipped: true };
				}

				try {
					options?.onBeforeDisconnect?.(_wallet, selectedWallet);
				} catch {}
				// If modal already triggered connect (to preserve user gesture), do not disconnect/connect again
				if (result?.started) {
					try {
						options?.onConnected?.(selectedWallet);
					} catch {}
					return { wallet: selectedWallet, installed: true, connected: true };
				}
				try {
					disconnect();
				} catch {}
				await connect(selectedWallet);
				try {
					options?.onConnected?.(_wallet);
				} catch {}
				return { wallet: selectedWallet, installed: true, connected: true };
			}
		} catch (_) {
			return { connected: false, error: 'switch-failed' };
		}
	};

	export const signAndExecuteTransaction = async (transaction: any): Promise<any> => {
		ensureCallable();
		const acct = account.value;
		if (!acct) throw new Error('No account connected');
		const chain =
			Array.isArray(acct?.chains) && acct.chains[0] ? acct.chains[0] : getDefaultChain();
		// Ensure sender is set for wallets (e.g., Enoki) that require explicit sender
		try {
			if (transaction && typeof transaction.setSender === 'function') {
				transaction.setSender(acct.address);
			}
		} catch {}
		if (typeof walletAdapter?.signAndExecuteTransaction === 'function') {
			return await walletAdapter.signAndExecuteTransaction({ account: acct, chain, transaction });
		}
		const featTx = walletAdapter?.features?.['sui:signAndExecuteTransaction'];
		if (featTx && typeof featTx.signAndExecuteTransaction === 'function') {
			return await featTx.signAndExecuteTransaction({ account: acct, chain, transaction });
		}
		const featTxB = walletAdapter?.features?.['sui:signAndExecuteTransactionBlock'];
		if (featTxB && typeof featTxB.signAndExecuteTransactionBlock === 'function') {
			return await featTxB.signAndExecuteTransactionBlock({
				account: acct,
				chain,
				transactionBlock: transaction
			});
		}
		throw new Error('This wallet does not support signAndExecuteTransaction.');
	};

	export const signMessage = async (
		message: string | Uint8Array
	): Promise<{ signature: string; messageBytes: string }> => {
		ensureCallable();

		// Convert string to Uint8Array if needed
		const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

		const acct = account.value;
		if (!acct) throw new Error('No account connected');
		const chain =
			Array.isArray(acct?.chains) && acct.chains[0] ? acct.chains[0] : getDefaultChain();

		// Prefer Wallet Standard feature if available
		const featMsg = walletAdapter?.features?.['sui:signMessage'];
		if (featMsg && typeof featMsg.signMessage === 'function') {
			const result = await featMsg.signMessage({ account: acct, chain, message: messageBytes });
			return {
				signature: result.signature,
				messageBytes: Array.from(messageBytes)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('')
			};
		}

		// Try Wallet Standard sui:signPersonalMessage if provided by adapter
		const featPersonal = walletAdapter?.features?.['sui:signPersonalMessage'];
		if (featPersonal && typeof featPersonal.signPersonalMessage === 'function') {
			const result = await featPersonal.signPersonalMessage({
				account: acct,
				chain,
				message: messageBytes
			});
			return {
				signature: result.signature,
				messageBytes: Array.from(messageBytes)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('')
			};
		}

		// Fallback to adapter-specific personal message signing
		if (walletAdapter && typeof walletAdapter.signPersonalMessage === 'function') {
			const result = await walletAdapter.signPersonalMessage({
				account: acct,
				message: messageBytes
			});
			return {
				signature: result.signature,
				messageBytes: Array.from(messageBytes)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('')
			};
		}

		throw new Error(
			'This wallet does not support message signing. Please try a different wallet or use signAndExecuteTransaction instead.'
		);
	};

	export const canSignMessage = (): boolean => {
		if (status !== ConnectionStatus.CONNECTED || !walletAdapter) {
			return false;
		}

		return (
			(walletAdapter.features &&
				walletAdapter.features['sui:signMessage'] &&
				typeof walletAdapter.features['sui:signMessage'].signMessage === 'function') ||
			(walletAdapter.features &&
				walletAdapter.features['sui:signPersonalMessage'] &&
				typeof walletAdapter.features['sui:signPersonalMessage'].signPersonalMessage ===
					'function') ||
			typeof walletAdapter.signMessage === 'function' ||
			typeof walletAdapter.signPersonalMessage === 'function'
		);
	};

	const isSuspiciousEnokiConfig = (apiKey: unknown, googleId: unknown): boolean => {
		try {
			const suspiciousApiKey = typeof apiKey === 'string' && apiKey.length < 16;
			const suspiciousGoogleId =
				typeof googleId === 'string' && !googleId.endsWith('.apps.googleusercontent.com');
			return !!(suspiciousApiKey || suspiciousGoogleId);
		} catch {
			return false;
		}
	};

	// zkLogin helpers (Enoki)
	export const isZkLoginWallet = (): boolean => {
		return !!walletAdapter?.features?.['enoki:getSession'];
	};

	export const getZkLoginInfo = async (): Promise<{ session: any; metadata: any } | null> => {
		if (!isZkLoginWallet()) return null;
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

	const normalizeWalletName = (name: string) =>
		(name || '')
			.toLowerCase()
			.replace(/wallet$/g, '')
			.replace(/[^a-z0-9]/g, '');

	const applyWalletConfig = (
		wallets: WalletWithStatus[],
		config: WalletConfig
	): WalletWithStatus[] => {
		const { customNames = {}, ordering = [] } = config;

		// Apply custom names
		const walletsWithCustomNames = wallets.map((wallet) => {
			const customName = customNames[wallet.name];
			return customName
				? { ...wallet, displayName: customName, originalName: wallet.name }
				: wallet;
		});

		// Apply custom ordering
		// if (isBrowser && ordering.length > 0) {
		// 	console.log('📋 Applying ordering:', [...ordering]);
		// }
		const result =
			ordering.length > 0
				? walletsWithCustomNames.sort((a, b) => {
						const aName = a.originalName || a.name;
						const bName = b.originalName || b.name;
						const aIndex = ordering.indexOf(aName);
						const bIndex = ordering.indexOf(bName);

						// If both wallets are in ordering, sort by order
						if (aIndex !== -1 && bIndex !== -1) {
							return aIndex - bIndex;
						}
						// If only a is in ordering, a comes first
						if (aIndex !== -1) return -1;
						// If only b is in ordering, b comes first
						if (bIndex !== -1) return 1;
						// If neither is in ordering, sort alphabetically
						return aName.localeCompare(bName);
					})
				: walletsWithCustomNames;
		// if (isBrowser && result.length > 0) {
		// 	console.log('✅ Final wallet order:', result.map((w) => `${w.name} → ${w.displayName || w.name}`));
		// }

		return result;
	};

	const getAvailableWallets = (
		defaultWallets: readonly { name: string; iconUrl?: string; [key: string]: any }[],
		detectedAdapters: SuiWalletAdapter[],
		config: WalletConfig = {}
	): WalletWithStatus[] => {
		const adapters = Array.isArray(detectedAdapters) ? detectedAdapters : detectWalletAdapters();

		// Map default wallets to detected adapters by fuzzy-normalized name matching
		const list: WalletWithStatus[] = defaultWallets.map((item) => {
			const normalizedItem = normalizeWalletName(item.name);
			const foundAdapter = adapters.find((walletAdapter) => {
				const normalizedAdapter = normalizeWalletName(walletAdapter.name);
				return (
					normalizedItem.includes(normalizedAdapter) || normalizedAdapter.includes(normalizedItem)
				);
			});

			return {
				...item,
				name: item.name,
				iconUrl: item.iconUrl,
				adapter: foundAdapter ? foundAdapter : undefined,
				installed: !!foundAdapter
			} as WalletWithStatus;
		});

		// Include extra detected adapters that are NOT present in the default wallet list
		// This covers wallets like Coin98 that support Sui but aren't listed in the SDK defaults
		const defaultNormalizedNames = defaultWallets.map((w) => normalizeWalletName(w.name));
		const extraAdapters = adapters.filter((a) => {
			const na = normalizeWalletName(a.name);
			return !defaultNormalizedNames.some((dn) => dn.includes(na) || na.includes(dn));
		});

		const extraWalletEntries: WalletWithStatus[] = extraAdapters.map((a) => ({
			name: a.name,
			originalName: a.name,
			displayName: a.name,
			iconUrl: typeof a.icon === 'string' ? a.icon : undefined,
			adapter: a,
			installed: true
		}));

		return applyWalletConfig([...list, ...extraWalletEntries], config);
	};

	const detectWalletAdapters = (): SuiWalletAdapter[] => {
		if (!isBrowser) return [];
		const walletRadar = new WalletRadar();
		walletRadar.activate();

		// Read the current snapshot of detected adapters (extensions/injected)
		const radarAdapters = walletRadar.getDetectedWalletAdapters();

		// Also include wallets registered via Wallet Standard registry (e.g., Enoki providers)
		let registryWallets: readonly Wallet[] = [];
		try {
			const registry = getWallets?.();
			if (registry && typeof registry.get === 'function') {
				registryWallets = registry.get() || [];
			}
		} catch {}

		walletRadar.deactivate();

		// Merge and de-duplicate by name
		return uniqueAdaptersByName([...(radarAdapters || []), ...Array.from(registryWallets || [])]);
	};

	const ensureCallable = (): void => {
		if (status !== ConnectionStatus.CONNECTED) {
			throw Error('wallet is not connected');
		}
	};

	export const walletAdapters: SuiWalletAdapter[] = [];
	export const availableWallets: WalletWithStatus[] = [];

	let _walletsRegistryOff: (() => void) | undefined = undefined;
	let _discoveryInitialized = false;
	const _discoverySubscribers = new Set<
		(adapters: SuiWalletAdapter[], wallets: WalletWithStatus[]) => void
	>();
	let _lastDiscoveryLogKey = '';
	let _lastAvailableLogKey = '';
	let _discoveryAttempt = 0;
	const uniqueAdaptersByName = (adapters: (Wallet | SuiWalletAdapter)[]): SuiWalletAdapter[] => {
		const map = new Map<string, SuiWalletAdapter>();
		for (const a of adapters || []) {
			if (!a || !a.name) continue;
			if (!map.has(a.name)) map.set(a.name, a as SuiWalletAdapter);
		}
		return Array.from(map.values());
	};

	export const setModuleWalletDiscovery = (
		adapters: SuiWalletAdapter[],
		wallets: WalletWithStatus[]
	): void => {
		const nextAdapters = Array.isArray(adapters) ? adapters : [];
		const nextWallets = Array.isArray(wallets) ? wallets : [];
		// In-place mutation to preserve module live bindings and avoid reassignment
		walletAdapters.length = 0;
		walletAdapters.push(...nextAdapters);
		availableWallets.length = 0;
		availableWallets.push(...nextWallets);
		try {
			for (const cb of _discoverySubscribers) {
				try {
					cb(walletAdapters, availableWallets);
				} catch {}
			}
		} catch {}
	};

	export const subscribeWalletDiscovery = (
		callback: (adapters: SuiWalletAdapter[], wallets: WalletWithStatus[]) => void
	): (() => void) => {
		if (typeof callback !== 'function') return () => {};
		_discoverySubscribers.add(callback);
		// Emit current snapshot immediately
		try {
			callback(walletAdapters, availableWallets);
		} catch {}
		return () => {
			_discoverySubscribers.delete(callback);
		};
	};

	const refreshDiscoverySnapshot = (attemptLabel: number | string): void => {
		const snapshot = uniqueAdaptersByName(detectWalletAdapters());
		try {
			const adapterNames = snapshot
				.map((a) => a?.name)
				.filter(Boolean)
				.sort();
			const key = adapterNames.join('|');
			if (key !== _lastDiscoveryLogKey) {
				_lastDiscoveryLogKey = key;
				const ts = new Date().toISOString();
				// console.log(
				// 	`[SuiModule] [${ts}] [attempt:${attemptLabel ?? '-'}] Detected adapters:`,
				// 	adapterNames
				// );
			}
		} catch {}
		const wallets = getAvailableWallets(AllDefaultWallets, snapshot, _walletConfig);
		try {
			const walletNames = wallets
				.map((w) => w?.name)
				.filter(Boolean)
				.sort();
			const wkey = walletNames.join('|');
			if (wkey !== _lastAvailableLogKey) {
				_lastAvailableLogKey = wkey;
				const ts = new Date().toISOString();
				// console.log(
				// 	`[SuiModule] [${ts}] [attempt:${attemptLabel ?? '-'}] Available wallets:`,
				// 	walletNames
				// );
			}
		} catch {}
		setModuleWalletDiscovery(snapshot, wallets);
	};

	// Lightweight API probe to validate Enoki API key without completing OAuth flow
	const probeEnokiApiKey = async (apiKey: string, network: string): Promise<void> => {
		if (!isBrowser) return;
		if (!apiKey) return;
		try {
			// Use GET /v1/app to validate API key without required body params
			const res = await fetch('https://api.enoki.mystenlabs.com/v1/app', {
				method: 'GET',
				headers: { Authorization: `Bearer ${apiKey}` }
			});
			if (res.status === 401 || res.status === 403) {
				_enokiKeyValid = false;
				try {
					console.error('[SuiModule] Enoki API key invalid or unauthorized');
				} catch {}
				return;
			}
			if (!res.ok) {
				try {
					console.warn('[SuiModule] Enoki /v1/app returned non-OK status:', res.status);
				} catch {}
				return;
			}
			try {
				_enokiKeyValid = true;
			} catch {}
		} catch (err) {
			try {
				console.warn('[SuiModule] Enoki API key probe failed:', err);
			} catch {}
		}
	};

	export const initWalletDiscovery = (): void => {
		if (!isBrowser) return;
		if (_discoveryInitialized) return;
		_discoveryInitialized = true;
		// Ensure Enoki wallets are registered before discovery so they appear in the modal
		// Trigger client creation for mainnet, which invokes registerEnokiWallets with providers
		try {
			if (_zkLoginGoogle) {
				const cfg = getConfiguredNetwork() || 'mainnet';
				getSuiClient(`sui:${cfg}`);
			}
		} catch {}

		// Probe Enoki API key once to provide early feedback in console
		try {
			if (_zkLoginGoogle && !_enokiProbeDone) {
				_enokiProbeDone = true;
				const apiKey = _zkLoginGoogle?.apiKey;
				// Derive preferred network: use active chain if available
				const configured = getConfiguredNetwork();
				const chainId =
					account.value?.chains?.[0] || (configured ? `sui:${configured}` : getDefaultChain());
				const network = configured || chainId?.split?.(':')?.[1] || 'mainnet';
				// Skip probing if config is suspicious
				if (!isSuspiciousEnokiConfig(apiKey, _zkLoginGoogle?.googleClientId)) {
					setTimeout(() => {
						probeEnokiApiKey(apiKey, network);
					}, 0);
				}
			}
		} catch {}
		// Remove previous listener if any
		try {
			if (typeof _walletsRegistryOff === 'function') {
				_walletsRegistryOff();
				_walletsRegistryOff = undefined;
			}
		} catch {}

		// Run multiple times shortly after mount to catch late-registered wallets
		const delays = [0, 50, 200, 600, 1200];
		for (const d of delays) {
			setTimeout(() => {
				_discoveryAttempt += 1;
				refreshDiscoverySnapshot(_discoveryAttempt);
			}, d);
		}

		// Also listen to Wallet Standard registry events if available
		try {
			const registry = getWallets?.();
			const registryOn =
				registry && 'on' in registry
					? (registry.on as (event: string, callback: (wallet: Wallet) => void) => () => void)
					: undefined;
			if (registryOn && typeof registryOn === 'function') {
				_walletsRegistryOff = registryOn('register', (wallet: Wallet) => {
					try {
						_discoveryAttempt += 1;
						const ts = new Date().toISOString();
						// console.log(
						// 	`[SuiModule] [${ts}] [attempt:${_discoveryAttempt}] Registry register:`,
						// 	wallet?.name || 'unknown'
						// );
					} catch {}
					refreshDiscoverySnapshot(_discoveryAttempt);
				});
			}
		} catch {}
	};
</script>

<script lang="ts">
	const {
		onConnect = undefined,
		autoConnect = false,
		autoSuiNS = true,
		autoSuiBalance = true,
		walletConfig = {},
		zkLoginGoogle = null,
		children = undefined
	} = $props();
	if (onConnect) {
		_onConnect = onConnect;
	}
	_autoConnect = autoConnect;
	_autoFetchSuiNS = !!autoSuiNS;
	_autoFetchBalance = !!autoSuiBalance;
	_walletConfig = walletConfig || {};
	_zkLoginGoogle = zkLoginGoogle || null;

	// Mirror discovery to instance state for reactive UI updates
	let _discoveredAdapters = $state<SuiWalletAdapter[]>([]);
	let _availableWalletsState = $state<WalletWithStatus[]>([]);
	let _availableWalletsVisible = $state<WalletWithStatus[]>([]);

	$effect(() => {
		// Start discovery after mount; subscribe for updates
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
		// Start discovery after mount; idempotent
		initWalletDiscovery();
	});

	$effect(() => {
		// Update internal config when props change
		_walletConfig = walletConfig || {};
		_zkLoginGoogle = zkLoginGoogle || null;
		// Reset probe state to allow re-validation on prop change
		_enokiProbeDone = false;
		_enokiKeyValid = undefined;
	});

	// Filter visible wallets based on zkLoginGoogle option and key validity
	$effect(() => {
		const wallets = Array.isArray(_availableWalletsState) ? _availableWalletsState : [];
		const canShowGoogle =
			!!(_zkLoginGoogle && _zkLoginGoogle.apiKey && _zkLoginGoogle.googleClientId) &&
			_enokiKeyValid !== false;
		_availableWalletsVisible = canShowGoogle
			? wallets
			: wallets.filter((w) => w?.name !== 'Sign in with Google');
	});

	$effect(() => {
		if (!_autoConnect) return;
		if (account.value) return;
		if (!Array.isArray(_availableWalletsState) || _availableWalletsState.length === 0) return;
		if (status === ConnectionStatus.CONNECTING) return;
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

{@render children()}
