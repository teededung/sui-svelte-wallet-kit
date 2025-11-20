<script lang="ts">
	import {
		SuiModule,
		ConnectButton,
		useCurrentAccount,
		useCurrentWallet,
		useAccounts,
		switchAccount,
		activeAccountIndex,
		connectWithModal,
		disconnect,
		switchWallet,
		signAndExecuteTransaction,
		signMessage,
		canSignMessage,
		suiNames,
		suiNamesLoading,
		suiNamesByAddress,
		suiBalance,
		suiBalanceLoading,
		refreshSuiBalance,
		walletAdapters,
		getZkLoginInfo,
		useSuiClient
	} from '$lib';

	// Import types for better TypeScript support
	import type {
		WalletConfig,
		ZkLoginGoogleConfig,
		ZkLoginInfo,
		SignMessageResult,
		WalletSelectionPayload
	} from '$lib';

	import { Transaction } from '@mysten/sui/transactions';

	const account = $derived(useCurrentAccount());
	const accounts = $derived(useAccounts());
	const currentWallet = $derived(useCurrentWallet());
	const suiClient = $derived(useSuiClient());

	// State with type annotations
	let transactionResult = $state<any>(null);
	let signatureResult = $state<SignMessageResult | null>(null);
	let isLoading = $state<boolean>(false);
	let isSigningMessage = $state<boolean>(false);
	let error = $state<string | null>(null);
	let detectedAdapters = $state<any[]>([]);
	let message = $state<string>('Hello, Sui blockchain!');
	let selectedAccountIndex = $state<number>(-1);
	let zkInfo = $state<ZkLoginInfo | null>(null);
	let ownedObjects = $state<any>(null);
	let isLoadingObjects = $state<boolean>(false);
	import { PUBLIC_GOOGLE_CLIENT_ID, PUBLIC_ENOKI_API_KEY } from '$env/static/public';

	// Function with typed parameter and return type
	const formatSui = (balance: string | null | undefined): string => {
		try {
			const n = BigInt(balance ?? '0');
			const whole = n / 1000000000n;
			const frac = n % 1000000000n;
			const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
			return fracStr ? `${whole}.${fracStr}` : whole.toString();
		} catch (_) {
			return balance ?? '0';
		}
	};

	const onAccountChange = async (): Promise<void> => {
		switchAccount(Number(selectedAccountIndex));
	};

	// Whitelist wallets that support native account picker when re-selecting the same wallet
	const supportsAccountPicker = (walletNameStr: string | undefined): boolean => {
		const name = (walletNameStr || '').toLowerCase();
		return name.includes('slush');
	};

	const testTransaction = async (): Promise<void> => {
		if (!account) {
			error = 'Please connect your wallet first';
			return;
		}

		isLoading = true;
		error = null;
		transactionResult = null;

		try {
			// Create a simple test transaction (transfer 0 SUI to self)
			const tx = new Transaction();
			tx.transferObjects([tx.splitCoins(tx.gas, [0])], account.address);

			const result = await signAndExecuteTransaction(tx);
			transactionResult = result;
		} catch (err: any) {
			error = err.message || 'Transaction failed';
		} finally {
			isLoading = false;
		}
	};

	const testSignMessage = async (): Promise<void> => {
		if (!account) {
			error = 'Please connect your wallet first';
			return;
		}

		isSigningMessage = true;
		error = null;
		signatureResult = null;

		try {
			const result = await signMessage(message);
			signatureResult = result;
		} catch (err: any) {
			error = err.message || 'Message signing failed';
		} finally {
			isSigningMessage = false;
		}
	};

	const onConnect = (): void => {
		error = null;
		transactionResult = null;
		signatureResult = null;
		selectedAccountIndex = activeAccountIndex.value;
	};

	$effect(() => {
		selectedAccountIndex = activeAccountIndex.value;
	});

	$effect(() => {
		// Fetch zkLogin info when account changes
		if (account) {
			getZkLoginInfo()
				.then((info: ZkLoginInfo | null) => {
					zkInfo = info;
				})
				.catch(() => {
					zkInfo = null;
				});
		} else {
			zkInfo = null;
		}
	});

	const checkDetectedWallets = (): void => {
		detectedAdapters = Array.isArray(walletAdapters) ? walletAdapters : [];
	};

	const fetchOwnedObjects = async (): Promise<void> => {
		if (!account) {
			error = 'Please connect your wallet first';
			return;
		}

		if (!suiClient) {
			error = 'Sui client not found';
			return;
		}

		isLoadingObjects = true;
		error = null;
		ownedObjects = null;

		try {
			const objects = await suiClient.getOwnedObjects({
				owner: account.address,
				options: {
					showType: true,
					showContent: true,
					showDisplay: true
				},
				limit: 10
			});
			ownedObjects = objects;
		} catch (err: any) {
			error = err.message || 'Failed to fetch owned objects';
		} finally {
			isLoadingObjects = false;
		}
	};

	// Use packaged switchWallet with callbacks for custom UX
	const onSwitchWallet = async (): Promise<void> => {
		try {
			await switchWallet({
				onSelection: onWalletSelection,
				shouldConnect: ({ selectedWallet }: { selectedWallet: any }) => {
					if (
						currentWallet?.name &&
						selectedWallet?.name === currentWallet.name &&
						!supportsAccountPicker(selectedWallet.name)
					) {
						return false;
					}
					return true;
				}
			});
		} catch (err: any) {
			error = err?.message || 'Failed to switch wallet';
		}
	};

	// Capture selection when connecting via button (not connected state)
	const onWalletSelection = (payload: WalletSelectionPayload): void => {
		try {
			const selectedWallet = payload?.wallet ?? payload;
			const installed =
				typeof payload === 'object' ? !!payload?.installed : !!selectedWallet?.installed;
			if (!installed) {
				console.log('[Page] Selected wallet not installed:', selectedWallet?.name);
				alert('Please install the wallet: ' + selectedWallet?.name);
			}
		} catch {}
	};

	const walletConfig: WalletConfig = {
		// Custom ordering (wallets not listed will appear after these in alphabetical order)
		ordering: [
			'Sign in with Google', // Then Google
			'Slush — A Sui wallet', // Show Slush first
			'OKX Wallet', // Then OKX
			'Phantom', // Then Phantom
			'Suiet' // Then Suiet
		]
	};

	const zkLoginGoogle: ZkLoginGoogleConfig = {
		apiKey: PUBLIC_ENOKI_API_KEY,
		googleClientId: PUBLIC_GOOGLE_CLIENT_ID,
		network: 'testnet'
	};
</script>

<SuiModule
	{zkLoginGoogle}
	{walletConfig}
	{onConnect}
	autoConnect={true}
	autoSuiNS={true}
	autoSuiBalance={true}
>
	<div class="container">
		<header>
			<a
				class="github-link"
				href="https://github.com/teededung/sui-svelte-wallet-kit"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Open GitHub repository"
			>
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
					<path
						d="M12 2C6.477 2 2 6.486 2 12.021c0 4.424 2.865 8.176 6.839 9.504.5.093.682-.217.682-.483 0-.238-.009-.868-.013-1.704-2.782.606-3.369-1.343-3.369-1.343-.455-1.159-1.11-1.468-1.11-1.468-.908-.62.069-.607.069-.607 1.004.071 1.532 1.032 1.532 1.032.893 1.53 2.344 1.087 2.914.832.091-.649.35-1.087.636-1.337-2.222-.253-4.555-1.114-4.555-4.957 0-1.095.39-1.99 1.029-2.692-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.028A9.564 9.564 0 0 1 12 6.844c.852.004 1.709.115 2.51.338 1.91-1.298 2.748-1.028 2.748-1.028.546 1.378.203 2.397.1 2.65.64.702 1.028 1.597 1.028 2.692 0 3.853-2.337 4.701-4.566 4.949.36.311.68.923.68 1.86 0 1.343-.012 2.426-.012 2.758 0 .269.18.58.688.481A10.02 10.02 0 0 0 22 12.021C22 6.486 17.523 2 12 2Z"
					/>
				</svg>
			</a>
			<h1>Sui Svelte Wallet Kit</h1>
			<p>A Svelte developer toolkit for Sui blockchain wallet integration</p>
		</header>

		<div class="wallet-section">
			<h2>Wallet Connection</h2>
			<div class="testnet-notice">
				⚠️ Please change your wallet network to <strong>Testnet</strong>
			</div>
			<ConnectButton class="connect-btn" {onWalletSelection} />
			{#if account}
				<button class="action-btn" style="margin-left: 0.75rem;" onclick={onSwitchWallet}>
					Switch Wallet
				</button>
			{/if}

			{#if account}
				<div class="account-info">
					<h3>Connected Account</h3>
					{#if currentWallet?.name}
						<p><strong>Wallet:</strong> {currentWallet.name}</p>
					{/if}
					{#if currentWallet?.iconUrl}
						<p>
							<strong>Icon:</strong>
							<img
								src={currentWallet.iconUrl}
								alt="wallet icon"
								style="width:24px;height:24px;vertical-align:middle;border-radius:4px;"
							/>
						</p>
					{/if}
					<p><strong>Address:</strong> {account?.address || 'N/A'}</p>
					<p><strong>Label:</strong> {account?.label || 'N/A'}</p>
					<p><strong>Total Accounts:</strong> {accounts.length}</p>
					{#if accounts.length > 1}
						<div class="account-switcher">
							<label for="account-select"><strong>Switch account:</strong></label>
							<select
								id="account-select"
								bind:value={selectedAccountIndex}
								onchange={onAccountChange}
								class="account-select"
							>
								{#each accounts as acc, i}
									<option value={i} selected={i === activeAccountIndex.value}>
										#{i + 1} —
										{#if Array.isArray(suiNamesByAddress.value?.[acc.address]) && suiNamesByAddress.value[acc.address].length > 0}
											{suiNamesByAddress.value[acc.address][0]} ({acc.address})
										{:else}
											{acc.address}
										{/if}
									</option>
								{/each}
							</select>
						</div>
					{/if}
					{#if accounts.length > 1}
						<p><strong>All Accounts:</strong></p>
						<ul>
							{#each accounts as acc, i}
								<li>
									#{i + 1}: {acc.address}
								</li>
							{/each}
						</ul>
					{/if}
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
					<p><strong>Chains:</strong> {account?.chains?.join(', ') || 'N/A'}</p>
					{#if zkInfo}
						<div class="zklogin-box">
							<strong>zkLogin (Enoki)</strong>
							{#if zkInfo.metadata}
								<p><strong>Provider:</strong> {zkInfo.metadata?.provider || 'N/A'}</p>
							{/if}
							{#if zkInfo.session}
								<p><strong>Session:</strong></p>
								<pre class="zk-json">{JSON.stringify(zkInfo.session, null, 2)}</pre>
							{:else}
								<p>No zkLogin session info.</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#if account}
				{@const account = useCurrentAccount()}
				<div class="balance-box">
					<h3>SUI Balance</h3>

					<p>
						{#if suiBalanceLoading.value}
							Loading...
						{:else}
							<strong>{formatSui(suiBalance.value || '0')}</strong> SUI
						{/if}
					</p>
					<button
						class="action-btn"
						onclick={() => {
							if (account) refreshSuiBalance(account.address);
						}}
						disabled={!account || suiBalanceLoading.value}
					>
						Refresh Balance
					</button>
				</div>
			{/if}
		</div>

		<div class="transaction-section">
			<h2>Transaction Testing</h2>
			{#if account}
				<button class="test-btn" onclick={testTransaction} disabled={isLoading}>
					{isLoading ? 'Signing Transaction...' : 'Test Transaction (0 SUI transfer)'}
				</button>
			{:else}
				<p class="warning">Connect your wallet to test transactions</p>
			{/if}

			{#if error}
				<div class="error">
					<h4>Error:</h4>
					<p>{error}</p>
				</div>
			{/if}

			{#if transactionResult}
				<div class="result">
					<h4>Transaction Result:</h4>
					<pre>{JSON.stringify(transactionResult, null, 2)}</pre>
				</div>
			{/if}
		</div>

		<div class="message-section">
			<h2>Message Signing Test</h2>
			{#if account}
				{#if canSignMessage()}
					<div class="message-input">
						<label for="message">Message to sign:</label>
						<input
							id="message"
							type="text"
							bind:value={message}
							placeholder="Enter message to sign"
							class="message-field"
						/>
					</div>
					<button class="sign-btn" onclick={testSignMessage} disabled={isSigningMessage}>
						{isSigningMessage ? 'Signing Message...' : 'Sign Message'}
					</button>
				{:else}
					<div class="warning-box">
						<h4>⚠️ Message Signing Not Supported</h4>
						<p>
							Your current wallet does not support message signing. This feature requires a wallet
							that implements the <code>sui:signMessage</code> standard.
						</p>
						<p><strong>Some wallets that support message signing:</strong></p>
						<ul>
							<li>Slush Wallet</li>
							<li>Suiet Wallet</li>
							<li>OKX Wallet</li>
						</ul>
						<p>
							Please try connecting with a different wallet or check if your wallet has updates
							available.
						</p>
					</div>
				{/if}
			{:else}
				<p class="warning">Connect your wallet to sign messages</p>
			{/if}

			{#if signatureResult}
				<div class="result">
					<h4>Signature Result:</h4>
					<p><strong>Original Message:</strong> {message}</p>
					<p><strong>Message Bytes:</strong> <code>{signatureResult.messageBytes}</code></p>
					<strong>Signature:</strong>
					<p class="signature-details">
						<code class="signature">{signatureResult.signature}</code>
					</p>
				</div>
			{/if}
		</div>

		<div class="objects-section">
			<h2>Owned Objects (using hooks: useCurrentAccount & useSuiClient)</h2>
			{#if account}
				<button class="action-btn" onclick={fetchOwnedObjects} disabled={isLoadingObjects}>
					{isLoadingObjects ? 'Loading Objects...' : 'Fetch Owned Objects (limit: 10)'}
				</button>
			{:else}
				<p class="warning">Connect your wallet to fetch owned objects</p>
			{/if}

			{#if ownedObjects}
				<div class="result">
					<h4>Owned Objects Result:</h4>
					<p><strong>Total Objects:</strong> {ownedObjects.data?.length || 0}</p>
					{#if ownedObjects.data && ownedObjects.data.length > 0}
						<pre>{JSON.stringify(ownedObjects, null, 2)}</pre>
					{:else}
						<p>No objects found for this address.</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="actions-section">
			<h2>Available Actions</h2>
			<div class="action-buttons">
				{#if !account}
					<button class="action-btn" onclick={() => connectWithModal(onWalletSelection)}>
						Connect with Modal
					</button>
				{/if}
				<button class="action-btn" onclick={disconnect} disabled={!account}>Disconnect</button>
				<button class="action-btn" onclick={checkDetectedWallets}>Check Detected Wallets</button>
			</div>

			{#if detectedAdapters.length > 0}
				<div class="detected-wallets">
					<h4>Manually Detected Wallets:</h4>
					<ul>
						{#each detectedAdapters as adapter}
							<li>
								<img
									src={adapter.icon}
									alt={adapter.name}
									style="width:24px;height:24px;vertical-align:middle;border-radius:4px;"
								/>
								{adapter.name}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</div>
</SuiModule>

<style>
	:global(body) {
		background:
			radial-gradient(1200px circle at 10% 10%, #1f2a5b 0%, transparent 40%),
			radial-gradient(800px circle at 90% 20%, #5b2169 0%, transparent 35%),
			radial-gradient(1000px circle at 30% 90%, #0f766e 0%, transparent 40%),
			linear-gradient(180deg, #0b1021 0%, #0a0f2d 100%);
		color: #e5e7eb;
		min-height: 100vh;
		/* Avoid creating stacking contexts that would cover top-layer modals */
		isolation: auto;
	}

	.container {
		max-width: 960px;
		margin: 0 auto;
		padding: 2.5rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	header {
		text-align: center;
		margin-bottom: 3rem;
	}

	header :global(p) {
		color: #94a3b8;
	}

	.testnet-notice {
		margin-bottom: 1.25rem;
		padding: 0.875rem 1.25rem;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(99, 102, 241, 0.12));
		border: 1px solid rgba(96, 165, 250, 0.35);
		border-left: 4px solid #60a5fa;
		border-radius: 10px;
		color: #bfdbfe;
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		backdrop-filter: blur(6px);
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
	}

	.testnet-notice strong {
		color: #93c5fd;
		font-weight: 600;
	}

	h1 {
		margin-bottom: 0.5rem;
		background: linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		letter-spacing: 0.3px;
	}

	.wallet-section,
	.transaction-section,
	.message-section,
	.objects-section,
	.actions-section {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 14px;
		padding: 1.5rem;
		margin-bottom: 2rem;
		box-shadow: 0 12px 30px rgba(2, 6, 23, 0.55);
		backdrop-filter: blur(6px);
	}

	h2 {
		color: #e2e8f0;
		margin-bottom: 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
		padding-bottom: 0.5rem;
	}

	.account-info {
		margin-top: 1rem;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.account-info h3 {
		color: #34d399;
		margin-bottom: 0.5rem;
	}

	.account-info p {
		margin: 0.25rem 0;
		font-family: monospace;
		font-size: 0.9rem;
		color: #cbd5e1;
	}

	:global(.connect-btn) {
		background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899);
		background-size: 200% 200%;
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.18);
		padding: 0.75rem 1.5rem;
		border-radius: 10px;
		font-size: 1rem;
		cursor: pointer;
		transition:
			background-position 0.25s ease,
			transform 0.15s ease,
			box-shadow 0.25s ease;
		box-shadow: 0 10px 25px rgba(99, 102, 241, 0.35);
	}

	:global(.connect-btn:hover) {
		background-position: 100% 0%;
		transform: translateY(-1px);
		box-shadow: 0 12px 28px rgba(99, 102, 241, 0.45);
	}

	.test-btn {
		background: linear-gradient(135deg, #10b981, #14b8a6);
		color: white;
		border: 1px solid rgba(16, 185, 129, 0.35);
		padding: 0.75rem 1.5rem;
		border-radius: 10px;
		font-size: 1rem;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			filter 0.2s ease;
		box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3);
	}

	.test-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
		box-shadow: 0 14px 28px rgba(16, 185, 129, 0.35);
	}

	.test-btn:disabled {
		background: #475569;
		border-color: rgba(148, 163, 184, 0.25);
		cursor: not-allowed;
	}

	.warning {
		color: #facc15;
		font-style: italic;
	}

	.error {
		background: rgba(220, 38, 38, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.35);
		color: #fecaca;
		padding: 1rem;
		border-radius: 10px;
		margin-top: 1rem;
	}

	.result {
		background: rgba(16, 185, 129, 0.12);
		border: 1px solid rgba(16, 185, 129, 0.35);
		color: #bbf7d0;
		padding: 1rem;
		border-radius: 10px;
		margin-top: 1rem;
	}

	.result pre {
		background: rgba(2, 6, 23, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.08);
		padding: 1rem;
		border-radius: 8px;
		overflow-x: auto;
		font-size: 0.8rem;
		margin-top: 0.5rem;
		color: #e5e7eb;
	}

	.action-buttons {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.balance-box {
		margin-top: 1rem;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.action-btn {
		background: linear-gradient(135deg, #3b82f6, #6366f1);
		color: white;
		border: 1px solid rgba(99, 102, 241, 0.35);
		padding: 0.75rem 1.5rem;
		font-size: 1rem;
		border-radius: 10px;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			filter 0.2s ease;
		box-shadow: 0 10px 20px rgba(99, 102, 241, 0.25);
	}

	.action-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
		box-shadow: 0 14px 28px rgba(99, 102, 241, 0.35);
	}

	.action-btn:disabled {
		background: #475569;
		border-color: rgba(148, 163, 184, 0.25);
		cursor: not-allowed;
	}

	/* GitHub link button */
	header {
		position: relative;
	}

	.github-link {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		color: #e5e7eb;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.18);
		backdrop-filter: blur(4px);
		text-decoration: none;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			background 0.2s ease;
		box-shadow: 0 6px 16px rgba(2, 6, 23, 0.45);
	}

	.github-link:hover {
		transform: translateY(-1px);
		background: rgba(255, 255, 255, 0.12);
		box-shadow: 0 10px 22px rgba(2, 6, 23, 0.55);
	}

	/* Responsive tweaks for mobile */
	@media (max-width: 640px) {
		.container {
			padding: 1rem;
		}
		.github-link {
			position: fixed;
			top: calc(env(safe-area-inset-top, 0px) + 10px);
			right: calc(env(safe-area-inset-right, 0px) + 10px);
			width: 40px;
			height: 40px;
			z-index: 50;
		}

		header {
			padding-top: 0.75rem;
		}

		/* Stack action buttons vertically and avoid overflow */
		.wallet-section :global(.connect-btn),
		.wallet-section .action-btn {
			display: block;
			width: 100%;
		}

		.wallet-section .action-btn {
			margin-left: 0 !important;
			margin-top: 0.75rem;
		}

		/* Prevent long strings (addresses, etc.) from overflowing */
		.account-info p,
		.account-info li {
			word-break: break-all;
			overflow-wrap: anywhere;
		}

		/* Ensure selects fit viewport */
		.account-select {
			max-width: 100%;
		}
	}

	.detected-wallets {
		margin-top: 1rem;
		padding: 1rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.detected-wallets h4 {
		color: #e2e8f0;
		margin-bottom: 0.5rem;
	}

	.detected-wallets ul {
		margin: 0;
		padding-left: 1.5rem;
	}

	.detected-wallets li {
		margin: 0.25rem 0;
		font-family: monospace;
		color: #cbd5e1;
	}

	.message-input {
		margin-bottom: 1rem;
	}

	.message-input label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: #e5e7eb;
	}

	.message-field {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem;
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 10px;
		font-size: 1rem;
		font-family: inherit;
		transition:
			border-color 0.2s,
			box-shadow 0.2s,
			background-color 0.2s;
		background: rgba(255, 255, 255, 0.05);
		color: #e5e7eb;
		backdrop-filter: blur(4px);
	}

	.message-field::placeholder {
		color: #9ca3af;
	}

	.message-field:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow:
			0 0 0 3px rgba(99, 102, 241, 0.35),
			0 0 0 1px #6366f1;
		background: rgba(255, 255, 255, 0.07);
	}

	.sign-btn {
		background: linear-gradient(135deg, #ec4899, #8b5cf6);
		color: white;
		border: 1px solid rgba(139, 92, 246, 0.35);
		padding: 0.75rem 1.5rem;
		border-radius: 10px;
		font-size: 1rem;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			filter 0.2s ease;
		box-shadow: 0 10px 22px rgba(236, 72, 153, 0.25);
	}

	.sign-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
		box-shadow: 0 14px 28px rgba(139, 92, 246, 0.35);
	}

	.sign-btn:disabled {
		background: #475569;
		border-color: rgba(148, 163, 184, 0.25);
		cursor: not-allowed;
	}

	.signature-details code {
		background: rgba(255, 255, 255, 0.07);
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-size: 0.8rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #e2e8f0;
	}

	.signature {
		display: block;
		max-width: 100%;
		overflow-wrap: break-word;
	}

	.warning-box {
		background: rgba(250, 204, 21, 0.12);
		border: 1px solid rgba(245, 158, 11, 0.35);
		border-radius: 10px;
		padding: 1.5rem;
		color: #fde68a;
	}

	.warning-box h4 {
		margin-top: 0;
		margin-bottom: 1rem;
		color: #fbbf24;
	}

	.warning-box p {
		margin: 0.75rem 0;
		line-height: 1.6;
	}

	.warning-box ul {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}

	.warning-box li {
		margin: 0.25rem 0;
	}

	.warning-box code {
		background: rgba(251, 191, 36, 0.25);
		color: #fde68a;
		padding: 0.125rem 0.25rem;
		border-radius: 4px;
		font-size: 0.875rem;
		border: 1px solid rgba(245, 158, 11, 0.35);
	}
	.zk-json {
		font-size: 0.75rem;
		background: #0b1220;
		color: #cbd5e1;
		padding: 8px;
		border-radius: 6px;
		overflow: auto;
	}
	.zklogin-box {
		margin-top: 8px;
		padding: 8px;
		border: 1px solid #1f2937;
		border-radius: 8px;
		background: #0a0f1a;
	}
</style>
