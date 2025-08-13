# Sui Svelte Wallet Kit

A Svelte 5 wallet kit for the Sui blockchain. Ship wallet connection, multi‑account management, SuiNS names, SUI balance, transaction and message signing with simple components and typed utilities.

### Features

- **Wallet connection**: Detects popular Sui wallets and connects in one click
- **Pre-built UI**: `ConnectButton` and a responsive wallet `ConnectModal`
- **Auto-connect**: Persist selection and reconnect via `localStorage`
- **Multi-account**: Read all accounts, switch by index/address
- **SuiNS & balance**: Auto-fetch SuiNS names and SUI balance (configurable)
- **Signing**: Sign and execute transactions; optional message signing
- **Svelte 5 ready**: Built with runes (`$state`, `$effect`, `$props`) and full TypeScript types

### Installation

```bash
yarn add sui-svelte-wallet-kit
# or
npm install sui-svelte-wallet-kit
```

Peer dependency:

```bash
yarn add svelte@^5.0.0
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

### Components

#### SuiModule

Props:

- `onConnect?: () => void`
- `autoConnect?: boolean` (default: `false`)
- `autoSuiNS?: boolean` (default: `true`)
- `autoSuiBalance?: boolean` (default: `true`)

#### ConnectButton

Props:

- `class?: string`
- `style?: string`

Behavior: toggles between Connect and Disconnect based on `account.value`.

#### ConnectModal

Used internally by `SuiModule`. You can access it via `getConnectModal()` and call `openAndWaitForResponse()` to let users reselect wallets while connected.

```svelte
<script>
	import { getConnectModal, connect, disconnect, walletName } from 'sui-svelte-wallet-kit';

	const switchWallet = async () => {
		const modal = getConnectModal?.();
		if (!modal) return;
		const picked = await modal.openAndWaitForResponse();
		if (!picked) return;
		try {
			disconnect();
		} catch {}
		await connect(picked);
	};
</script>
```

### API Reference

Exports from `sui-svelte-wallet-kit`:

- Components: `SuiModule`, `ConnectButton`, `ConnectModal`
- Connection: `connectWithModal`, `getConnectModal`, `connect(wallet)`, `disconnect`
- Signing: `signAndExecuteTransaction(transaction)`, `signMessage(message)`, `canSignMessage()`
- Wallet info: `wallet`, `walletName`, `walletIconUrl`
- Accounts: `account`, `accounts`, `accountsCount`, `activeAccountIndex`, `switchAccount(selector)`, `setAccountLabel(name)`
- SuiNS: `suiNames`, `suiNamesLoading`, `suiNamesByAddress`
- Balance: `suiBalance`, `suiBalanceLoading`, `suiBalanceByAddress`, `refreshSuiBalance(address?, { force?: boolean })`
- Discovery: `walletAdapters`, `availableWallets`

Examples:

```svelte
<script>
	import {
		account,
		connectWithModal,
		disconnect,
		signAndExecuteTransaction,
		signMessage,
		canSignMessage,
		switchAccount,
		suiBalance,
		refreshSuiBalance
	} from 'sui-svelte-wallet-kit';
	import { Transaction } from '@mysten/sui/transactions';

	const connectNow = () => connectWithModal();
	const logout = () => disconnect();

	const sendTx = async () => {
		const tx = new Transaction();
		tx.transferObjects([tx.splitCoins(tx.gas, [0])], account.value.address);
		await signAndExecuteTransaction(tx);
	};

	const signMsg = async () => {
		if (!canSignMessage()) return;
		const res = await signMessage('hello');
		console.log(res.signature, res.messageBytes);
	};
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

### Examples

See `src/routes/+page.svelte` for a full working demo including connect, account info, SuiNS, balance, transaction and message signing.

### TypeScript

All exports are typed. You can use them in TS Svelte files directly.

### Development

```bash
# Install deps
yarn install

# Build the package
yarn run prepack

# Lint package exports
yarn run lint:package

# Optional sanity check before publishing
./scripts/publish-check.sh
```

### License

MIT — see `LICENSE`.

### Links

- Repository: `https://github.com/teededung/sui-svelte-wallet-kit`
- Issues: `https://github.com/teededung/sui-svelte-wallet-kit/issues`
