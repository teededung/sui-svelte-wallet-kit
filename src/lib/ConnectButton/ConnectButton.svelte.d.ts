import { Component } from 'svelte';
import type { WalletSelectionPayload } from '../SuiModule/SuiModule.svelte.js';

/**
 * ConnectButton component props
 */
export interface ConnectButtonProps {
  /**
   * Custom CSS class name
   */
  class?: string;
  /**
   * Custom inline styles
   */
  style?: string;
  /**
   * Callback when wallet is selected from modal
   */
  onWalletSelection?: (payload: WalletSelectionPayload) => void;
}

/**
 * ConnectButton component - Simple button to connect/disconnect wallet
 * Shows "Connect" when not connected, "Disconnect" when connected
 */
declare const ConnectButton: Component<ConnectButtonProps>;
export default ConnectButton;


