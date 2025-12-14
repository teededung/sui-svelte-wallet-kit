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
	signTransaction?: (params: SignTransactionParams) => Promise<SignTransactionResult>;
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
		'sui:signTransaction'?: {
			signTransaction: (params: SignTransactionParams) => Promise<SignTransactionResult>;
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
 * Sign (but do NOT execute) a transaction
 */
export interface SignTransactionParams {
	account: WalletAccount;
	chain: string;
	transaction: any;
}

/**
 * Result of signing a transaction
 */
export interface SignTransactionResult {
	signature: string;
	bytes: Uint8Array;
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
 * Extends Wallet from @wallet-standard/core with additional metadata
 */
export interface WalletWithStatus extends Partial<Wallet> {
	name: string;
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
		wallet: WalletWithStatus;
		installed: boolean;
		connected: boolean;
	}) => void;
	shouldConnect?: (context: {
		selectedWallet: WalletWithStatus;
		currentWallet?: WalletWithStatus;
	}) => boolean;
	onBeforeDisconnect?: (
		currentWallet?: WalletWithStatus,
		selectedWallet?: WalletWithStatus
	) => void;
	onConnected?: (wallet?: WalletWithStatus) => void;
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
 * Compatible with WalletAccount from @wallet-standard/core
 */
export interface SuiAccount extends WalletAccount {
	[key: string]: any;
}

/**
 * Wallet representation
 * Compatible with Wallet from @wallet-standard/core
 */
export interface SuiWallet extends Partial<Wallet> {
	name: string;
	iconUrl?: string;
	installed?: boolean;
	displayName?: string;
	originalName?: string;
	adapter?: any;
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
export interface LastWalletSelectionStore extends ReadableStore<
	WalletSelectionPayload | undefined
> {
	clear(): void;
}

/**
 * Passkey configuration for WebAuthn-based wallet
 */
export interface PasskeyConfig {
	rpId: string;
	rpName: string;
	authenticatorAttachment?: 'platform' | 'cross-platform';
	timeout?: number;
}

/**
 * Multisig signer type
 */
export type MultisigSignerType = 'ed25519' | 'secp256k1' | 'secp256r1' | 'zklogin' | 'passkey';

/**
 * Multisig signer configuration (simplified for module props)
 */
export interface MultisigSignerConfig {
	/** Unique identifier for this signer */
	id: string;
	/** Type of signer */
	type: MultisigSignerType;
	/** Weight of this signer (default: 1) */
	weight: number;
	/** Public key bytes or base64 string */
	publicKey?: Uint8Array | string;
	/** zkLogin address seed (required for zklogin type) */
	addressSeed?: string;
	/** zkLogin issuer (required for zklogin type) */
	issuer?: string;
	/** Display name for UI */
	name?: string;
}

/**
 * Callback to request a partial signature for multisig.
 * Return null to skip a signer (adapter will continue to next signer).
 */
export type MultisigSignatureRequestCallback = (
	signer: MultisigSignerConfig,
	txBytes: Uint8Array
) => Promise<{ signature: string } | null>;

/**
 * Multisig module configuration
 */
export interface MultisigModuleConfig {
	/** Threshold required to execute transactions */
	threshold: number;
	/** List of signers */
	signers: MultisigSignerConfig[];
	/** Optional name for this multisig wallet */
	name?: string;
	/** Network for the multisig wallet */
	network?: SuiNetwork;
	/** Callback to request partial signatures from signers */
	onSignatureRequest?: MultisigSignatureRequestCallback;
	/** Callback when multisig address changes */
	onAddressChange?: (oldAddress: string, newAddress: string) => void;
}

/**
 * Multisig config types (imported from MultisigService)
 * Re-exported here for convenience
 */
export type {
	MultisigConfig,
	MultisigPreConfig,
	MultisigDynamicConfig
} from '../MultisigService/MultisigTypes.js';

/**
 * Combined multisig config type - supports both legacy and new Multisig configs
 * Used for SuiModule's multisig prop
 */
import type { MultisigConfig } from '../MultisigService/MultisigTypes.js';
export type SuiModuleMultisigConfig = MultisigModuleConfig | MultisigConfig;

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
	passkey?: PasskeyConfig | null;
	multisig?: SuiModuleMultisigConfig | null;
	children?: any;
}
