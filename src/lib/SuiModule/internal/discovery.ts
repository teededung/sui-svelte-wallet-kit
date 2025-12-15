import { AllDefaultWallets, WalletRadar } from '@suiet/wallet-sdk';
import { getWallets, type Wallet } from '@wallet-standard/core';
import type { SuiWalletAdapter, WalletConfig, WalletWithStatus } from '../types.js';

// Browser guard
const isBrowser = typeof window !== 'undefined';

// Debug toggle
export const isDiscoveryDebugEnabled = (): boolean => {
	if (!isBrowser) return false;
	try {
		return window.localStorage.getItem('sui-wallet-kit-debug') === '1';
	} catch {
		return false;
	}
};

// Adapter detection
export const uniqueAdaptersByName = (
	adapters: (Wallet | SuiWalletAdapter)[]
): SuiWalletAdapter[] => {
	const map = new Map<string, SuiWalletAdapter>();
	for (const a of adapters || []) {
		if (!a || !a.name) continue;
		if (!map.has(a.name)) map.set(a.name, a as SuiWalletAdapter);
	}
	return Array.from(map.values());
};

export const detectWalletAdapters = (): SuiWalletAdapter[] => {
	if (!isBrowser) return [];
	const walletRadar = new WalletRadar();
	walletRadar.activate();

	const radarAdapters = walletRadar.getDetectedWalletAdapters();

	let registryWallets: readonly Wallet[] = [];
	try {
		const registry = getWallets?.();
		if (registry && typeof registry.get === 'function') {
			registryWallets = registry.get() || [];
		}
	} catch {}

	walletRadar.deactivate();

	return uniqueAdaptersByName([...(radarAdapters || []), ...Array.from(registryWallets || [])]);
};

// Wallet list construction
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

	const walletsWithCustomNames = wallets.map((wallet) => {
		const customName = customNames[wallet.name];
		return customName ? { ...wallet, displayName: customName, originalName: wallet.name } : wallet;
	});

	const result =
		ordering.length > 0
			? walletsWithCustomNames.sort((a, b) => {
					const aName = a.originalName || a.name;
					const bName = b.originalName || b.name;
					const aIndex = ordering.indexOf(aName);
					const bIndex = ordering.indexOf(bName);

					if (aIndex !== -1 && bIndex !== -1) {
						return aIndex - bIndex;
					}
					if (aIndex !== -1) return -1;
					if (bIndex !== -1) return 1;
					return aName.localeCompare(bName);
				})
			: walletsWithCustomNames;

	return result;
};

import { isSlushBrowser, isMobile } from './core.js';

export const getAvailableWallets = (
	defaultWallets: readonly { name: string; iconUrl?: string; [key: string]: any }[],
	detectedAdapters: SuiWalletAdapter[],
	config: WalletConfig = {}
): WalletWithStatus[] => {
	const adapters = Array.isArray(detectedAdapters) ? detectedAdapters : detectWalletAdapters();

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

	const result = applyWalletConfig([...list, ...extraWalletEntries], config);

	// Special handling for Slush In-App Browser:
	// Logic: If on Mobile AND Slush adapter is present, we are likely in Slush App.
	// Normal Mobile Browser (Safari/Chrome) does not allow extension injection.
	const slushInjected = result.some(
		(w) =>
			w.installed &&
			(w.name.toLowerCase().includes('slush') || w.adapter?.name.toLowerCase().includes('slush'))
	);

	if (isSlushBrowser() || (isMobile() && slushInjected)) {
		return result.filter((w) => {
			const name = (w.name || '').toLowerCase();
			const adapterName = (w.adapter?.name || '').toLowerCase();
			return name.includes('slush') || adapterName.includes('slush');
		});
	}

	return result;
};

// Snapshot + subscription
export type DiscoverySubscriber = (
	adapters: SuiWalletAdapter[],
	wallets: WalletWithStatus[]
) => void;

const _discoverySubscribers = new Set<DiscoverySubscriber>();

export const subscribeWalletDiscovery = (callback: DiscoverySubscriber): (() => void) => {
	if (typeof callback !== 'function') return () => {};
	_discoverySubscribers.add(callback);
	return () => {
		_discoverySubscribers.delete(callback);
	};
};

export const notifyDiscoverySubscribers = (
	adapters: SuiWalletAdapter[],
	wallets: WalletWithStatus[]
): void => {
	try {
		for (const cb of _discoverySubscribers) {
			try {
				cb(adapters, wallets);
			} catch {}
		}
	} catch {}
};

export const setModuleWalletDiscovery = (
	adapters: SuiWalletAdapter[],
	wallets: WalletWithStatus[],
	targetAdapters: SuiWalletAdapter[],
	targetWallets: WalletWithStatus[]
): void => {
	const nextAdapters = Array.isArray(adapters) ? adapters : [];
	const nextWallets = Array.isArray(wallets) ? wallets : [];
	targetAdapters.length = 0;
	targetAdapters.push(...nextAdapters);
	targetWallets.length = 0;
	targetWallets.push(...nextWallets);
	notifyDiscoverySubscribers(targetAdapters, targetWallets);
};

let _lastDiscoveryLogKey = '';
let _lastAvailableLogKey = '';
let _discoveryAttempt = 0;

export const refreshDiscoverySnapshot = (
	attemptLabel: number | string,
	walletConfig: WalletConfig
): { adapters: SuiWalletAdapter[]; wallets: WalletWithStatus[] } => {
	const snapshot = uniqueAdaptersByName(detectWalletAdapters());
	try {
		const adapterNames = snapshot
			.map((a) => a?.name)
			.filter(Boolean)
			.sort();
		const key = adapterNames.join('|');
		if (key !== _lastDiscoveryLogKey) {
			_lastDiscoveryLogKey = key;
			if (isDiscoveryDebugEnabled()) {
				const ts = new Date().toISOString();
				console.log(
					`[SuiModule] [${ts}] [attempt:${attemptLabel ?? '-'}] Detected adapters:`,
					adapterNames
				);
			}
		}
	} catch {}
	const wallets = getAvailableWallets(AllDefaultWallets, snapshot, walletConfig);
	try {
		const walletNames = wallets
			.map((w) => w?.name)
			.filter(Boolean)
			.sort();
		const wkey = walletNames.join('|');
		if (wkey !== _lastAvailableLogKey) {
			_lastAvailableLogKey = wkey;
			if (isDiscoveryDebugEnabled()) {
				const ts = new Date().toISOString();
				console.log(
					`[SuiModule] [${ts}] [attempt:${attemptLabel ?? '-'}] Available wallets:`,
					walletNames
				);
			}
		}
	} catch {}
	return { adapters: snapshot, wallets };
};

export const getDiscoveryAttempt = (): number => {
	return _discoveryAttempt;
};

export const incrementDiscoveryAttempt = (): number => {
	_discoveryAttempt += 1;
	return _discoveryAttempt;
};
