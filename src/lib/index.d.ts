// Re-export components and types
export { ConnectButton } from './ConnectButton/index';
export type { ConnectButtonProps } from './ConnectButton/index';

export { ConnectModal } from './ConnectModal/index';
export type {
	ConnectModalProps,
	ConnectModalResponse,
	ConnectModalInstance
} from './ConnectModal/index';

export type { SuiClient } from '@mysten/sui/client';

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
	signTransaction,
	signMessage,
	canSignMessage,
	isZkLoginWallet,
	getZkLoginInfo,
	isPasskeyWallet,
	usePasskeyAccount,
	isMultisigWallet,
	useMultisigAccount,
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
} from './SuiModule/index';

export type {
	SuiAccount,
	SuiWallet,
	WalletSelectionPayload,
	ConnectionResult,
	SwitchWalletOptions,
	ZkLoginGoogleConfig,
	ZkLoginInfo,
	WalletConfig,
	SignMessageResult,
	RefreshBalanceOptions,
	ReadableStore,
	SuiNamesStore,
	LastWalletSelectionStore,
	SuiModuleProps,
	MultisigModuleConfig,
	MultisigSignerConfig,
	MultisigSignerType,
	MultisigSignatureRequestCallback,
	SuiModuleMultisigConfig
} from './SuiModule/index';

// Passkey exports
export {
	PasskeyService,
	PasskeyError,
	PasskeyErrorCode,
	LocalStorageCredentialStorage
} from './PasskeyService/index';

export type {
	PasskeyConfig,
	PasskeyCredential,
	CredentialStorage,
	StoredCredential,
	StoredCredentials
} from './PasskeyService/index';

// Wallet adapters
export { PasskeyWalletAdapter, createPasskeyWalletAdapter } from './adapters/index';
export type { PasskeyAccount, PasskeyAdapterConfig } from './adapters/index';

export { MultisigWalletAdapter, createMultisigWalletAdapter } from './adapters/index';
export type {
	MultisigAccount,
	MultisigAdapterConfig,
	SignerProvider,
	SignatureRequestCallback
} from './adapters/index';

// Multisig exports
export {
	MultisigService,
	MultisigError,
	MultisigErrorCode,
	createMultisigService,
	deriveMultisigAddress
} from './MultisigService/index';

export type {
	SignerType,
	SignerConfig,
	MultisigConfig,
	SignerStatus,
	SignatureCollectionResult,
	SignatureProgressCallback,
	CollectSignaturesOptions,
	MultisigAccountInfo
} from './MultisigService/index';

// Multisig exports
export {
	MultisigError,
	MultisigErrorCode,
	validateMultisigConfig,
	validateSigner,
	validateThreshold,
	isPreconfiguredMode,
	isDynamicMode,
	calculateTotalWeight,
	SignerResolver,
	createSignerResolver,
	parsePublicKey,
	useMultisig,
	initializeMultisig,
	setMultisigContext,
	getMultisigContext
} from './MultisigService/index';

export type {
	SignerKeyType,
	ResolvedSignerType,
	PasskeySigner,
	ZkLoginSigner,
	WalletSigner,
	PublicKeySigner,
	MultisigSigner,
	MultisigPreConfig,
	MultisigDynamicConfig,
	MultisigConfig,
	ResolvedSigner,
	MultisigState,
	SignerSignatureStatus,
	ExecuteResult,
	MultisigProposal,
	UseMultisigReturn,
	ResolverContext,
	ValidationResult,
	MultisigProviders
} from './MultisigService/index';
