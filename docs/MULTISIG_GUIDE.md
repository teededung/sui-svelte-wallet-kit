# Uniswap-style Multisig Integration Guide

This package provides a built-in `useMultisig` hook and reactive store for handling on-chain Multisig (Multi-Signature) transactions on Sui. It supports **N-of-M** threshold signing, where multiple signers (which can be standard wallets, zkLogin accounts, or Passkeys) must approve a transaction before it can be executed.

## Features

- **Pre-configured Mode**: Define a static list of signers and threshold (e.g., for a DAO or shared vault).
- **Dynamic Mode**: Allow users to add/remove signers client-side and persist the configuration.
- **Universal Signer Support**: Add any valid public key as a signer (Ed25519, Secp256k1, Secp256r1, zkLogin, Passkey).
- **Proposal Flow**: Create transaction proposals, collect signatures offline or via wallet switching, and execute when ready.
- **Auto-Resolution**: Automatically detects if the currently connected wallet is one of the required signers.

---

## 1. Setup

Enable Multisig by passing the `multisig` config prop to `SuiModule`.

### Option A: Dynamic Mode (User Configurable)

Best for demos or personal multisig management tools where the user defines their own signers.

```svelte
<script>
	import { SuiModule } from 'sui-svelte-wallet-kit';

	const multisigConfig = {
		mode: 'dynamic',
		network: 'testnet', // or 'mainnet'
		storageKey: 'my-app-multisig-config', // Persist config in localStorage
		defaultThreshold: 2
	};
</script>

<SuiModule {multisigConfig}>
	<!-- Your App -->
</SuiModule>
```

### Option B: Pre-configured Mode (Static)

Best for specific dApps that interact with a known, fixed multisig address.

```svelte
<script>
	import { SuiModule } from 'sui-svelte-wallet-kit';

	const multisigConfig = {
		mode: 'preconfigured',
		network: 'testnet',
		threshold: 2,
		signers: [
			{
				type: 'publicKey',
				publicKey: 'A/3x...', // base64 public key
				weight: 1
			},
			{
				type: 'publicKey',
				publicKey: 'B9/y...',
				weight: 1
			},
			{
				type: 'zklogin', // Example: Specific zkLogin account
				address: '0x123...',
				weight: 1
			}
		]
	};
</script>

<SuiModule {multisigConfig}>
	<!-- Your App -->
</SuiModule>
```

---

## 2. Using the Hook

Access the multisig state and actions using `useMultisig()` or the reactive store `multisigStore`.

```svelte
<script>
	import { useMultisig, useCurrentAccount } from 'sui-svelte-wallet-kit';
	import { Transaction } from '@mysten/sui/transactions';

	// Hook provides a snapshot of the state and async actions
	const { state, createProposal, addSignerFromCurrentWallet } = useMultisig();

	const account = $derived(useCurrentAccount());
</script>

{#if state.isReady}
	<p>Multisig Address: {state.address}</p>
	<p>Threshold: {state.threshold} / {state.totalWeight}</p>
{/if}
```

---

## 3. Creating a Proposal

A "Proposal" creates the transaction bytes but does not execute them. It prepares the transaction to be signed by multiple parties.

```typescript
const createTransfer = async () => {
	const tx = new Transaction();
	// Transfer 1 SUI to a recipient
	const coin = tx.splitCoins(tx.gas, [1000000000]);
	tx.transferObjects([coin], '0xRecipientAddress...');

	// Create proposal (this builds the transaction bytes)
	const proposal = await createProposal(tx);
	console.log('Proposal created:', proposal.id);
	return proposal;
};
```

**Note:** The multisig address must have enough SUI to pay for gas. You must fund `state.address` before executing transactions.

---

## 4. Collecting Signatures

The proposal object manages the collection of signatures.

```svelte
<script>
	let proposal = $state(null);

	const signWithWallet = async () => {
		if (!proposal) return;

		// specific action to sign with the currently connected wallet
		// if the wallet matches one of the signers in the config
		try {
			await proposal.signWithCurrentWallet();
			console.log('Signed successfully!');
		} catch (err) {
			console.error('Signing failed:', err);
		}
	};
</script>

<button onclick={signWithWallet}>Sign (Approve)</button>
```

### Signature Status

You can check which signers have signed:

```typescript
const status = proposal.getSignerStatus(signerId);
// { signed: true, signature: "..." }
```

---

## 5. Execution

Once the accumulated weight of signatures meets the threshold (`proposal.canExecute` is true), anyone can execute the transaction.

```typescript
const execute = async () => {
	if (proposal.canExecute) {
		const result = await proposal.execute();
		console.log('Transaction Executed:', result.digest);
	}
};
```

The `execute()` method automatically combines all collected signatures into a single multisig signature and submits the transaction to the network.

---

## API Reference

### `MultisigConfig`

| Property           | Type                           | Description                                       |
| ------------------ | ------------------------------ | ------------------------------------------------- |
| `mode`             | `'dynamic' \| 'preconfigured'` | Operation mode                                    |
| `threshold`        | `number`                       | Required weight to execute (Preconfigured mode)   |
| `signers`          | `MultisigSigner[]`             | Initial list of signers (Preconfigured mode)      |
| `defaultThreshold` | `number`                       | Default threshold (Dynamic mode)                  |
| `storageKey`       | `string`                       | LocalStorage key to persist config (Dynamic mode) |

### `MultisigSigner` Types

- **`publicKey`**: `{ type: 'publicKey', publicKey: string, weight?: number }`
- **`wallet`**: `{ type: 'wallet', address: string, weight?: number }`
- **`zklogin`**: `{ type: 'zklogin', address: string, weight?: number }`
- **`passkey`**: `{ type: 'passkey', address: string, weight?: number }`

---
