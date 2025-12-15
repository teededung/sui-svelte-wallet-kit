import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type { ConnectionData, SuiNetwork, ZkLoginGoogleConfig } from '../types.js';

// Environment guards
export const isBrowser = typeof window !== 'undefined';
export const hasLocalStorage = (): boolean => isBrowser && !!window.localStorage;

const STORAGE_KEY = 'sui-module-connection';

// Storage helpers
export const getConnectionData = (): ConnectionData | null => {
	if (!hasLocalStorage()) return null;
	const data = window.localStorage.getItem(STORAGE_KEY);
	return data ? (JSON.parse(data) as ConnectionData) : null;
};

// Browser detection for Slush Wallet (in-app browser)
export const isSlushBrowser = (): boolean => {
	if (!isBrowser) return false;
	// Check User Agent for "Slush"
	try {
		if (/Slush/i.test(window.navigator.userAgent)) return true;
	} catch {}
	// Check for injected global object (common pattern)
	try {
		if ((window as any).slush || (window as any).Slush) return true;
	} catch {}
	return false;
};

export const updateConnectionData = (partial: Partial<ConnectionData>): void => {
	if (!hasLocalStorage()) return;
	const current = getConnectionData() || {};
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
};

export const saveConnectionData = (walletName: string, autoConnect: boolean): void => {
	if (!autoConnect || !hasLocalStorage()) return;
	const current = getConnectionData() || {};
	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ ...current, walletName, autoConnect: true })
	);
};

export const clearConnectionData = (): void => {
	if (!hasLocalStorage()) return;
	window.localStorage.removeItem(STORAGE_KEY);
};

// OAuth redirect URL utilities
export const getSafeRedirectUrlForOAuth = (): string | undefined => {
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

export const normalizeAbsoluteUrl = (value: unknown): string | undefined => {
	try {
		if (typeof value !== 'string' || value.trim().length === 0) return undefined;
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
		return undefined;
	} catch {
		return undefined;
	}
};

export const pickRedirectFromList = (list: unknown): string | undefined => {
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

export const getPreferredRedirectUrlForOAuth = (
	zkLoginGoogle: ZkLoginGoogleConfig | null | undefined
): string | undefined => {
	try {
		const fromSingle = normalizeAbsoluteUrl(zkLoginGoogle?.redirectUrl);
		if (fromSingle) return fromSingle;
		const fromList = pickRedirectFromList(zkLoginGoogle?.redirectUrls);
		if (fromList) return fromList;
		return getSafeRedirectUrlForOAuth();
	} catch {
		return getSafeRedirectUrlForOAuth();
	}
};

// Network selection + client cache
export const getConfiguredNetwork = (
	zkLoginGoogle: ZkLoginGoogleConfig | null | undefined
): SuiNetwork | undefined => {
	try {
		const net = zkLoginGoogle?.network;
		if (net === 'mainnet' || net === 'testnet' || net === 'devnet') return net;
	} catch {}
	return undefined;
};

export const getDefaultChain = (zkLoginGoogle: ZkLoginGoogleConfig | null | undefined): string => {
	const cfg = getConfiguredNetwork(zkLoginGoogle);
	if (cfg) return `sui:${cfg}`;

	try {
		const selected = getConnectionData()?.selectedChain;
		if (typeof selected === 'string' && selected.startsWith('sui:')) return selected;
	} catch {}

	return 'sui:mainnet';
};

// SuiClient cache with Enoki registration callback
const _clientCache: Record<string, SuiClient> = {};

export type GetSuiClientOptions = {
	zkLoginGoogle?: ZkLoginGoogleConfig | null;
	onEnokiRegister?: (client: SuiClient, network: string) => void;
	isSuspiciousEnokiConfig?: (apiKey: unknown, googleId: unknown) => boolean;
};

export const getSuiClient = (chainIdLike: string, options: GetSuiClientOptions = {}): SuiClient => {
	const network = chainIdLike?.split?.(':')?.[1] || 'mainnet';
	if (!_clientCache[network]) {
		_clientCache[network] = new SuiClient({
			url: getFullnodeUrl(network as any),
			network
		});

		// Register Enoki wallets only when zkLoginGoogle is enabled and in browser environment
		if (options.zkLoginGoogle && isBrowser) {
			const apiKey = options.zkLoginGoogle?.apiKey;
			const googleId = options.zkLoginGoogle?.googleClientId;

			if (!apiKey || !googleId) {
				try {
					const missing = [!apiKey ? 'apiKey' : null, !googleId ? 'googleClientId' : null]
						.filter(Boolean)
						.join(', ');
					console.error(
						`[SuiModule] Enoki zkLogin is enabled but missing: ${missing}. Provide zkLoginGoogle={ apiKey, googleClientId }. See docs: https://docs.enoki.mystenlabs.com/ts-sdk/sign-in`
					);
				} catch {}
			} else {
				const isSuspicious = options.isSuspiciousEnokiConfig?.(apiKey, googleId) ?? false;
				if (isSuspicious) {
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
				} else {
					options.onEnokiRegister?.(_clientCache[network], network);
				}
			}
		}
	}
	return _clientCache[network];
};
