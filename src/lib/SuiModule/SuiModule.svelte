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
	let _accountsSnapshot = $state([]);
	let connectModal = $state();
	export let getConnectModal = () => connectModal;
	let _onConnect = $state(() => {});
	let _autoConnect = $state(false);

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
	// options.force = true to bypass duplicate-key guard
	export const refreshSuiBalance = async (targetAddress, options = {}) => {
		const owner = targetAddress ?? account.value?.address;
		if (!owner) return null;
		const chainId = account.value?.chains?.[0] || 'sui:mainnet';
		const key = `${owner}|${chainId}`;
		if (!options.force && key === _lastBalanceKey) {
			return _suiBalanceByAddress[owner] ?? null;
		}
		_lastBalanceKey = key;
		_suiBalanceLoading = true;
		try {
			const client = getSuiClient(chainId);
			const res = await client.getBalance({ owner, coinType: '0x2::sui::SUI' });
			const total = res?.totalBalance ?? '0';
			_suiBalanceByAddress = { ..._suiBalanceByAddress, [owner]: total };
			return total;
		} catch (_) {
			return null;
		} finally {
			_suiBalanceLoading = false;
		}
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

	export const connectWithModal = async () => {
		if (account.value) return;
		let selectedWallet = await connectModal?.openAndWaitForResponse();
		if (selectedWallet) {
			await connect(selectedWallet);
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

	const getAvailableWallets = (defaultWallets) => {
		const walletAdapters = detectWalletAdapters();

		const availableWallets = defaultWallets
			.map((item) => {
				const foundAdapter = walletAdapters.find((walletAdapter) => {
					// Check exact name match or common aliases
					return item.name.includes(walletAdapter.name);
				});

				return {
					...item,
					adapter: foundAdapter ? foundAdapter : undefined,
					installed: foundAdapter ? true : false
				};
			})
			.filter((item) => item.installed == true);

		return availableWallets;
	};

	const detectWalletAdapters = () => {
		if (!isBrowser) return [];
		const walletRadar = new WalletRadar();
		walletRadar.activate();

		// Give a small delay for wallets to register
		const walletAdapters = walletRadar.getDetectedWalletAdapters();

		walletRadar.deactivate();

		return walletAdapters;
	};

	const ensureCallable = () => {
		if (status !== ConnectionStatus.CONNECTED) {
			throw Error('wallet is not connected');
		}
	};

	export const walletAdapters = isBrowser ? detectWalletAdapters() : [];
	export const availableWallets = isBrowser ? getAvailableWallets(AllDefaultWallets) : [];
</script>

<script>
	const {
		onConnect,
		autoConnect = false,
		autoSuiNS = true,
		autoSuiBalance = true,
		children
	} = $props();
	if (onConnect) {
		_onConnect = onConnect;
	}
	_autoConnect = autoConnect;
	_autoFetchSuiNS = !!autoSuiNS;
	_autoFetchBalance = !!autoSuiBalance;

	$effect(() => {
		if (_autoConnect) {
			autoConnectWallet();
		}
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

<ConnectModal bind:this={connectModal} {availableWallets} />

{@render children()}
