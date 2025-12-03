# Passkey Integration Documentation

## Overview

This document describes the Passkey (WebAuthn) wallet integration in `sui-svelte-wallet-kit`. The implementation is based on [Mysten Labs passkey-example](https://github.com/MystenLabs/passkey-example) and uses the `@mysten/sui` SDK's `PasskeyKeypair` for cryptographic operations.

## Architecture

### Components

```
src/lib/
├── PasskeyService/
│   ├── types.ts           # Type definitions and error codes
│   ├── PasskeyService.ts  # WebAuthn operations (create/authenticate)
│   ├── CredentialStorage.ts # localStorage persistence
│   └── index.ts           # Exports
├── adapters/
│   └── PasskeyWalletAdapter.ts # SuiWalletAdapter implementation
└── SuiModule/
    └── SuiModule.svelte   # Integration with wallet discovery
```

### Key Dependencies

- `@mysten/sui/keypairs/passkey`: `PasskeyKeypair`, `BrowserPasskeyProvider`, `findCommonPublicKey`
- WebAuthn API: `navigator.credentials.create()`, `navigator.credentials.get()`

## Connection Flows

### 1. First-time Connection (No Stored Credentials)

```
User clicks Connect → getPasskeyInstance() → WebAuthn create prompt →
Save to localStorage → Connected
```

- Uses `PasskeyKeypair.getPasskeyInstance(provider)` to create new passkey
- Prompts user with "Add a passkey?" dialog
- Stores public key and Sui address in localStorage

### 2. Reconnection (Has Stored Credentials)

```
User clicks Connect → signAndRecover() → WebAuthn sign prompt →
Match against stored public keys → Connected
```

- Uses `PasskeyKeypair.signAndRecover()` to authenticate
- Only **1 sign prompt** if passkey matches stored credential
- **2 sign prompts** if new passkey (needs confirmation)

### 3. Auto-connect (Page Refresh)

```
Page loads → silentConnect() → Restore from localStorage →
Connected (no prompt)
```

- Restores `PasskeyKeypair` from stored public key
- **No WebAuthn prompt** - user will be prompted when signing transactions

### 4. Transaction Signing

```
User signs transaction → passkeyKeypair.signTransaction() →
WebAuthn sign prompt → Execute on Sui network
```

- Always prompts user for biometric verification
- Uses the same passkey that was used during connection

## Important Technical Details

### Why 2 Signs for New Passkey?

ECDSA signature recovery can return up to 4 possible public keys. To uniquely identify the correct public key:

1. Sign message 1 → Get 4 possible public keys
2. Sign message 2 → Get 4 possible public keys
3. Find the **common** public key between both sets

This is only needed when the passkey doesn't match any stored credential.

### Public Key Format

- Sui uses **secp256r1** (P-256) curve
- Public key is stored in **compressed format** (33 bytes)
- Format: `0x02` or `0x03` prefix + 32 bytes X coordinate

### Storage Structure

```typescript
// localStorage key: 'sui-passkey-credentials'
{
  "credentials": [
    {
      "credentialId": "base64...",  // Random ID (not WebAuthn credential ID)
      "publicKey": "base64...",     // Compressed secp256r1 public key
      "suiAddress": "0x...",        // Derived Sui address
      "createdAt": 1234567890,
      "lastUsedAt": 1234567890,
      "rpId": "localhost"           // Relying Party ID (domain)
    }
  ],
  "version": 1
}
```

## Configuration

```typescript
const passkeyConfig = {
  rpId: window.location.hostname,  // Must match domain - cannot be changed
  rpName: 'My App Name',           // Display name - can be customized freely
  authenticatorAttachment: 'platform' // 'platform' or 'cross-platform'
};

<SuiModule passkey={passkeyConfig}>
  ...
</SuiModule>
```

### Configuration Options

| Option                    | Type                           | Default    | Description                                                                |
| ------------------------- | ------------------------------ | ---------- | -------------------------------------------------------------------------- |
| `rpId`                    | string                         | required   | Domain name (e.g., 'localhost', 'myapp.com'). **Must match actual domain** |
| `rpName`                  | string                         | required   | Display name shown in passkey prompts. **Can be any name you want**        |
| `authenticatorAttachment` | 'platform' \| 'cross-platform' | 'platform' | 'platform' = device biometrics, 'cross-platform' = security keys           |
| `timeout`                 | number                         | 60000      | Timeout in milliseconds                                                    |
| `icon`                    | WalletIconDataUrl              | key icon   | Custom icon for wallet list (must be data URL in svg/png/webp/gif format)  |

### About `rpId` vs `rpName`

- **`rpId`** (Relying Party ID): This is the domain identifier and **must match your actual domain**. WebAuthn uses this to identify which passkeys belong to your site. You cannot change this arbitrarily.
  - Development: `'localhost'`
  - Production: `'myapp.com'`

- **`rpName`** (Relying Party Name): This is just a **display name** shown to users in passkey prompts. You can set this to any user-friendly name:
  - `'My Awesome DApp'`
  - `'Sui Trading Platform'`
  - `'NFT Marketplace'`
  - Or even let users customize it!

**Note**: If you change `rpName` after users have created passkeys, existing passkeys will still work (WebAuthn only uses `rpId` for identification). However, the old name may still appear in the user's password manager.

### Custom Icon

You can customize the passkey wallet icon displayed in the wallet list:

```typescript
const passkeyConfig = {
	rpId: window.location.hostname,
	rpName: 'My App',
	// Custom icon (must be data URL format)
	icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgZmlsbD0iIzAwNzJmZiIvPjwvc3ZnPg=='
};
```

Supported formats:

- `data:image/svg+xml;base64,${string}` (recommended)
- `data:image/png;base64,${string}`
- `data:image/webp;base64,${string}`
- `data:image/gif;base64,${string}`

**Tip**: Use an online tool to convert your icon to base64 data URL format.

## Recovery After localStorage Clear

If localStorage is cleared but the passkey still exists in macOS/Windows:

### What Happens

1. User clicks Connect
2. System shows passkey picker with existing passkeys
3. User selects their existing passkey
4. System recovers the public key via `signAndRecover()`
5. Credential is saved back to localStorage

### Flow

```
localStorage cleared → User clicks Connect →
signAndRecover() shows passkey picker → User selects existing passkey →
Public key recovered → Saved to localStorage → Connected with same Sui address
```

**Important**: The Sui address is derived from the public key, so as long as user selects the same passkey, they will get the same Sui address back.

### If User Accidentally Creates New Passkey

If user clicks "Cancel" on the passkey picker and creates a new passkey instead:

- They will get a **new Sui address**
- The old passkey still exists in macOS and can be recovered later
- To recover: Clear localStorage again, click Connect, and select the correct passkey

## Known Limitations

1. **Multiple Passkeys**: If user has multiple passkeys for the same domain, they must select the correct one during authentication
2. **Cross-device**: Passkeys created on one device cannot be used on another (unless using cross-platform authenticators)
3. **Browser Support**: Requires modern browser with WebAuthn support
4. **Algorithm**: Only ES256 (secp256r1) is supported - some older authenticators may not support this

## Debugging

### Console Logs

The adapter logs key events with `[PasskeyWalletAdapter]` prefix:

- `Creating passkey wallet...` - New passkey creation
- `Found stored credentials, authenticating...` - Reconnection flow
- `Silent connect - restoring from storage...` - Auto-connect
- `Matched existing credential` - Successful match with stored key
- `No match found, confirming with second sign...` - New passkey detected

### Common Issues

1. **"Signature is not valid: Fails to verify"**
   - Public key mismatch between stored credential and actual passkey
   - Solution: Clear localStorage and reconnect

2. **"Add a passkey?" prompt on reconnect**
   - `getPasskeyInstance()` was called instead of `signAndRecover()`
   - Check if stored credentials exist

3. **Multiple sign prompts**
   - Normal for new passkeys (need 2 signs to confirm public key)
   - For existing passkeys, should only be 1 sign

## Managing Passkeys

### macOS

- System Settings → Passwords → Passkeys
- Or: Keychain Access → search for domain name

### Windows

- Settings → Accounts → Passkey settings

### Chrome

- chrome://settings/passkeys

## References

- [Mysten Labs Passkey Example](https://github.com/MystenLabs/passkey-example)
- [WebAuthn Specification](https://www.w3.org/TR/webauthn-2/)
- [Sui Passkey Documentation](https://docs.sui.io/guides/developer/cryptography/passkeys)
