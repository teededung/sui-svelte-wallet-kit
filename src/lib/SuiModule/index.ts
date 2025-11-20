// Main component
export { default as SuiModule } from './SuiModule.svelte';

// Re-export all functions and stores from the component
export {
	useCurrentAccount,
	useAccounts,
	accountLoading,
	activeAccountIndex,
	switchAccount,
	useCurrentWallet,
	lastWalletSelection,
	switchWallet,
	connectWithModal,
	getConnectModal,
	connect,
	disconnect,
	signAndExecuteTransaction,
	signMessage,
	canSignMessage,
	isZkLoginWallet,
	getZkLoginInfo,
	suiNames,
	suiNamesLoading,
	suiNamesByAddress,
	useSuiClient,
	suiBalance,
	suiBalanceLoading,
	suiBalanceByAddress,
	refreshSuiBalance,
	setAccountLabel,
	walletAdapters,
	availableWallets,
	setSuiBalanceCacheTTL,
	initWalletDiscovery,
	subscribeWalletDiscovery,
	setModuleWalletDiscovery
} from './SuiModule.svelte';

// Re-export all types
export type {
	SuiWalletAdapter,
	WalletConfig,
	ZkLoginGoogleConfig,
	ConnectionData,
	WalletChangePayload,
	WalletWithStatus,
	ModalResponse,
	SwitchWalletOptions,
	RefreshBalanceOptions,
	SuiNetwork,
	SignAndExecuteTransactionParams,
	SignAndExecuteTransactionBlockParams,
	SignMessageParams,
	SignPersonalMessageParams,
	SignMessageResult,
	GoogleProviderOptions,
	EnokiRegistrationOptions
} from './types';

// Re-export component types
export type {
	SuiAccount,
	SuiWallet,
	WalletSelectionPayload,
	ConnectionResult,
	ZkLoginInfo,
	ReadableStore,
	AccountStore,
	SuiNamesStore,
	LastWalletSelectionStore,
	SuiModuleProps
} from './SuiModule.svelte.d.ts';
