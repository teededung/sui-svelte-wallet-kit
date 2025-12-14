/**
 * Wallet adapters exports
 */

export {
	PasskeyWalletAdapter,
	createPasskeyWalletAdapter,
	type PasskeyAccount,
	type PasskeyAdapterConfig
} from './PasskeyWalletAdapter.js';

export {
	MultisigWalletAdapter,
	createMultisigWalletAdapter,
	type MultisigAccount,
	type MultisigAdapterConfig,
	type SignerProvider,
	type SignatureRequestCallback
} from './MultisigWalletAdapter.js';
