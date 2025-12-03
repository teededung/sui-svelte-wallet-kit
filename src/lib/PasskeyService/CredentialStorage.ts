/**
 * CredentialStorage
 * Handles persistence of passkey credentials
 */

// Stored credential data
export interface StoredCredential {
	credentialId: string;
	publicKey: string; // Base64 encoded
	suiAddress: string;
	createdAt: number;
	lastUsedAt?: number;
	rpId: string;
}

// Collection of stored credentials
export interface StoredCredentials {
	credentials: StoredCredential[];
	version: number;
}

// Storage interface for custom implementations
export interface CredentialStorage {
	get(): Promise<StoredCredentials | null>;
	set(credentials: StoredCredentials): Promise<void>;
	clear(): Promise<void>;
}

const STORAGE_KEY = 'sui-passkey-credentials';
const STORAGE_VERSION = 1;

/**
 * Default localStorage implementation of CredentialStorage
 */
export class LocalStorageCredentialStorage implements CredentialStorage {
	private key: string;

	constructor(key: string = STORAGE_KEY) {
		this.key = key;
	}

	async get(): Promise<StoredCredentials | null> {
		if (typeof localStorage === 'undefined') return null;

		try {
			const data = localStorage.getItem(this.key);
			if (!data) return null;

			const parsed = JSON.parse(data) as StoredCredentials;

			// Validate version
			if (parsed.version !== STORAGE_VERSION) {
				// Handle migration if needed in the future
				console.warn(
					`Credential storage version mismatch: ${parsed.version} vs ${STORAGE_VERSION}`
				);
			}

			return parsed;
		} catch (error) {
			console.error('Failed to read credentials from storage:', error);
			return null;
		}
	}

	async set(credentials: StoredCredentials): Promise<void> {
		if (typeof localStorage === 'undefined') {
			throw new Error('localStorage is not available');
		}

		try {
			localStorage.setItem(this.key, JSON.stringify(credentials));
		} catch (error) {
			console.error('Failed to save credentials to storage:', error);
			throw error;
		}
	}

	async clear(): Promise<void> {
		if (typeof localStorage === 'undefined') return;

		try {
			localStorage.removeItem(this.key);
		} catch (error) {
			console.error('Failed to clear credentials from storage:', error);
		}
	}
}

/**
 * Helper functions for credential management
 */
export function createEmptyStorage(): StoredCredentials {
	return {
		credentials: [],
		version: STORAGE_VERSION
	};
}

export function addCredential(
	storage: StoredCredentials,
	credential: StoredCredential
): StoredCredentials {
	// Check if credential already exists
	const existingIndex = storage.credentials.findIndex(
		(c) => c.credentialId === credential.credentialId
	);

	if (existingIndex >= 0) {
		// Update existing credential
		const updated = [...storage.credentials];
		updated[existingIndex] = { ...credential, lastUsedAt: Date.now() };
		return { ...storage, credentials: updated };
	}

	// Add new credential
	return {
		...storage,
		credentials: [...storage.credentials, credential]
	};
}

export function findCredentialByAddress(
	storage: StoredCredentials,
	address: string
): StoredCredential | undefined {
	return storage.credentials.find((c) => c.suiAddress === address);
}

export function findCredentialById(
	storage: StoredCredentials,
	credentialId: string
): StoredCredential | undefined {
	return storage.credentials.find((c) => c.credentialId === credentialId);
}

export function findCredentialsByRpId(
	storage: StoredCredentials,
	rpId: string
): StoredCredential[] {
	return storage.credentials.filter((c) => c.rpId === rpId);
}

export function removeCredential(
	storage: StoredCredentials,
	credentialId: string
): StoredCredentials {
	return {
		...storage,
		credentials: storage.credentials.filter((c) => c.credentialId !== credentialId)
	};
}

export function updateLastUsed(
	storage: StoredCredentials,
	credentialId: string
): StoredCredentials {
	const updated = storage.credentials.map((c) =>
		c.credentialId === credentialId ? { ...c, lastUsedAt: Date.now() } : c
	);
	return { ...storage, credentials: updated };
}
