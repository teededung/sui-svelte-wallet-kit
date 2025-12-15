# Sui Svelte Wallet Kit

> Status: This package is under active development and is not production‑ready yet. APIs and behavior may change without notice. Use for experimentation and development only.

A Svelte 5 wallet kit for the Sui blockchain. Ship wallet connection, multi‑account management, SuiNS names, SUI balance, transaction and message signing with simple components and typed utilities.

### Features

- **Wallet connection**: Detects popular Sui wallets and connects in one click
- **Pre-built UI**: `ConnectButton` and a responsive wallet `ConnectModal`
- **Auto-connect**: Persist selection and reconnect via `localStorage`
- **Multi-account**: Read all accounts, switch by index/address
- **Passkeys**: Built-in support for biometric authentication (Face ID, Touch ID)
- **Multisig**: Integrated N-of-M multisig support (create, sign, execute proposals)
- **SuiNS & balance**: Auto-fetch SuiNS names and SUI balance (configurable)
- **Signing**: Sign and execute transactions; optional message signing
- **Svelte 5 ready**: Built with runes (`$state`, `$effect`, `$props`) and full TypeScript types

### Installation

```bash
pnpm add sui-svelte-wallet-kit
# or
npm install sui-svelte-wallet-kit
```

Peer dependency:

```bash
pnpm add svelte@^5.0.0
```

### Quick Start

```svelte
<script>
	import { SuiModule, ConnectButton } from 'sui-svelte-wallet-kit';

	const onConnect = () => {
		console.log('Wallet connected');
	};
</script>

<SuiModule {onConnect} autoConnect={true}>
	<h1>My Sui dApp</h1>
	<ConnectButton class="connect-btn" />
</SuiModule>
```

### Wallet Configuration

You can customize wallet display names and ordering using the `walletConfig` prop:

```svelte
<script>
	import { SuiModule, ConnectButton } from 'sui-svelte-wallet-kit';

	const walletConfig = {
		// Custom display names for wallets
		customNames: {
			'Slush — A Sui wallet': 'Slush',
			'Martian Sui Wallet': 'Martian',
			'OKX Wallet': 'OKX',
			'OneKey Wallet': 'OneKey',
			'Surf Wallet': 'Surf',
			'TokenPocket Wallet': 'TokenPocket'
		},
		// Custom ordering (wallets not listed will appear after these in alphabetical order)
		ordering: [
			'Slush — A Sui wallet', // Show Slush first
			'OKX Wallet', // Then OKX
			'Phantom', // Then Phantom
			'Suiet', // Then Suiet
			'Martian Sui Wallet', // Then Martian
			'OneKey Wallet', // Then OneKey
			'Surf Wallet', // Then Surf
			'TokenPocket Wallet' // Then TokenPocket
		]
	};
</script>

<SuiModule {walletConfig} autoConnect={true}>
	<ConnectButton />
</SuiModule>
```

**Configuration Options:**

- `customNames`: Object mapping original wallet names to custom display names
- `ordering`: Array defining the preferred order of wallets in the connect modal

**Notes:**

- Use the exact wallet names as detected by the browser (check console for available names)
- Wallets not included in `ordering` will appear after the ordered ones, sorted alphabetically
- Custom names only affect display; internal wallet identification remains unchanged

### Components

#### SuiModule

Props:

- `onConnect?: () => void`
- `autoConnect?: boolean` (default: `false`)
- `autoSuiNS?: boolean` (default: `true`)
- `autoSuiBalance?: boolean` (default: `true`)
- `walletConfig?: { customNames?: Record<string, string>; ordering?: string[] }` (optional wallet customization)
- `zkLoginGoogle?: ZkLoginGoogleConfig` (optional Enoki zkLogin config)
- `passkey?: PasskeyConfig` (optional WebAuthn passkey wallet config)
- `multisig?: MultisigConfig` (optional multisig configuration)

#### ConnectButton

Props:

- `class?: string`
- `style?: string`
- `onWalletSelection?: (payload: { wallet: any; installed: boolean; connected: boolean; alreadyConnected?: boolean }) => void`

Behavior: toggles between Connect and Disconnect based on connection state. When not connected, clicking the button opens the modal and invokes `onWalletSelection` with a payload describing the user selection so you can show a toast if the selected wallet is not installed.

#### ConnectModal

Used internally by `SuiModule`. You can access it via `getConnectModal()` and call `openAndWaitForResponse()` to let users reselect wallets while connected. For convenience, you can also use the `switchWallet(options?)` helper (see API Reference).

UI notes:

- Installed wallets are labeled "Installed" and shown first.
- A toggle button "Show other wallets" reveals the rest. The modal has a built-in max-height and scroll for long lists.

```svelte
<script>
	import { switchWallet } from 'sui-svelte-wallet-kit';

	// Simple programmatic switch (modal stays open until an installed wallet is picked or user cancels)
	const simpleSwitch = async () => {
		const res = await switchWallet();
		if (res?.connected) {
			console.log('Switched to', res.wallet?.name);
		} else if (res?.cancelled) {
			console.log('Switch cancelled');
		}
	};
</script>
```

Detecting not-installed wallets from the Connect button:

```svelte
<script>
	import { ConnectButton } from 'sui-svelte-wallet-kit';

	const onWalletSelection = (payload) => {
		const picked = payload?.wallet ?? payload;
		const installed = typeof payload === 'object' ? !!payload?.installed : !!picked?.installed;
		if (!installed) {
			// Show your toast here
			console.log('[Demo] Please install:', picked?.name);
		}
	};
</script>

<ConnectButton class="connect-btn" {onWalletSelection} />
```

### Enoki zkLogin (Google)

Enable Google zkLogin via Enoki by passing the `zkLoginGoogle` config to `SuiModule`.

Requirements:

- Create an API key in the Enoki Portal: [Enoki Portal](https://enoki.mystenlabs.com/)
- Create a Google OAuth Client ID (typically ends with `.apps.googleusercontent.com`)

References:

- Enoki Signing In: [docs](https://docs.enoki.mystenlabs.com/ts-sdk/sign-in)
- Enoki HTTP API Specification: [docs](https://docs.enoki.mystenlabs.com/http-api/openapi)

Basic usage:

```svelte
<script>
	import { SuiModule, ConnectButton } from 'sui-svelte-wallet-kit';

	const zkLoginGoogle = {
		apiKey: 'ENOKI_API_KEY',
		googleClientId: 'GOOGLE_CLIENT_ID.apps.googleusercontent.com',
		// Optional: choose network: 'mainnet' | 'testnet' | 'devnet'
		network: 'testnet'
	};
</script>

<SuiModule {zkLoginGoogle} autoConnect={true}>
	<ConnectButton />
</SuiModule>
```

Notes:

- The "Sign in with Google" entry appears in the Connect modal only when `zkLoginGoogle` is provided and passes basic validation.
- The SDK probes your API key once via `GET /v1/app` for an early validity check.
- You can change networks by setting `zkLoginGoogle.network`. Default is: `mainnet`
- Check browser console logs for detailed hints emitted by `SuiModule`.

### Passkey Wallet (WebAuthn)

Enable passwordless wallet authentication using device biometrics (Face ID, Touch ID, Windows Hello).

```svelte
<script>
	import { SuiModule, ConnectButton } from 'sui-svelte-wallet-kit';

	const passkey = {
		rpId: window.location.hostname, // Must match your domain
		rpName: 'My Sui App' // Display name in passkey prompts
	};
</script>

<SuiModule {passkey} autoConnect={true}>
	<ConnectButton />
</SuiModule>
```

Configuration options:

| Option                    | Type                           | Required | Description                            |
| ------------------------- | ------------------------------ | -------- | -------------------------------------- |
| `rpId`                    | string                         | Yes      | Domain name (must match actual domain) |
| `rpName`                  | string                         | Yes      | Display name in passkey prompts        |
| `authenticatorAttachment` | 'platform' \| 'cross-platform' | No       | Device biometrics or security keys     |
| `icon`                    | data URL                       | No       | Custom wallet icon (base64 svg/png)    |

For detailed documentation including recovery flows, technical details, and troubleshooting, see [docs/PASSKEY_INTEGRATION.md](docs/PASSKEY_INTEGRATION.md).

### Multisig Support

Built-in support for **N-of-M** multisig transactions. Define static signers (DAO mode) or let users create their own multisig configurations (Dynamic mode). Supports mixing standard wallets, zkLogin, and Passkeys as signers.

```svelte
<script>
	const multisigConfig = {
		mode: 'dynamic', // or 'preconfigured'
		network: 'testnet',
		storageKey: 'my-multisig-config'
	};
</script>

<SuiModule {multisigConfig}>
	<!-- Your App -->
</SuiModule>
```

See the full guide: [docs/MULTISIG_GUIDE.md](docs/MULTISIG_GUIDE.md).

### API Reference

Exports from `sui-svelte-wallet-kit`:

- Components: `SuiModule`, `ConnectButton`, `ConnectModal`
- Connection: `connectWithModal(onSelection?)`, `getConnectModal`, `connect(wallet)`, `disconnect`, `switchWallet(options?)`
- Signing: `signAndExecuteTransaction(transaction)`, `signMessage(message)`, `canSignMessage()`
- Wallet info: `useCurrentWallet()`, `lastWalletSelection`
- Accounts: `useCurrentAccount()`, `useAccounts()`, `activeAccountIndex`, `switchAccount(selector)`, `setAccountLabel(name)`, `accountLoading`
- SuiNS: `suiNames`, `suiNamesLoading`, `suiNamesByAddress`
- Balance: `suiBalance`, `suiBalanceLoading`, `suiBalanceByAddress`, `refreshSuiBalance(address, options?)`
- SuiClient: `useSuiClient()`
- Discovery: `walletAdapters`, `availableWallets`
- Enoki/zkLogin: `isZkLoginWallet()`, `getZkLoginInfo()`
- Multisig: `useMultisig()`

Examples:

```svelte
<script>
	import {
		useCurrentAccount,
		useSuiClient,
		accountLoading,
		connectWithModal,
		switchWallet,
		disconnect,
		signAndExecuteTransaction,
		signMessage,
		canSignMessage,
		switchAccount,
		suiBalance,
		refreshSuiBalance,
		isZkLoginWallet,
		getZkLoginInfo
	} from 'sui-svelte-wallet-kit';
	import { Transaction } from '@mysten/sui/transactions';

	// Use hooks for reactive state
	let account = $derived(useCurrentAccount());
	let suiClient = $derived(useSuiClient());

	$effect(async () => {
		if (account && isZkLoginWallet()) {
			const info = await getZkLoginInfo();
			console.log('zkLogin session/metadata:', info);
		}
	});
</script>
```

### Styling

Override the modal by targeting its classes:

```css
:global(.modal-overlay) {
	background: rgba(0, 0, 0, 0.8);
}
:global(.modal-content) {
	background: #1a1a1a;
	border: 1px solid #333;
	border-radius: 16px;
}
:global(.wallet-button) {
	background: #2a2a2a;
	border: 1px solid #444;
	color: white;
}
:global(.wallet-button:hover) {
	border-color: #667eea;
	background: #333;
}
```

### Supported Wallets

Built on `@suiet/wallet-sdk` and Wallet Radar. Detects popular Sui wallets such as Slush, Suiet, Sui Wallet, Ethos, Surf, Glass, and others available in the browser.

### TypeScript

The package includes full TypeScript support with comprehensive type definitions for all components, utilities, and reactive stores.

#### Using Types in Your Project

Import types directly from the package:

```typescript
import type {
	SuiAccount,
	SuiWallet,
	WalletConfig,
	ZkLoginGoogleConfig,
	SignMessageResult,
	WalletSelectionPayload,
	ConnectionResult,
	SwitchWalletOptions
} from 'sui-svelte-wallet-kit';
```

#### Type-safe Component Usage

```svelte
<script lang="ts">
	import { SuiModule, ConnectButton } from 'sui-svelte-wallet-kit';
	import type {
		WalletConfig,
		ZkLoginGoogleConfig,
		WalletSelectionPayload
	} from 'sui-svelte-wallet-kit';

	// Type-safe configuration
	const walletConfig: WalletConfig = {
		ordering: ['Slush — A Sui wallet', 'OKX Wallet'],
		customNames: {
			'Slush — A Sui wallet': 'Slush'
		}
	};

	const zkLoginGoogle: ZkLoginGoogleConfig = {
		apiKey: 'your-api-key',
		googleClientId: 'your-client-id.apps.googleusercontent.com',
		network: 'testnet'
	};

	// Type-safe callback
	const onWalletSelection = (payload: WalletSelectionPayload): void => {
		console.log('Selected:', payload.wallet.name);
		console.log('Installed:', payload.installed);
	};

	const onConnect = (): void => {
		console.log('Connected!');
	};
</script>

<SuiModule {walletConfig} {zkLoginGoogle} {onConnect} autoConnect={true}>
	<ConnectButton {onWalletSelection} />
</SuiModule>
```

#### Type-safe State and Functions

All reactive stores and functions are fully typed:

```svelte
<script lang="ts">
	import {
		useCurrentAccount,
		useSuiClient,
		useCurrentWallet,
		suiBalance,
		switchAccount,
		signMessage,
		refreshSuiBalance
	} from 'sui-svelte-wallet-kit';
	import type { SuiAccount, SuiWallet, SignMessageResult, SuiClient } from 'sui-svelte-wallet-kit';

	// Use hooks for reactive state
	let account = $derived(useCurrentAccount());
	let client = $derived(useSuiClient());
	let currentWallet = $derived(useCurrentWallet());

	// Reactive values are type-safe
	$effect(() => {
		const a: SuiAccount | undefined = account;
		const c: SuiClient = client;
		const w: SuiWallet | undefined = currentWallet;
		const balance: string | null = suiBalance.value;

		console.log('Account:', a?.address);
		console.log('Client network:', c);
		console.log('Wallet:', w?.name);
		console.log('Balance:', balance);
	});

	const handleSwitchAccount = (index: number): boolean => switchAccount(index);

	const handleSignMessage = async (message: string): Promise<void> => {
		try {
			const result: SignMessageResult = await signMessage(message);
			console.log('Signature:', result.signature);
			console.log('Message bytes:', result.messageBytes);
		} catch (error) {
			console.error('Signing failed:', error);
		}
	};

	const handleRefreshBalance = async (address: string): Promise<void> => {
		const balance: string | null = await refreshSuiBalance(address, { force: true, ttlMs: 5000 });
		console.log('Refreshed balance:', balance);
	};

	const fetchBalance = async (): Promise<void> => {
		if (!account) return;
		const balance = await client.getBalance({ owner: account.address });
		console.log('Balance:', balance);
	};
</script>
```

#### Type-safe Wallet Switching

```svelte
<script lang="ts">
	import { switchWallet } from 'sui-svelte-wallet-kit';
	import type { SwitchWalletOptions, ConnectionResult, SuiWallet } from 'sui-svelte-wallet-kit';

	const handleSwitchWallet = async (): Promise<void> => {
		const options: SwitchWalletOptions = {
			onSelection: ({ wallet, installed }) => {
				console.log('Selected:', wallet.name, 'Installed:', installed);
			},
			shouldConnect: ({ selectedWallet, currentWallet }) => {
				// Skip if selecting same wallet
				return selectedWallet?.name !== currentWallet?.name;
			},
			onBeforeDisconnect: (current, selected) => {
				console.log('Switching from', current?.name, 'to', selected?.name);
			},
			onConnected: (wallet) => {
				console.log('Connected to:', wallet?.name);
			},
			onCancel: () => {
				console.log('Switch cancelled');
			}
		};

		const result: ConnectionResult = await switchWallet(options);

		if (result.connected) {
			console.log('Successfully switched to:', result.wallet?.name);
		} else if (result.cancelled) {
			console.log('User cancelled the switch');
		}
	};
</script>
```

#### Available Types

**Core Types:**

- `SuiAccount` - Account information with address, chains, label
- `SuiWallet` - Wallet information with name, icon, adapter
- `WalletConfig` - Configuration for wallet ordering and custom names
- `ZkLoginGoogleConfig` - Configuration for Enoki zkLogin with Google
- `ZkLoginInfo` - zkLogin session and metadata
- `PasskeyConfig` - Configuration for WebAuthn passkey wallet

**Result Types:**

- `SignMessageResult` - Message signature result with signature and messageBytes
- `ConnectionResult` - Connection/switch result with wallet info and status
- `WalletSelectionPayload` - Wallet selection payload with wallet and installed status

**Options Types:**

- `SwitchWalletOptions` - Options for `switchWallet()` with callbacks
- `RefreshBalanceOptions` - Options for `refreshSuiBalance(address, options?)` with force and TTL

**Store Types:**

- `ReadableStore<T>` - Base reactive store with `value` getter
- `AccountStore` - Account store with setAccount/removeAccount methods
- `SuiNamesStore` - SuiNS names store with clear method
- `LastWalletSelectionStore` - Last selection store with clear method

#### IntelliSense Benefits

With TypeScript enabled, you get:

- ✅ **Autocomplete** for all props, functions, and store properties
- ✅ **Type checking** catches errors at compile time
- ✅ **Inline documentation** via hover tooltips
- ✅ **Refactoring support** with safe renames across your codebase

#### Configuration

Ensure your `tsconfig.json` includes:

```json
{
	"compilerOptions": {
		"moduleResolution": "bundler",
		"strict": true
	}
}
```

### Development

```bash
# Install deps
pnpm i

# Build the package
pnpm run prepack

# Lint package exports
pnpm run lint:package

# Optional sanity check before publishing
./scripts/publish-check.sh
```

### License

MIT — see `LICENSE`.

### Links

- Repository: `https://github.com/teededung/sui-svelte-wallet-kit`
- Issues: `https://github.com/teededung/sui-svelte-wallet-kit/issues`

### More Usage Examples

Below are a few practical examples adapted from the demo page (`src/routes/+page.svelte`).

Connect, switch, disconnect with UX callbacks:

```svelte
<script>
	import {
		ConnectButton,
		connectWithModal,
		switchWallet,
		disconnect,
		useCurrentWallet
	} from 'sui-svelte-wallet-kit';

	const onWalletSelection = (payload) => {
		const picked = payload?.wallet ?? payload;
		const installed = typeof payload === 'object' ? !!payload?.installed : !!picked?.installed;
		if (!installed) alert('Please install the wallet: ' + picked?.name);
	};

	const onSwitchWallet = async () => {
		const currentWallet = $derived(useCurrentWallet());
		await switchWallet({
			onSelection: onWalletSelection,
			shouldConnect: ({ selectedWallet }) => {
				// Example: skip reconnecting to the same wallet if it lacks native account picker
				if (currentWallet?.name && selectedWallet?.name === currentWallet.name) return false;
				return true;
			}
		});
	};
</script>

<ConnectButton class="connect-btn" {onWalletSelection} />
<button onclick={onSwitchWallet}>Switch Wallet</button>
<button onclick={disconnect}>Disconnect</button>
```

Show account info, SuiNS, balance, and refresh balance:

```svelte
<script>
	import {
		useCurrentAccount,
		useAccounts,
		suiNames,
		suiNamesLoading,
		suiBalance,
		suiBalanceLoading,
		refreshSuiBalance
	} from 'sui-svelte-wallet-kit';

	let account = $derived(useCurrentAccount());

	const formatSui = (balance) => {
		try {
			const n = BigInt(balance);
			const whole = n / 1000000000n;
			const frac = n % 1000000000n;
			const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
			return fracStr ? `${whole}.${fracStr}` : whole.toString();
		} catch (_) {
			return balance ?? '0';
		}
	};
</script>

{#if account}
	<p><strong>Address:</strong> {account.address}</p>
	<p><strong>Chains:</strong> {account.chains?.join(', ') || 'N/A'}</p>
	{#if suiNamesLoading.value}
		<p><strong>SuiNS Names:</strong> Loading...</p>
	{:else}
		<p>
			<strong>SuiNS Names:</strong>
			{Array.isArray(suiNames.value) && suiNames.value.length > 0
				? suiNames.value.join(', ')
				: 'N/A'}
		</p>
	{/if}
	<p>
		<strong>SUI Balance:</strong>
		{#if suiBalanceLoading.value}
			Loading...
		{:else}
			{formatSui(suiBalance.value || '0')} SUI
		{/if}
	</p>
	<button
		onclick={() => refreshSuiBalance(account.address)}
		disabled={!account || suiBalanceLoading.value}
	>
		Refresh Balance
	</button>
{/if}
```

Sign and execute a simple transaction:

```svelte
<script>
	import { signAndExecuteTransaction, useCurrentAccount } from 'sui-svelte-wallet-kit';
	import { Transaction } from '@mysten/sui/transactions';

	let account = $derived(useCurrentAccount());
	let isLoading = false;
	let transactionResult = null;
	let error = null;

	const testTransaction = async () => {
		if (!account) {
			error = 'Please connect your wallet first';
			return;
		}
		isLoading = true;
		error = null;
		transactionResult = null;
		try {
			const tx = new Transaction();
			// Example: transfer 0 SUI to self (no-op); replace with your own commands
			tx.transferObjects([tx.splitCoins(tx.gas, [0])], account.address);
			transactionResult = await signAndExecuteTransaction(tx);
		} catch (err) {
			error = err?.message || 'Transaction failed';
		} finally {
			isLoading = false;
		}
	};
</script>

<button onclick={testTransaction} disabled={isLoading}>
	{isLoading ? 'Signing Transaction...' : 'Test Transaction (0 SUI transfer)'}
</button>
{#if error}
	<p style="color:#fca5a5">{error}</p>
{/if}
{#if transactionResult}
	<pre>{JSON.stringify(transactionResult, null, 2)}</pre>
{/if}
```

Sign a message (works with wallets supporting `sui:signMessage` or Enoki `sui:signPersonalMessage`):

```svelte
<script>
	import { canSignMessage, signMessage, useCurrentAccount } from 'sui-svelte-wallet-kit';

	let account = $derived(useCurrentAccount());
	let message = 'Hello, Sui blockchain!';
	let signatureResult = null;
	let isSigningMessage = false;
	let error = null;

	const testSignMessage = async () => {
		if (!account) {
			error = 'Please connect your wallet first';
			return;
		}
		isSigningMessage = true;
		error = null;
		signatureResult = null;
		try {
			signatureResult = await signMessage(message);
		} catch (err) {
			error = err?.message || 'Message signing failed';
		} finally {
			isSigningMessage = false;
		}
	};
</script>

{#if account}
	{#if canSignMessage()}
		<input bind:value={message} placeholder="Enter message to sign" />
		<button onclick={testSignMessage} disabled={isSigningMessage}>
			{isSigningMessage ? 'Signing Message...' : 'Sign Message'}
		</button>
	{:else}
		<p>Current wallet does not support message signing.</p>
	{/if}
{:else}
	<p>Connect your wallet to sign messages</p>
{/if}

{#if signatureResult}
	<p><strong>Signature:</strong> <code>{signatureResult.signature}</code></p>
{/if}
```

Show zkLogin (Enoki) session/metadata when connected via Google:

```svelte
<script>
	import { getZkLoginInfo, useCurrentAccount } from 'sui-svelte-wallet-kit';

	let account = $derived(useCurrentAccount());
	let zkInfo = null;

	$effect(async () => {
		zkInfo = account ? await getZkLoginInfo() : null;
	});
</script>

{#if zkInfo}
	<div>
		<strong>zkLogin (Enoki)</strong>
		{#if zkInfo.metadata}
			<p><strong>Provider:</strong> {zkInfo.metadata?.provider || 'N/A'}</p>
		{/if}
		{#if zkInfo.session}
			<p><strong>Session:</strong></p>
			<pre>{JSON.stringify(zkInfo.session, null, 2)}</pre>
		{:else}
			<p>No zkLogin session info.</p>
		{/if}
	</div>
{/if}
```

Account switching by index:

```svelte
<script>
	import { accounts, activeAccountIndex, switchAccount } from 'sui-svelte-wallet-kit';
	let selectedAccountIndex = -1;
	$effect(() => {
		selectedAccountIndex = activeAccountIndex.value;
	});
	const onAccountChange = () => switchAccount(Number(selectedAccountIndex));
</script>

{#if accounts.value.length > 1}
	<select bind:value={selectedAccountIndex} onchange={onAccountChange}>
		{#each accounts.value as acc, i}
			<option value={i} selected={i === activeAccountIndex.value}>
				#{i + 1} — {acc.address}
			</option>
		{/each}
	</select>
{/if}
```
