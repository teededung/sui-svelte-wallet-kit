import { ConnectionStatus } from '@suiet/wallet-sdk';
import { getWallets, type Wallet } from '@wallet-standard/core';
import type {
	SuiWalletAdapter,
	SuiAccount,
	WalletWithStatus,
	WalletChangePayload,
	ModalResponse,
	SwitchWalletOptions
} from '../types.js';
import {
	getConnectionData,
	updateConnectionData,
	saveConnectionData,
	getDefaultChain,
	isBrowser
} from './core.js';

// Type helpers
export const isSuiAccount = (acc: unknown): acc is SuiAccount =>
	typeof acc === 'object' &&
	acc !== null &&
	'chains' in acc &&
	Array.isArray((acc as SuiAccount).chains) &&
	(acc as SuiAccount).chains.some((c) => typeof c === 'string' && c.startsWith('sui:'));

// Account management functions (take state as parameters)
export type AccountState = {
	value: SuiAccount | undefined;
	setAccount: (account: SuiAccount | undefined) => void;
	removeAccount: () => void;
};

export const setAccountChainsInPlace = (
	account: AccountState,
	chains: readonly `${string}:${string}`[],
	zkLoginGoogle: any
): void => {
	if (!account.value) return;
	try {
		const desc = Object.getOwnPropertyDescriptor(account.value, 'chains');
		if (desc && desc.writable) {
			(account.value as SuiAccount & { chains: readonly `${string}:${string}`[] }).chains =
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

export type SessionState = {
	walletAdapter: {
		get: () => SuiWalletAdapter | undefined;
		set: (v: SuiWalletAdapter | undefined) => void;
	};
	status: { get: () => ConnectionStatus; set: (v: ConnectionStatus) => void };
	account: AccountState;
	wallet: {
		get: () => WalletWithStatus | undefined;
		set: (v: WalletWithStatus | undefined) => void;
	};
	accountsSnapshot: { get: () => SuiAccount[]; set: (v: SuiAccount[]) => void };
	walletEventsOff: {
		get: () => (() => void) | undefined;
		set: (v: (() => void) | undefined) => void;
	};
	lastWalletSelection: {
		get: () => { wallet: Wallet; installed: boolean } | undefined;
		set: (v: { wallet: Wallet; installed: boolean } | undefined) => void;
	};
};

export const attachWalletNetworkListener = (state: SessionState, zkLoginGoogle: any): void => {
	if (!isBrowser) return;
	try {
		if (typeof state.walletEventsOff.get() === 'function') {
			state.walletEventsOff.get()!();
			state.walletEventsOff.set(undefined);
		}

		const wallets = getWallets().get();
		const activeAddr = state.account.value?.address;
		if (!activeAddr) return;
		const byName = wallets.find(
			(w) =>
				w.name === state.wallet.get()?.name && w.accounts?.some?.((a) => a.address === activeAddr)
		);
		const byAddr = wallets.find((w) => w.accounts?.some?.((a) => a.address === activeAddr));
		const active = byName || byAddr;
		if (!active) return;

		const eventsFeature = active.features?.['standard:events'] as {
			on?: (event: string, callback: (payload: WalletChangePayload) => void) => () => void;
		};
		if (!eventsFeature || typeof eventsFeature.on !== 'function') return;

		state.walletEventsOff.set(
			eventsFeature.on('change', async (payload: WalletChangePayload) => {
				const { accounts, chains } = payload || {};
				if (Array.isArray(chains) && chains.length > 0) {
					setAccountChainsInPlace(
						state.account,
						chains as readonly `${string}:${string}`[],
						zkLoginGoogle
					);
					updateConnectionData({ selectedChain: chains[0] });
					return;
				}

				if (!Array.isArray(accounts) || accounts.length === 0) return;
				const suiAccounts = accounts.filter(isSuiAccount);
				if (suiAccounts.length === 0) return;
				state.accountsSnapshot.set(suiAccounts);
				const lower = (s: string) => s.toLowerCase();
				const currentAddr = lower(activeAddr);
				const nextAccount =
					suiAccounts.find((a) => lower(a.address) === currentAddr) || suiAccounts[0];
				if (!nextAccount) return;

				state.account.setAccount(nextAccount);
				const effChains = Array.isArray(nextAccount.chains)
					? nextAccount.chains
					: state.account.value?.chains;
				if (Array.isArray(effChains) && effChains.length > 0) {
					setAccountChainsInPlace(
						state.account,
						effChains as readonly `${string}:${string}`[],
						zkLoginGoogle
					);
				}
				updateConnectionData({
					selectedAccountAddress: nextAccount.address,
					selectedChain: Array.isArray(nextAccount?.chains) ? nextAccount.chains[0] : undefined
				});
			})
		);
	} catch (_) {
		// ignore
	}
};

export const connect = async (
	wallet: WalletWithStatus,
	state: SessionState,
	zkLoginGoogle: any,
	onConnect: () => void,
	passkeyAdapter: any
): Promise<void> => {
	const adapter = (wallet as WalletWithStatus)?.adapter;
	state.walletAdapter.set(adapter);
	if (adapter) {
		state.status.set(ConnectionStatus.CONNECTING);
		try {
			if (typeof adapter.connect === 'function') {
				await adapter.connect();
			} else if (
				adapter?.features?.['standard:connect'] &&
				typeof adapter.features['standard:connect'].connect === 'function'
			) {
				await adapter.features['standard:connect'].connect();
			} else {
				throw new Error('No compatible connect method on wallet');
			}

			const rawAccounts = Array.isArray(adapter.accounts) ? adapter.accounts : [];
			const allAccounts = rawAccounts.filter(isSuiAccount);
			state.accountsSnapshot.set(allAccounts);
			const connectionData = getConnectionData();
			const preferredAddress = connectionData?.selectedAccountAddress?.toLowerCase();
			let selectedAccount = allAccounts[0];
			if (preferredAddress) {
				const found = allAccounts.find((acc) => acc.address.toLowerCase() === preferredAddress);
				if (found) selectedAccount = found;
			}

			state.account.setAccount(selectedAccount);
			if (!Array.isArray(selectedAccount?.chains) || selectedAccount.chains.length === 0) {
				const defaultChain = getDefaultChain(zkLoginGoogle) as `${string}:${string}`;
				setAccountChainsInPlace(state.account, [defaultChain], zkLoginGoogle);
			}
			state.wallet.set(wallet);
			state.status.set(ConnectionStatus.CONNECTED);
			saveConnectionData(wallet.name, true);
			updateConnectionData({
				selectedAccountAddress: selectedAccount?.address,
				selectedChain:
					Array.isArray(selectedAccount?.chains) && selectedAccount.chains[0]
						? selectedAccount.chains[0]
						: getDefaultChain(zkLoginGoogle)
			});
			onConnect();
			attachWalletNetworkListener(state, zkLoginGoogle);
		} catch {
			state.status.set(ConnectionStatus.DISCONNECTED);
		}
	}
};

export const disconnect = (state: SessionState): void => {
	const adapter = state.walletAdapter.get();
	try {
		const std = adapter?.features?.['standard:disconnect'];
		if (std && typeof std.disconnect === 'function') {
			try {
				std.disconnect();
			} catch {}
		} else if (adapter && typeof adapter.disconnect === 'function') {
			try {
				adapter.disconnect();
			} catch {}
		}
	} catch {}
	state.account.removeAccount();
	state.status.set(ConnectionStatus.DISCONNECTED);
	state.walletAdapter.set(undefined);
	state.wallet.set(undefined);
	if (typeof state.walletEventsOff.get() === 'function') {
		state.walletEventsOff.get()!();
		state.walletEventsOff.set(undefined);
	}
};

export const connectWithModal = async (
	connectModal: any,
	onSelection:
		| ((payload: { wallet: Wallet; installed: boolean; connected: boolean }) => void)
		| undefined,
	state: SessionState,
	zkLoginGoogle: any,
	onConnect: () => void,
	passkeyAdapter: any
) => {
	if (state.account.value) return { connected: true, alreadyConnected: true };
	while (true) {
		const result: ModalResponse | undefined = await connectModal?.openAndWaitForResponse();
		if (!result) return { wallet: undefined, installed: false, connected: false, cancelled: true };
		const selectedWallet = result?.wallet ?? (result as unknown as Wallet);
		const installed =
			typeof result === 'object'
				? !!result?.installed
				: !!(selectedWallet as WalletWithStatus)?.installed;
		state.lastWalletSelection.set({ wallet: selectedWallet, installed: !!installed });
		try {
			onSelection?.({ wallet: selectedWallet, installed, connected: false });
		} catch {}
		if (!installed) continue;
		if (!result?.started) {
			await connect(
				selectedWallet as WalletWithStatus,
				state,
				zkLoginGoogle,
				onConnect,
				passkeyAdapter
			);
		}
		return { wallet: selectedWallet, installed: true, connected: true };
	}
};

export const switchWallet = async (
	getConnectModal: () => any,
	options: SwitchWalletOptions,
	state: SessionState,
	zkLoginGoogle: any,
	onConnect: () => void,
	passkeyAdapter: any
) => {
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
			state.lastWalletSelection.set({ wallet: selectedWallet, installed: !!installed });
			try {
				options?.onSelection?.({ wallet: selectedWallet, installed, connected: false });
			} catch {}
			if (!installed) {
				continue;
			}

			const proceed =
				typeof options?.shouldConnect === 'function'
					? !!options.shouldConnect({ selectedWallet, currentWallet: state.wallet.get() })
					: true;
			if (!proceed) {
				return { wallet: selectedWallet, installed: true, connected: false, skipped: true };
			}

			try {
				options?.onBeforeDisconnect?.(state.wallet.get(), selectedWallet);
			} catch {}
			if (result?.started) {
				try {
					options?.onConnected?.(selectedWallet);
				} catch {}
				return { wallet: selectedWallet, installed: true, connected: true };
			}
			try {
				disconnect(state);
			} catch {}
			await connect(
				selectedWallet as WalletWithStatus,
				state,
				zkLoginGoogle,
				onConnect,
				passkeyAdapter
			);
			try {
				options?.onConnected?.(state.wallet.get());
			} catch {}
			return { wallet: selectedWallet, installed: true, connected: true };
		}
	} catch (_) {
		return { connected: false, error: 'switch-failed' };
	}
};

export const autoConnectWallet = async (
	autoConnect: boolean,
	availableWallets: WalletWithStatus[],
	state: SessionState,
	zkLoginGoogle: any,
	onConnect: () => void,
	passkeyAdapter: any
): Promise<void> => {
	if (!autoConnect) return;

	const connectionData = getConnectionData();
	if (!connectionData?.autoConnect) return;

	const wallet = availableWallets.find((w) => w.name === connectionData.walletName);
	if (wallet && wallet.installed) {
		if (wallet.name === 'Passkey' && passkeyAdapter && 'silentConnect' in passkeyAdapter) {
			const success = await (passkeyAdapter as any).silentConnect();
			if (success) {
				state.wallet.set(wallet);
				state.walletAdapter.set(passkeyAdapter as any);
				state.accountsSnapshot.set([...passkeyAdapter.accounts]);
				state.account.setAccount(state.accountsSnapshot.get()[0]);
				state.status.set(ConnectionStatus.CONNECTED);
				return;
			}
			return;
		}
		await connect(wallet, state, zkLoginGoogle, onConnect, passkeyAdapter);
	}
};

export const switchAccount = (
	selector: number | string | SuiAccount,
	state: SessionState,
	zkLoginGoogle: any
): boolean => {
	if (state.status.get() !== ConnectionStatus.CONNECTED) {
		throw Error('wallet is not connected');
	}
	const list = Array.isArray(state.accountsSnapshot.get()) ? state.accountsSnapshot.get() : [];

	let nextAccount: SuiAccount | undefined = undefined;
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
	state.account.setAccount(nextAccount);
	if (!Array.isArray(nextAccount?.chains) || nextAccount.chains.length === 0) {
		setAccountChainsInPlace(
			state.account,
			[getDefaultChain(zkLoginGoogle) as `${string}:${string}`],
			zkLoginGoogle
		);
	}
	updateConnectionData({
		selectedAccountAddress: nextAccount.address,
		selectedChain:
			Array.isArray(nextAccount?.chains) && nextAccount.chains[0]
				? nextAccount.chains[0]
				: getDefaultChain(zkLoginGoogle)
	});

	return true;
};

export const activeAccountIndex = (state: SessionState) => {
	return {
		get value() {
			if (!state.account.value) return -1;
			const list = Array.isArray(state.accountsSnapshot.get()) ? state.accountsSnapshot.get() : [];
			return list.findIndex((acc) => acc.address === state.account.value!.address);
		}
	};
};

export const ensureCallable = (state: SessionState): void => {
	if (state.status.get() !== ConnectionStatus.CONNECTED) {
		throw Error('wallet is not connected');
	}
};
