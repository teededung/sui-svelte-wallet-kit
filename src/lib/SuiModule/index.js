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
