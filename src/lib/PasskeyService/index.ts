/**
 * PasskeyService module exports
 */

export { PasskeyService } from './PasskeyService.js';
export {
	PasskeyError,
	PasskeyErrorCode,
	type PasskeyCreateOptions,
	type PasskeyCredential,
	type PasskeyAuthOptions,
	type PasskeyAuthResult,
	type PasskeyConfig
} from './types.js';

export {
	LocalStorageCredentialStorage,
	createEmptyStorage,
	addCredential,
	findCredentialByAddress,
	findCredentialById,
	findCredentialsByRpId,
	removeCredential,
	updateLastUsed,
	type CredentialStorage,
	type StoredCredential,
	type StoredCredentials
} from './CredentialStorage.js';
