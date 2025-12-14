/**
 * useMultisig Hook
 * Provides access to Multisig store
 */

import { multisigStore, type MultisigProviders } from './MultisigStore.svelte.js';
import type {
	MultisigConfig,
	MultisigState,
	ResolvedSigner,
	MultisigSigner,
	MultisigProposal,
	UseMultisigReturn
} from './MultisigTypes.js';

// Re-export store and types
export { multisigStore, type MultisigProviders };

/**
 * Initialize Multisig (called by SuiModule)
 */
export function initializeMultisig(
	config: MultisigConfig,
	providers: MultisigProviders,
	network?: 'mainnet' | 'testnet' | 'devnet'
): void {
	multisigStore.initialize(config, network);
	multisigStore.setProviders(providers);
}

/**
 * useMultisig hook
 * Returns the Multisig store instance for reactive access
 */
export function useMultisig(): UseMultisigReturn {
	const store = multisigStore;

	return {
		// State (reactive via $derived in store)
		get state() {
			return store.state;
		},
		get address() {
			return store.address;
		},
		get isReady() {
			return store.isReady;
		},
		get signers() {
			return store.signers;
		},
		get mode() {
			return store.mode;
		},
		get threshold() {
			return store.threshold;
		},

		// Actions
		createProposal: (tx) => store.createProposal(tx),
		refreshSigners: async () => store.resolveSigners(),
		addSignerFromCurrentWallet: (options) => store.addSignerFromCurrentWallet(options),
		addSigner: async (signer) => store.addSigner(signer),
		removeSigner: (signerId) => store.removeSigner(signerId),
		setThreshold: (threshold) => store.setThreshold(threshold),
		saveConfig: () => store.saveConfig(),
		loadConfig: () => {
			const config = store.config as { storageKey?: string } | null;
			if (config?.storageKey) {
				store.loadFromStorage(config.storageKey);
				store.resolveSigners();
			}
		},
		clearConfig: () => store.clearConfig()
	};
}

// Legacy exports for backward compatibility
export function setMultisigContext(): void {
	// No-op, using global store now
}

export function getMultisigContext() {
	return multisigStore.providers ? multisigStore : null;
}
