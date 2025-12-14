<script lang="ts">
	import {
		SuiModule,
		ConnectButton,
		useCurrentAccount,
		useCurrentWallet,
		type WalletConfig,
		type ZkLoginGoogleConfig,
		type MultisigConfig
	} from '$lib';
	import { PUBLIC_GOOGLE_CLIENT_ID, PUBLIC_ENOKI_API_KEY } from '$env/static/public';
	import MultisigDemo from './MultisigDemo.svelte';

	const account = $derived(useCurrentAccount());
	const currentWallet = $derived(useCurrentWallet());

	// Wallet configs (same as main page)
	const walletConfig: WalletConfig = {
		ordering: [
			'Sign in with Google',
			'Slush — A Sui wallet',
			'Passkey',
			'OKX Wallet',
			'Phantom',
			'Suiet'
		]
	};

	const zkLoginGoogle: ZkLoginGoogleConfig = {
		apiKey: PUBLIC_ENOKI_API_KEY,
		googleClientId: PUBLIC_GOOGLE_CLIENT_ID,
		network: 'testnet'
	};

	const passkeyConfig = {
		rpId: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
		rpName: 'Sui Svelte Wallet Kit Demo',
		authenticatorAttachment: 'cross-platform' as const
	};

	// Multisig config - Dynamic mode for user to setup
	const multisigConfig: MultisigConfig = {
		mode: 'dynamic',
		network: 'testnet',
		storageKey: 'multisig-demo-config',
		defaultThreshold: 2
	};
</script>

<SuiModule
	{zkLoginGoogle}
	{walletConfig}
	passkey={passkeyConfig}
	multisig={multisigConfig}
	autoConnect={true}
	autoSuiNS={true}
	autoSuiBalance={true}
>
	<div class="container">
		<header>
			<h1>Multisig Demo</h1>
			<p>Approval flow with signature collection</p>
		</header>

		<section class="card">
			<h2>1. Connect Wallet</h2>
			<ConnectButton class="connect-btn" />
			{#if account}
				<div class="info">
					<p><strong>Wallet:</strong> {currentWallet?.name || 'N/A'}</p>
					<p><strong>Address:</strong> {account.address}</p>
				</div>
			{/if}
		</section>

		<MultisigDemo />
	</div>
</SuiModule>

<style>
	.container {
		max-width: 980px;
		margin: 0 auto;
		padding: 2rem;
		color: #e5e7eb;
	}
	header {
		margin-bottom: 1rem;
	}
	header h1 {
		margin-bottom: 0.25rem;
	}
	header p {
		color: #94a3b8;
	}
	.card {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 14px;
		padding: 1.25rem;
		margin: 1rem 0;
		box-shadow: 0 12px 30px rgba(2, 6, 23, 0.55);
		backdrop-filter: blur(6px);
	}
	h2 {
		color: #e2e8f0;
		margin-bottom: 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
		padding-bottom: 0.5rem;
	}
	.info {
		margin-top: 0.75rem;
	}
	.info p {
		margin: 0.25rem 0;
	}
</style>
