import type { Wallet, WalletAccount } from '@wallet-standard/core';
import type { SuiClient } from '@mysten/sui/client';

/**
 * Sui network types
 */
export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet';

/**
 * Wallet adapter with Sui-specific features
 */
export interface SuiWalletAdapter extends Omit<Wallet, 'features' | 'accounts'> {
	connect?: () => Promise<void>;
	disconnect?: () => Promise<void>;
	signAndExecuteTransaction?: (params: SignAndExecuteTransactionParams) => Promise<any>;
	signPersonalMessage?: (params: SignPersonalMessageParams) => Promise<SignMessageResult>;
	signMessage?: (params: SignMessageParams) => Promise<SignMessageResult>;
	accounts?: readonly WalletAccount[];
	features?: Readonly<Record<`${string}:${string}`, unknown>> & {
		'standard:connect'?: {
			connect: () => Promise<void>;
		};
		'standard:disconnect'?: {
			disconnect: () => Promise<void>;
		};
		'standard:events'?: {
			on: (event: string, callback: (payload: any) => void) => () => void;
		};
		'sui:signAndExecuteTransaction'?: {
			signAndExecuteTransaction: (params: SignAndExecuteTransactionParams) => Promise<any>;
		};
		'sui:signAndExecuteTransactionBlock'?: {
			signAndExecuteTransactionBlock: (
				params: SignAndExecuteTransactionBlockParams
			) => Promise<any>;
		};
		'sui:signMessage'?: {
			signMessage: (params: SignMessageParams) => Promise<SignMessageResult>;
		};
		'sui:signPersonalMessage'?: {
			signPersonalMessage: (params: SignPersonalMessageParams) => Promise<SignMessageResult>;
		};
		'enoki:getSession'?: {
			getSession: () => Promise<any>;
		};
		'enoki:getMetadata'?: {
			getMetadata: () => Promise<any>;
		};
	};
}

/**
 * Sign and execute transaction parameters
 */
export interface SignAndExecuteTransactionParams {
	account: WalletAccount;
	chain: string;
	transaction: any;
}

/**
 * Sign and execute transaction block parameters (legacy)
 */
export interface SignAndExecuteTransactionBlockParams {
	account: WalletAccount;
	chain: string;
	transactionBlock: any;
}

/**
 * Sign message parameters
 */
export interface SignMessageParams {
	account: WalletAccount;
	chain: string;
	message: Uint8Array;
}

/**
 * Sign personal message parameters
 */
export interface SignPersonalMessageParams {
	account: WalletAccount;
	chain?: string;
	message: Uint8Array;
}

/**
 * Sign message result
 */
export interface SignMessageResult {
	signature: string;
	messageBytes?: string;
}

/**
 * Wallet configuration
 */
export interface WalletConfig {
	customNames?: Record<string, string>;
	ordering?: string[];
}

/**
 * zkLogin configuration for Google (Enoki)
 */
export interface ZkLoginGoogleConfig {
	apiKey: string;
	googleClientId: string;
	network?: SuiNetwork;
	redirectUrl?: string;
	redirectUrls?: string[];
}

/**
 * Connection data stored in localStorage
 */
export interface ConnectionData {
	walletName?: string;
	autoConnect?: boolean;
	selectedAccountAddress?: string;
	selectedChain?: string;
}

/**
 * Wallet change event payload
 */
export interface WalletChangePayload {
	accounts?: WalletAccount[];
	chains?: string[];
}

/**
 * Wallet with installation status
 */
export interface WalletWithStatus {
	name: string;
	version?: string;
	icon?: string | { light: string; dark: string };
	chains?: readonly `${string}:${string}`[];
	features?: Record<string, unknown>;
	accounts?: readonly unknown[];
	installed?: boolean;
	displayName?: string;
	originalName?: string;
	adapter?: SuiWalletAdapter;
	iconUrl?: string;
}

/**
 * Modal response with wallet selection
 */
export interface ModalResponse {
	wallet?: Wallet;
	installed?: boolean;
	started?: boolean;
}

/**
 * Switch wallet options
 */
export interface SwitchWalletOptions {
	onSelection?: (payload: {
		wallet: Wallet | WalletWithStatus;
		installed: boolean;
		connected: boolean;
	}) => void;
	shouldConnect?: (context: {
		selectedWallet: Wallet | WalletWithStatus;
		currentWallet?: Wallet | WalletWithStatus;
	}) => boolean;
	onBeforeDisconnect?: (
		currentWallet?: Wallet | WalletWithStatus,
		selectedWallet?: Wallet | WalletWithStatus
	) => void;
	onConnected?: (wallet?: Wallet | WalletWithStatus) => void;
	onCancel?: () => void;
}

/**
 * Refresh balance options
 */
export interface RefreshBalanceOptions {
	force?: boolean;
	ttlMs?: number;
}

/**
 * Google provider options for Enoki
 */
export interface GoogleProviderOptions {
	clientId: string;
	redirectUrl?: string;
}

/**
 * Enoki registration options
 */
export interface EnokiRegistrationOptions {
	client: SuiClient;
	network: SuiNetwork;
	apiKey: string;
	providers: {
		google: GoogleProviderOptions;
	};
}

/**
 * Sui account representation
 */
export interface SuiAccount {
	address: string;
	label?: string;
	chains?: string[];
	publicKey?: Uint8Array;
	[key: string]: any;
}

/**
 * Wallet representation
 */
export interface SuiWallet {
	name: string;
	iconUrl?: string;
	adapter?: any;
	installed?: boolean;
	displayName?: string;
	originalName?: string;
	[key: string]: any;
}

/**
 * Wallet selection result
 */
export interface WalletSelectionPayload {
	wallet: SuiWallet;
	installed: boolean;
}

/**
 * Connection result
 */
export interface ConnectionResult {
	wallet?: SuiWallet;
	installed: boolean;
	connected: boolean;
	cancelled?: boolean;
	alreadyConnected?: boolean;
	skipped?: boolean;
	started?: boolean;
	error?: string;
}

/**
 * zkLogin session info
 */
export interface ZkLoginInfo {
	session?: any;
	metadata?: {
		provider?: string;
		[key: string]: any;
	};
}

/**
 * Reactive store with value getter
 */
export interface ReadableStore<T> {
	readonly value: T;
}

/**
 * Account store with mutation methods
 */
export interface AccountStore extends ReadableStore<SuiAccount | undefined> {
	setAccount(account: SuiAccount | undefined): void;
	removeAccount(): void;
}

/**
 * SuiNames store with clear method
 */
export interface SuiNamesStore extends ReadableStore<string[]> {
	clear(): void;
}

/**
 * Last wallet selection store with clear method
 */
export interface LastWalletSelectionStore
	extends ReadableStore<WalletSelectionPayload | undefined> {
	clear(): void;
}

/**
 * SuiModule component props
 */
export interface SuiModuleProps {
	onConnect?: () => void;
	autoConnect?: boolean;
	autoSuiNS?: boolean;
	autoSuiBalance?: boolean;
	walletConfig?: WalletConfig;
	zkLoginGoogle?: ZkLoginGoogleConfig | null;
	children?: any;
}
