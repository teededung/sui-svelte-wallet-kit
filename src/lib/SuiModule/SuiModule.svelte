<script module>
	import {
		AllDefaultWallets,
		ConnectionStatus,
		WalletRadar,
		resolveAddressToSuiNSNames
	} from '@suiet/wallet-sdk';
	import ConnectModal from '../ConnectModal/ConnectModal.svelte';
	import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
	import { getWallets } from '@wallet-standard/core';

	let walletAdapter = $state();
	let status = $state(ConnectionStatus.DISCONNECTED);
	let _account = $state();
	let _wallet = $state();
	let _suiNames = $state([]);
	let _suiNamesLoading = $state(false);
	let _suiNamesByAddress = $state({});
	let _suiBalanceByAddress = $state({});
	let _suiBalanceLoading = $state(false);
	let _lastRefreshKey = $state('');
	let _lastAccountsKey = $state('');
	let _suiNSInternalUpdate = $state(false);
	let _suiNSPrefetched = $state(false);
	let _walletEventsOff = $state();
	let _autoFetchSuiNS = $state(true);
	let _autoFetchBalance = $state(true);
	let _lastBalanceKey = $state('');
	let _balanceFetchedAtByKey = $state({}); // key: owner|chain -> timestamp
	let _balanceCacheTTLms = $state(2000); // default cache TTL for balance
	const _balanceInflightByKey = {}; // key -> Promise
	let _accountsSnapshot = $state([]);
	let connectModal = $state();
	export let getConnectModal = () => connectModal;
	let _onConnect = $state(() => {});
	let _autoConnect = $state(false);
	let _lastWalletSelection = $state();
	let _walletConfig = $state({});

	const STORAGE_KEY = 'sui-module-connection';

	// Environment guards
	const isBrowser = typeof window !== 'undefined';
	const hasLocalStorage = () => isBrowser && !!window.localStorage;

	// Cache SuiClient instances by network string
	const _clientCache = {};
	const getSuiClient = (chainIdLike) => {
		const network = chainIdLike?.split?.(':')?.[1] || 'mainnet';
		if (!_clientCache[network]) {
			_clientCache[network] = new SuiClient({ url: getFullnodeUrl(network) });
		}
		return _clientCache[network];
	};

	const saveConnectionData = (walletName) => {
		if (!_autoConnect || !hasLocalStorage()) return;
		const current = getConnectionData() || {};
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...current, walletName, autoConnect: true })
		);
	};

	const getConnectionData = () => {
		if (!hasLocalStorage()) return null;
		const data = window.localStorage.getItem(STORAGE_KEY);
		return data ? JSON.parse(data) : null;
	};

	const updateConnectionData = (partial) => {
		if (!hasLocalStorage()) return;
		const current = getConnectionData() || {};
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
	};

	const clearConnectionData = () => {
		if (!hasLocalStorage()) return;
		window.localStorage.removeItem(STORAGE_KEY);
	};

	const isSuiAccount = (acc) =>
		Array.isArray(acc?.chains) && acc.chains.some((c) => c?.startsWith?.('sui:'));

	const setAccountChainsInPlace = (chains) => {
		if (!account.value) return;
		try {
			const desc = Object.getOwnPropertyDescriptor(account.value, 'chains');
			if (desc && desc.writable) {
				account.value.chains = chains || account.value.chains;
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
				address: account.value.address,
				...account.value,
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

			const eventsFeature = active.features?.['standard:events'];
			if (!eventsFeature || typeof eventsFeature.on !== 'function') return;

			_walletEventsOff = eventsFeature.on('change', async (payload) => {
				const { accounts, chains } = payload || {};
				// Some wallets emit `chains` directly on network change
				if (Array.isArray(chains) && chains.length > 0) {
					setAccountChainsInPlace(chains);
					updateConnectionData({ selectedChain: chains[0] });
					return;
				}

				// Accounts change
				if (!Array.isArray(accounts) || accounts.length === 0) return;
				const suiAccounts = accounts.filter(isSuiAccount);
				if (suiAccounts.length === 0) return;
				_accountsSnapshot = suiAccounts;
				const lower = (s) => (typeof s === 'string' ? s.toLowerCase() : s);
				const currentAddr = lower(activeAddr);
				const nextAccount =
					suiAccounts.find((a) => lower(a.address) === currentAddr) || suiAccounts[0];
				if (!nextAccount) return;

				account.setAccount(nextAccount);
				const effChains = Array.isArray(nextAccount.chains)
					? nextAccount.chains
					: account.value?.chains;
				if (Array.isArray(effChains) && effChains.length > 0) {
					setAccountChainsInPlace(effChains);
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
		_suiNamesLoading = true;
		_suiNames = [];

		if (!account.value?.address) {
			_suiNamesLoading = false;
			return;
		}

		try {
			const chainId = account.value?.chains?.[0] || 'sui:mainnet';
			const client = getSuiClient(chainId);
			const activeAddr = account.value.address;
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
	export const refreshSuiBalance = async (targetAddress, options = {}) => {
		const owner = targetAddress ?? account.value?.address;
		if (!owner) return null;
		const chainId = account.value?.chains?.[0] || 'sui:mainnet';
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

	export const setSuiBalanceCacheTTL = (ms) => {
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
			const activeChain = account.value?.chains?.[0] || 'sui:mainnet';
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

			const mapping = {};
			for (const r of results) {
				if (r.status === 'fulfilled') {
					mapping[r.value.address] = r.value.names;
				} else if (r.status === 'rejected' && r.reason?.address) {
					mapping[r.reason.address] = [];
				}
			}
			_suiNamesByAddress = { ..._suiNamesByAddress, ...mapping };
		} catch (err) {
			// ignore silently
		} finally {
			_suiNamesLoading = false;
		}
	};

	const setAccountLabelInPlace = (name) => {
		if (!account.value) return;
		try {
			const desc = Object.getOwnPropertyDescriptor(account.value, 'label');
			if (desc && desc.writable) {
				account.value.label = name || undefined;
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
				address: account.value.address,
				chains: account.value.chains,
				...account.value,
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

	export const setAccountLabel = (name) => {
		setAccountLabelInPlace(name);
	};

	export const account = {
		get value() {
			return _account;
		},
		setAccount(account) {
			_account = account;
		},
		removeAccount() {
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

	// Expose all accounts provided by the connected wallet, if supported
	export const accounts = {
		get value() {
			return Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];
		}
	};

	export const accountsCount = {
		get value() {
			return Array.isArray(_accountsSnapshot) ? _accountsSnapshot.length : 0;
		}
	};

	export const activeAccountIndex = {
		get value() {
			if (!account.value) return -1;
			const list = Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];
			return list.findIndex((acc) => acc.address === account.value.address);
		}
	};

	export const switchAccount = (selector) => {
		ensureCallable();
		const list = Array.isArray(_accountsSnapshot) ? _accountsSnapshot : [];

		let nextAccount = undefined;
		if (typeof selector === 'number') {
			nextAccount = list[selector];
		} else if (typeof selector === 'string') {
			const target = selector.toLowerCase();
			nextAccount = list.find((acc) => acc.address.toLowerCase() === target);
		} else if (selector && typeof selector === 'object') {
			const target = selector.address?.toLowerCase();
			nextAccount = list.find((acc) => acc.address.toLowerCase() === target) || selector;
		}

		if (!nextAccount) return false;
		account.setAccount(nextAccount);
		updateConnectionData({
			selectedAccountAddress: nextAccount.address,
			selectedChain: Array.isArray(nextAccount?.chains) ? nextAccount.chains[0] : undefined
		});
		return true;
	};

	// Expose connected wallet info
	export const wallet = {
		get value() {
			return _wallet;
		}
	};

	export const walletName = {
		get value() {
			return _wallet?.name ?? '';
		}
	};

	export const walletIconUrl = {
		get value() {
			return _wallet?.iconUrl ?? '';
		}
	};

	export const lastWalletSelection = {
		get value() {
			return _lastWalletSelection;
		},
		clear() {
			_lastWalletSelection = undefined;
		}
	};

	export const connectWithModal = async (onSelection) => {
		if (account.value) return { connected: true, alreadyConnected: true };
		// Reuse the internal selection loop so behavior is consistent with switchWallet
		while (true) {
			const result = await connectModal?.openAndWaitForResponse();
			if (!result)
				return { wallet: undefined, installed: false, connected: false, cancelled: true };
			const selectedWallet = result?.wallet ?? result;
			const installed =
				typeof result === 'object' ? !!result?.installed : !!selectedWallet?.installed;
			_lastWalletSelection = { wallet: selectedWallet, installed: !!installed };
			try {
				onSelection?.({ wallet: selectedWallet, installed, connected: false });
			} catch {}
			if (!installed) continue;
			await connect(selectedWallet);
			return { wallet: selectedWallet, installed: true, connected: true };
		}
	};

	export const connect = async (wallet) => {
		walletAdapter = wallet?.adapter;
		if (walletAdapter) {
			status = ConnectionStatus.CONNECTING;
			try {
				await walletAdapter.connect();
				const allAccounts = Array.isArray(walletAdapter.accounts)
					? walletAdapter.accounts.filter(isSuiAccount)
					: [];
				_accountsSnapshot = allAccounts;
				const connectionData = getConnectionData();
				const preferredAddress = connectionData?.selectedAccountAddress?.toLowerCase();
				let selectedAccount = allAccounts[0];
				if (preferredAddress) {
					const found = allAccounts.find(
						(acc) => acc?.address?.toLowerCase && acc.address.toLowerCase() === preferredAddress
					);
					if (found) selectedAccount = found;
				}

				account.setAccount(selectedAccount);
				_wallet = wallet;
				status = ConnectionStatus.CONNECTED;
				saveConnectionData(wallet.name);
				updateConnectionData({
					selectedAccountAddress: selectedAccount?.address,
					selectedChain: Array.isArray(selectedAccount?.chains)
						? selectedAccount.chains[0]
						: undefined
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

	export const disconnect = () => {
		walletAdapter?.disconnect();
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
	export const switchWallet = async (options = {}) => {
		try {
			const modal = typeof getConnectModal === 'function' ? getConnectModal() : undefined;
			if (!modal) return { connected: false, cancelled: true };
			while (true) {
				const result = await modal.openAndWaitForResponse();
				if (!result) {
					try {
						options?.onCancel?.();
					} catch {}
					return { connected: false, cancelled: true };
				}
				const selectedWallet = result?.wallet ?? result;
				const installed =
					typeof result === 'object' ? !!result?.installed : !!selectedWallet?.installed;
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

	export const signAndExecuteTransaction = async (transaction) => {
		ensureCallable();
		return await walletAdapter.signAndExecuteTransaction({
			account: account.value,
			chain: account.value.chains[0],
			transaction
		});
	};

	export const signMessage = async (message) => {
		ensureCallable();

		// Check if wallet supports message signing
		if (!walletAdapter || !walletAdapter.signPersonalMessage) {
			throw new Error(
				'This wallet does not support message signing. Please try a different wallet or use signAndExecuteTransaction instead.'
			);
		}

		// Convert string to Uint8Array if needed
		const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

		const result = await walletAdapter.signPersonalMessage({
			account: account.value,
			message: messageBytes
		});

		return {
			signature: result.signature,
			messageBytes: Array.from(messageBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		};
	};

	export const canSignMessage = () => {
		if (status !== ConnectionStatus.CONNECTED || !walletAdapter) {
			return false;
		}

		return (
			typeof walletAdapter.signMessage === 'function' ||
			typeof walletAdapter.signPersonalMessage === 'function'
		);
	};

	const normalizeWalletName = (name) =>
		(name || '')
			.toLowerCase()
			.replace(/wallet$/g, '')
			.replace(/[^a-z0-9]/g, '');

	const applyWalletConfig = (wallets, config) => {
		const { customNames = {}, ordering = [] } = config;

		// Debug: log wallet names để dễ config (uncomment when needed)
		// if (isBrowser && wallets.length > 0) {
		// 	console.log('🔍 Available wallet names for config:', wallets.map((w) => w.name));
		// }

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

	const getAvailableWallets = (defaultWallets, detectedAdapters, config = {}) => {
		const adapters = Array.isArray(detectedAdapters) ? detectedAdapters : detectWalletAdapters();

		// Map default wallets to detected adapters by fuzzy-normalized name matching
		const list = defaultWallets.map((item) => {
			const normalizedItem = normalizeWalletName(item.name);
			const foundAdapter = adapters.find((walletAdapter) => {
				const normalizedAdapter = normalizeWalletName(walletAdapter.name);
				return (
					normalizedItem.includes(normalizedAdapter) || normalizedAdapter.includes(normalizedItem)
				);
			});

			return {
				...item,
				adapter: foundAdapter ? foundAdapter : undefined,
				installed: !!foundAdapter
			};
		});

		// Include extra detected adapters that are NOT present in the default wallet list
		// This covers wallets like Coin98 that support Sui but aren't listed in the SDK defaults
		const defaultNormalizedNames = defaultWallets.map((w) => normalizeWalletName(w.name));
		const extraAdapters = adapters.filter((a) => {
			const na = normalizeWalletName(a.name);
			return !defaultNormalizedNames.some((dn) => dn.includes(na) || na.includes(dn));
		});

		const extraWalletEntries = extraAdapters.map((a) => ({
			name: a.name,
			originalName: a.name,
			displayName: a.name,
			iconUrl: a.icon,
			adapter: a,
			installed: true
		}));

		return applyWalletConfig([...list, ...extraWalletEntries], config);
	};

	const detectWalletAdapters = () => {
		if (!isBrowser) return [];
		const walletRadar = new WalletRadar();
		walletRadar.activate();

		// Read the current snapshot of detected adapters
		const walletAdapters = walletRadar.getDetectedWalletAdapters();

		walletRadar.deactivate();

		return walletAdapters;
	};

	const ensureCallable = () => {
		if (status !== ConnectionStatus.CONNECTED) {
			throw Error('wallet is not connected');
		}
	};

	export const walletAdapters = [];
	export const availableWallets = [];

	let _walletsRegistryOff = undefined;
	let _discoveryInitialized = false;
	const _discoverySubscribers = new Set();
	let _lastDiscoveryLogKey = '';
	let _lastAvailableLogKey = '';
	let _discoveryAttempt = 0;
	const uniqueAdaptersByName = (adapters) => {
		const map = new Map();
		for (const a of adapters || []) {
			if (!a || !a.name) continue;
			if (!map.has(a.name)) map.set(a.name, a);
		}
		return Array.from(map.values());
	};

	export const setModuleWalletDiscovery = (adapters, wallets) => {
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

	export const subscribeWalletDiscovery = (callback) => {
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

	const refreshDiscoverySnapshot = (attemptLabel) => {
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

	export const initWalletDiscovery = () => {
		if (!isBrowser) return;
		if (_discoveryInitialized) return;
		_discoveryInitialized = true;
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
			if (registry && typeof registry.on === 'function') {
				_walletsRegistryOff = registry.on('register', (wallet) => {
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

<script>
	const {
		onConnect,
		autoConnect = false,
		autoSuiNS = true,
		autoSuiBalance = true,
		walletConfig = {},
		children
	} = $props();
	if (onConnect) {
		_onConnect = onConnect;
	}
	_autoConnect = autoConnect;
	_autoFetchSuiNS = !!autoSuiNS;
	_autoFetchBalance = !!autoSuiBalance;
	_walletConfig = walletConfig || {};

	// Mirror discovery to instance state for reactive UI updates
	let _discoveredAdapters = $state([]);
	let _availableWalletsState = $state([]);

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
		// Update internal walletConfig when prop changes
		_walletConfig = walletConfig || {};
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

<ConnectModal bind:this={connectModal} availableWallets={_availableWalletsState} />

{@render children()}
