/**
 * MultisigService exports
 */

export {
	MultisigService,
	createMultisigService,
	deriveMultisigAddress
} from './MultisigService.js';

// Legacy types from types.js (for backward compatibility)
export {
	type SignerType,
	type SignerConfig,
	type MultisigConfig as LegacyMultisigConfig,
	type SignerStatus,
	type SignatureCollectionResult,
	type SignatureProgressCallback,
	type CollectSignaturesOptions,
	type MultisigAccountInfo
} from './types.js';

// Multisig types for simplified configuration (new)
export {
	MultisigError,
	MultisigErrorCode,
	type SignerKeyType,
	type ResolvedSignerType,
	type PasskeySigner,
	type ZkLoginSigner,
	type WalletSigner,
	type PublicKeySigner,
	type MultisigSigner,
	type MultisigPreConfig,
	type MultisigDynamicConfig,
	type MultisigConfig,
	type ResolvedSigner,
	type MultisigState,
	type SignerSignatureStatus,
	type ExecuteResult,
	type MultisigProposal,
	type UseMultisigReturn,
	type ResolverContext
} from './MultisigTypes.js';

// Multisig validation functions
export {
	validateMultisigConfig,
	validateSigner,
	validateThreshold,
	validatePreconfiguredConfig,
	validateDynamicConfig,
	isPreconfiguredMode,
	isDynamicMode,
	calculateTotalWeight,
	type ValidationResult
} from './MultisigValidation.js';

// SignerResolver
export {
	SignerResolver,
	createSignerResolver,
	parsePublicKey,
	generateSignerId
} from './SignerResolver.js';

// Multisig Store (Svelte 5 Runes)
export { MultisigStore, multisigStore, type MultisigProviders } from './MultisigStore.svelte.js';

// useMultisig hook
export {
	useMultisig,
	initializeMultisig,
	setMultisigContext,
	getMultisigContext
} from './useMultisig.js';
