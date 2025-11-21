// Type definitions for SuiModule exports
export { default as SuiModule } from './SuiModule.svelte';

export * from './types';

// Re-export function and store types
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
