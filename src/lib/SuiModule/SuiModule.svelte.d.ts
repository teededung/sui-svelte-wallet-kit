import { Component } from 'svelte';
import type { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';
import type { Snippet } from 'svelte';

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
 * Switch wallet options
 */
export interface SwitchWalletOptions {
  onSelection?: (payload: WalletSelectionPayload) => void;
  shouldConnect?: (context: { selectedWallet: SuiWallet; currentWallet?: SuiWallet }) => boolean;
  onBeforeDisconnect?: (currentWallet?: SuiWallet, selectedWallet?: SuiWallet) => void;
  onConnected?: (wallet?: SuiWallet) => void;
  onCancel?: () => void;
}

/**
 * zkLogin configuration for Google (Enoki)
 */
export interface ZkLoginGoogleConfig {
  apiKey: string;
  googleClientId: string;
  network?: 'mainnet' | 'testnet' | 'devnet';
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
 * Wallet configuration
 */
export interface WalletConfig {
  customNames?: Record<string, string>;
  ordering?: string[];
}

/**
 * Message signing result
 */
export interface SignMessageResult {
  signature: string;
  messageBytes: string;
}

/**
 * Refresh balance options
 */
export interface RefreshBalanceOptions {
  force?: boolean;
  ttlMs?: number;
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
export interface LastWalletSelectionStore extends ReadableStore<WalletSelectionPayload | undefined> {
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
  children?: Snippet;
}

/**
 * Current connected account (reactive store)
 */
export const account: AccountStore;

/**
 * Account loading state (reactive store)
 */
export const accountLoading: ReadableStore<boolean>;

/**
 * All accounts from connected wallet (reactive store)
 */
export const accounts: ReadableStore<SuiAccount[]>;

/**
 * Number of accounts (reactive store)
 */
export const accountsCount: ReadableStore<number>;

/**
 * Index of active account in accounts array (reactive store)
 */
export const activeAccountIndex: ReadableStore<number>;

/**
 * Switch to a different account
 * @param selector - Account index (number), address (string), or account object
 * @returns true if switch was successful
 */
export function switchAccount(selector: number | string | SuiAccount): boolean;

/**
 * Connected wallet info (reactive store)
 */
export const wallet: ReadableStore<SuiWallet | undefined>;

/**
 * Connected wallet name (reactive store)
 */
export const walletName: ReadableStore<string>;

/**
 * Connected wallet icon URL (reactive store)
 */
export const walletIconUrl: ReadableStore<string>;

/**
 * Last wallet selection from modal (reactive store)
 */
export const lastWalletSelection: LastWalletSelectionStore;

/**
 * Switch to a different wallet (with modal)
 * @param options - Switch wallet options with callbacks
 * @returns Connection result
 */
export function switchWallet(options?: SwitchWalletOptions): Promise<ConnectionResult>;

/**
 * Open connect modal and wait for user selection
 * @param onSelection - Callback when wallet is selected
 * @returns Connection result
 */
export function connectWithModal(
  onSelection?: (payload: WalletSelectionPayload) => void
): Promise<ConnectionResult>;

/**
 * Get the connect modal instance
 * @returns ConnectModal component instance
 */
export function getConnectModal(): any;

/**
 * Connect to a wallet
 * @param wallet - Wallet to connect to
 */
export function connect(wallet: SuiWallet): Promise<void>;

/**
 * Disconnect from current wallet
 */
export function disconnect(): void;

/**
 * Sign and execute a transaction
 * @param transaction - Transaction to sign and execute
 * @returns Transaction result
 */
export function signAndExecuteTransaction(transaction: Transaction): Promise<any>;

/**
 * Sign a message
 * @param message - Message string or Uint8Array to sign
 * @returns Signature result with signature and message bytes
 */
export function signMessage(message: string | Uint8Array): Promise<SignMessageResult>;

/**
 * Check if current wallet supports message signing
 * @returns true if wallet supports signMessage
 */
export function canSignMessage(): boolean;

/**
 * Check if current wallet is a zkLogin wallet (Enoki)
 * @returns true if wallet supports Enoki zkLogin
 */
export function isZkLoginWallet(): boolean;

/**
 * Get zkLogin session info (Enoki)
 * @returns zkLogin session and metadata, or null if not available
 */
export function getZkLoginInfo(): Promise<ZkLoginInfo | null>;

/**
 * SuiNS names for active account (reactive store)
 */
export const suiNames: SuiNamesStore;

/**
 * SuiNS names loading state (reactive store)
 */
export const suiNamesLoading: ReadableStore<boolean>;

/**
 * SuiNS names by address map (reactive store)
 */
export const suiNamesByAddress: ReadableStore<Record<string, string[]>>;

/**
 * SuiClient instance matching current account's chain (reactive store)
 */
export const suiClient: ReadableStore<SuiClient>;

/**
 * SUI balance for active account in MIST (reactive store)
 */
export const suiBalance: ReadableStore<string | null>;

/**
 * SUI balance loading state (reactive store)
 */
export const suiBalanceLoading: ReadableStore<boolean>;

/**
 * SUI balance by address map in MIST (reactive store)
 */
export const suiBalanceByAddress: ReadableStore<Record<string, string>>;

/**
 * Refresh SUI balance for an address
 * @param targetAddress - Address to refresh balance for (defaults to active account)
 * @param options - Refresh options (force, ttlMs)
 * @returns Balance in MIST as string, or null if failed
 */
export function refreshSuiBalance(
  targetAddress?: string,
  options?: RefreshBalanceOptions
): Promise<string | null>;

/**
 * Set custom label for active account
 * @param name - Label to set
 */
export function setAccountLabel(name: string): void;

/**
 * Detected wallet adapters array (reactive, use subscribeWalletDiscovery)
 */
export const walletAdapters: any[];

/**
 * Available wallets array (reactive, use subscribeWalletDiscovery)
 */
export const availableWallets: SuiWallet[];

/**
 * Set SUI balance cache TTL (time to live)
 * @param ms - TTL in milliseconds
 */
export function setSuiBalanceCacheTTL(ms: number): void;

/**
 * Initialize wallet discovery (called automatically by SuiModule component)
 */
export function initWalletDiscovery(): void;

/**
 * Subscribe to wallet discovery updates
 * @param callback - Callback function receiving adapters and wallets arrays
 * @returns Unsubscribe function
 */
export function subscribeWalletDiscovery(
  callback: (adapters: any[], wallets: SuiWallet[]) => void
): () => void;

/**
 * Manually set wallet discovery results (advanced use)
 * @param adapters - Array of wallet adapters
 * @param wallets - Array of available wallets
 */
export function setModuleWalletDiscovery(adapters: any[], wallets: SuiWallet[]): void;

/**
 * SuiModule component - Provides Sui wallet connection context
 */
declare const SuiModule: Component<SuiModuleProps>;
export default SuiModule;


