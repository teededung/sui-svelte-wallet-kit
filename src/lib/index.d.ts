// Re-export components and types
export { ConnectButton } from './ConnectButton/index';
export type { ConnectButtonProps } from './ConnectButton/index';

export { ConnectModal } from './ConnectModal/index';
export type { ConnectModalProps, ConnectModalResponse, ConnectModalInstance } from './ConnectModal/index';

export type { SuiClient } from '@mysten/sui/client';

export {
  SuiModule,
  account,
  accountLoading,
  accounts,
  accountsCount,
  activeAccountIndex,
  switchAccount,
  wallet,
  walletName,
  walletIconUrl,
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
  suiClient
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
  AccountStore,
  SuiNamesStore,
  LastWalletSelectionStore,
  SuiModuleProps
} from './SuiModule/index';

