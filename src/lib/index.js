// Reexport your entry components here
export { ConnectButton } from './ConnectButton/index.js';
export { ConnectModal } from './ConnectModal/index.js';
export {
	SuiModule,
	useCurrentAccount,
	useCurrentWallet,
	useAccounts,
	accountLoading,
	activeAccountIndex,
	switchAccount,
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
	isPasskeyWallet,
	usePasskeyAccount,
	suiNames,
	suiNamesLoading,
	suiNamesByAddress,
	suiBalance,
	suiBalanceLoading,
	suiBalanceByAddress,
	refreshSuiBalance,
	setAccountLabel,
	walletAdapters,
	availableWallets,
	setSuiBalanceCacheTTL,
	subscribeWalletDiscovery,
	setModuleWalletDiscovery,
	initWalletDiscovery,
	useSuiClient
} from './SuiModule/index.js';

// Passkey exports
export {
	PasskeyService,
	PasskeyError,
	PasskeyErrorCode,
	LocalStorageCredentialStorage,
	createEmptyStorage,
	addCredential,
	findCredentialByAddress,
	findCredentialById,
	findCredentialsByRpId,
	removeCredential,
	updateLastUsed
} from './PasskeyService/index.js';

// Wallet adapters
export { PasskeyWalletAdapter, createPasskeyWalletAdapter } from './adapters/index.js';
