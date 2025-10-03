import { Component } from 'svelte';
import type { SuiWallet, ZkLoginGoogleConfig } from '../SuiModule/SuiModule.svelte.js';

/**
 * Modal response when wallet is selected
 */
export interface ConnectModalResponse {
  wallet: SuiWallet;
  installed: boolean;
  started?: boolean;
}

/**
 * ConnectModal component props
 */
export interface ConnectModalProps {
  /**
   * List of available wallets to show in modal
   */
  availableWallets: SuiWallet[];
  /**
   * Callback when user picks an installed wallet
   * Called immediately in the click handler to preserve user gesture
   */
  onPickInstalled?: (wallet: SuiWallet) => void;
  /**
   * zkLogin Google configuration for Enoki
   */
  zkLoginGoogle?: ZkLoginGoogleConfig | null;
}

/**
 * ConnectModal component methods
 */
export interface ConnectModalInstance {
  /**
   * Open modal and wait for user to select a wallet
   * @returns Promise that resolves with selected wallet or undefined if cancelled
   */
  openAndWaitForResponse(): Promise<ConnectModalResponse | undefined>;
}

/**
 * ConnectModal component - Modal dialog for wallet selection
 * Shows detected wallets and allows installing others
 */
declare const ConnectModal: Component<ConnectModalProps>;
export default ConnectModal;


