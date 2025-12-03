/**
 * PasskeyService Types
 * Defines interfaces and types for WebAuthn passkey operations
 */

// Error codes for passkey operations
export enum PasskeyErrorCode {
	WEBAUTHN_NOT_SUPPORTED = 'WEBAUTHN_NOT_SUPPORTED',
	CREDENTIAL_CREATE_FAILED = 'CREDENTIAL_CREATE_FAILED',
	CREDENTIAL_GET_FAILED = 'CREDENTIAL_GET_FAILED',
	USER_CANCELLED = 'USER_CANCELLED',
	TIMEOUT = 'TIMEOUT',
	INVALID_CREDENTIAL = 'INVALID_CREDENTIAL',
	RPID_MISMATCH = 'RPID_MISMATCH',
	STORAGE_ERROR = 'STORAGE_ERROR',
	INVALID_CONFIG = 'INVALID_CONFIG'
}

// Custom error class for passkey operations
export class PasskeyError extends Error {
	constructor(
		public code: PasskeyErrorCode,
		message: string,
		public cause?: Error
	) {
		super(message);
		this.name = 'PasskeyError';
	}
}

// Options for creating a new passkey credential
export interface PasskeyCreateOptions {
	rpId: string;
	rpName: string;
	userName: string;
	userDisplayName?: string;
	authenticatorAttachment?: 'platform' | 'cross-platform';
	timeout?: number;
}

// Result of passkey credential creation
export interface PasskeyCredential {
	credentialId: string;
	publicKey: Uint8Array;
	suiAddress: string;
	createdAt: number;
}

// Options for authenticating with existing passkey
export interface PasskeyAuthOptions {
	rpId: string;
	credentialId?: string; // Optional for discoverable credentials
	timeout?: number;
}

// Result of passkey authentication
export interface PasskeyAuthResult {
	credentialId: string;
	signature: Uint8Array;
	authenticatorData: Uint8Array;
	clientDataJSON: Uint8Array;
}

// Configuration for PasskeyService
export interface PasskeyConfig {
	rpId: string;
	rpName: string;
	authenticatorAttachment?: 'platform' | 'cross-platform';
	timeout?: number;
}
