<script lang="ts">
	import { useMultisig, useCurrentAccount, useCurrentWallet } from '$lib';
	import type { MultisigProposal } from '$lib/MultisigService/MultisigTypes.js';
	import { Transaction } from '@mysten/sui/transactions';

	const account = $derived(useCurrentAccount());
	const currentWallet = $derived(useCurrentWallet());
	const store = useMultisig();

	let configError = $state<string | null>(null);
	let buildError = $state<string | null>(null);
	let signError = $state<string | null>(null);
	let execError = $state<string | null>(null);
	let busy = $state(false);

	// Proposal state
	let proposal = $state<MultisigProposal | null>(null);
	let recipient = $state<string>('');
	let executeResult = $state<any>(null);
	let signatureVersion = $state(0); // Force reactivity on signature changes

	const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

	// Update signer weight
	const updateSignerWeight = (signerId: string, newWeight: number) => {
		store.updateSignerWeight(signerId, newWeight);
		store.saveConfig();
	};

	// Build proposal
	const buildProposal = async () => {
		buildError = null;
		executeResult = null;
		busy = true;
		try {
			if (!store.address) throw new Error('Multisig address not ready');

			const tx = new Transaction();
			const target = recipient || store.address;
			tx.transferObjects([tx.splitCoins(tx.gas, [0])], target);

			proposal = await store.createProposal(tx);
		} catch (e: any) {
			buildError = e?.message || 'Failed to build proposal';
		} finally {
			busy = false;
		}
	};

	// Sign for a specific signer
	const signForSigner = async (signerId: string) => {
		signError = null;
		busy = true;
		try {
			if (!proposal) throw new Error('Build proposal first');

			await proposal.signWithCurrentWallet();
			// Force reactivity update
			signatureVersion++;
		} catch (e: any) {
			signError = e?.message || 'Failed to sign';
		} finally {
			busy = false;
		}
	};

	// Check if current wallet matches a signer
	const isCurrentWalletMatchingSigner = (signerAddress: string | undefined): boolean => {
		if (!account?.address || !signerAddress) return false;
		return account.address === signerAddress;
	};

	// Execute transaction
	const executeTransaction = async () => {
		configError = null;
		execError = null;
		busy = true;
		try {
			if (!proposal) throw new Error('No proposal');
			if (!proposal.canExecute) throw new Error('Not enough signatures');

			executeResult = await proposal.execute();
		} catch (e: any) {
			execError = e?.message || 'Execution failed';
		} finally {
			busy = false;
		}
	};

	// Reset proposal
	const resetProposal = () => {
		proposal = null;
		executeResult = null;
		buildError = null;
		signError = null;
		execError = null;
		signatureVersion = 0;
	};

	// Get signature status for display (signatureVersion forces reactivity)
	const getSignerSigStatus = (signerId: string) => {
		// Reference signatureVersion to trigger reactivity
		const _ = signatureVersion;
		if (!proposal) return { signed: false };
		return proposal.getSignerStatus(signerId);
	};

	// Derived values that depend on signatureVersion for reactivity
	const proposalSignedWeight = $derived.by(() => {
		const _ = signatureVersion;
		return proposal?.signedWeight ?? 0;
	});

	const proposalCanExecute = $derived.by(() => {
		const _ = signatureVersion;
		return proposal?.canExecute ?? false;
	});
</script>

<!-- Section 2: Configure Multisig -->
<section class="card">
	<h2>2. Configure Multisig</h2>
	<p class="hint">Mode: <strong>{store.mode || 'Not configured'}</strong></p>

	<div class="row">
		<label class="field">
			<div class="label">Threshold</div>
			<input
				type="number"
				min="1"
				value={store.threshold}
				oninput={(e) => {
					const val = parseInt((e.target as HTMLInputElement).value);
					if (val >= 1) {
						store.setThreshold(val);
						store.saveConfig();
					}
				}}
			/>
		</label>
		<div class="field" style="flex: 1; min-width: 320px;">
			<div class="label">Derived Multisig Address</div>
			<div class="mono">{store.address || '—'}</div>
		</div>
	</div>

	<div class="row">
		<button
			class="btn primary"
			onclick={async () => {
				try {
					configError = null;
					busy = true;
					await store.addSignerFromCurrentWallet({ weight: 1 });
					store.saveConfig();
				} catch (e: any) {
					configError = e?.message || 'Failed to add signer';
				} finally {
					busy = false;
				}
			}}
			disabled={busy || !account}
		>
			Add signer from current wallet
		</button>
		<button
			class="btn"
			onclick={() => {
				store.clearConfig();
				resetProposal();
				configError = null;
			}}
			disabled={busy}
		>
			Clear saved demo data
		</button>
	</div>

	{#if configError}
		<div class="error">
			<strong>Configuration Error:</strong>
			{configError}
		</div>
	{/if}

	<h3>Signers ({store.signers.length})</h3>
	{#if store.signers.length === 0}
		<p class="hint">No signers yet. Click "Add signer from current wallet".</p>
	{:else}
		<div class="signers-grid">
			{#each store.signers as signer (signer.id)}
				<div class="signer">
					<div class="row" style="justify-content: space-between;">
						<div class="signer-title">
							{signer.name || signer.id}
							{#if signer.address}
								<span class="signer-addr">({shortAddr(signer.address)})</span>
							{/if}
						</div>
						<button
							class="btn-small"
							onclick={() => {
								store.removeSigner(signer.id);
								store.saveConfig();
								configError = null;
							}}>Remove</button
						>
					</div>
					<div class="row">
						<div class="field">
							<div class="label">type</div>
							<div class="type-badge">{signer.type}</div>
						</div>
						<div class="field">
							<div class="label">weight</div>
							<input
								type="number"
								min="1"
								value={signer.weight}
								oninput={(e) => {
									const val = parseInt((e.target as HTMLInputElement).value);
									if (val >= 1) updateSignerWeight(signer.id, val);
								}}
							/>
						</div>
						<div class="field">
							<div class="label">status</div>
							<span class="status-badge" class:resolved={signer.resolved}>
								{signer.resolved ? '✅ Resolved' : '⏳ Pending'}
							</span>
						</div>
					</div>
					{#if signer.publicKeyBase64}
						<div class="pubkey-row">
							<span class="label">publicKey (base64):</span>
							<input type="text" class="pubkey-input" value={signer.publicKeyBase64} readonly />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="status-bar">
		<span>Total Weight: <strong>{store.totalWeight}</strong></span>
		<span>Threshold: <strong>{store.threshold}</strong></span>
		<span>Resolved: <strong>{store.resolvedCount}/{store.signers.length}</strong></span>
		<span>Ready: <strong class:ready={store.isReady}>{store.isReady ? 'Yes' : 'No'}</strong></span>
	</div>

	{#if store.threshold > store.totalWeight && store.signers.length > 0}
		<p class="warning">
			⚠️ Threshold ({store.threshold}) > Total Weight ({store.totalWeight}). Add more signers or
			reduce threshold.
		</p>
	{/if}
</section>

<!-- Section 3: Build Proposal -->
<section class="card" class:disabled={!store.isReady}>
	<h2>3. Build Proposal (tx bytes)</h2>
	<div class="row" style="align-items: flex-end;">
		<label class="field" style="flex: 1;">
			<div class="label">Recipient (default: multisig self)</div>
			<input
				type="text"
				bind:value={recipient}
				placeholder={store.address || ''}
				style="width: 100%;"
			/>
		</label>
		<button class="btn primary" onclick={buildProposal} disabled={busy || !store.isReady}>
			Build proposal
		</button>
		<button class="btn" onclick={resetProposal} disabled={busy}>Reset</button>
	</div>

	{#if buildError}
		<div class="error">
			<strong>Error:</strong>
			{buildError}
		</div>
	{/if}

	{#if proposal}
		<div class="mono" style="margin-top: 0.5rem;">
			<strong>Proposal ID:</strong>
			{proposal.id}
		</div>
	{/if}
	<p class="hint">
		Before building/signing, you must <strong>fund multisig address</strong>
		({shortAddr(store.address || '')}) with some SUI so it has a gas coin.
	</p>
</section>

<!-- Section 4: Collect Signatures -->
<section class="card" class:disabled={!proposal}>
	<h2>4. Collect Signatures</h2>

	<div class="current-wallet-info">
		<strong>Current wallet:</strong>
		<span class="mono">
			{account?.address
				? `${currentWallet?.name || ''} (${shortAddr(account.address)})`
				: '— Not connected —'}
		</span>
	</div>

	<p class="hint">
		Switch to each signer's wallet and click Sign. The button is enabled when your current wallet
		matches the signer.
	</p>

	<div class="signers-sign-grid">
		{#each store.signers as signer (signer.id)}
			{@const status = getSignerSigStatus(signer.id)}
			{@const isMatch = isCurrentWalletMatchingSigner(signer.address)}
			<div class="signer-sign-row" class:signed={status.signed} class:active={isMatch}>
				<div class="signer-info">
					<div class="signer-name">
						{signer.name || signer.id}
						<span class="signer-weight">(w={signer.weight})</span>
					</div>
					<div class="signer-address mono">{signer.address || '—'}</div>
				</div>
				<div class="signer-status">
					{#if status.signed}
						<span class="signed-badge">✅ Signed</span>
					{:else if isMatch}
						<span class="match-badge">← Your wallet</span>
					{:else}
						<span class="pending-badge">⏳ Pending</span>
					{/if}
				</div>
				<button
					class="btn sign-btn"
					class:primary={isMatch && !status.signed}
					onclick={() => signForSigner(signer.id)}
					disabled={busy || !proposal || !isMatch || status.signed}
				>
					{status.signed ? 'Signed' : 'Sign'}
				</button>
			</div>
		{/each}
	</div>

	{#if signError}
		<div class="error">
			<strong>Signing Error:</strong>
			{signError}
		</div>
	{/if}

	{#if proposal}
		<div class="status-bar" style="margin-top: 0.75rem;">
			<span>Signed Weight: <strong>{proposalSignedWeight}</strong> / {store.threshold}</span>
			<span
				>Can Execute: <strong class:ready={proposalCanExecute}
					>{proposalCanExecute ? 'Yes' : 'No'}</strong
				></span
			>
		</div>
	{/if}
</section>

<!-- Section 5: Execute -->
<section class="card" class:disabled={!proposal}>
	<h2>5. Combine & Execute</h2>
	<button class="btn primary" onclick={executeTransaction} disabled={busy || !proposalCanExecute}>
		Combine & Execute
	</button>

	{#if execError}
		<div class="error">
			<strong>Execution Error:</strong>
			{execError}
		</div>
	{/if}

	{#if executeResult}
		<div class="result">
			<h3>Execute Result</h3>
			<pre>{JSON.stringify(executeResult, null, 2)}</pre>
		</div>
	{/if}
</section>

<style>
	.card {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 14px;
		padding: 1.25rem;
		margin: 1rem 0;
		box-shadow: 0 12px 30px rgba(2, 6, 23, 0.55);
		backdrop-filter: blur(6px);
		transition:
			opacity 0.3s ease,
			filter 0.3s ease;
	}
	.card.disabled {
		opacity: 0.5;
		pointer-events: none;
		filter: grayscale(0.5);
	}
	h2 {
		color: #e2e8f0;
		margin-bottom: 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
		padding-bottom: 0.5rem;
	}
	h3 {
		color: #cbd5e1;
		margin: 1rem 0 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin: 0.75rem 0;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 100px;
	}
	.label {
		font-size: 0.85rem;
		color: #cbd5e1;
	}
	input {
		background: rgba(255, 255, 255, 0.06);
		color: #e5e7eb;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 10px;
		padding: 0.55rem 0.65rem;
	}
	input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.6);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
	}
	input[type='number'] {
		width: 70px;
	}
	.btn {
		background: #3b82f6;
		color: white;
		border: 1px solid rgba(99, 102, 241, 0.35);
		padding: 0.65rem 1rem;
		border-radius: 10px;
		cursor: pointer;
	}
	.btn.primary {
		background: #10b981;
		border-color: rgba(16, 185, 129, 0.35);
	}
	.btn:disabled {
		background: #475569;
		border-color: rgba(148, 163, 184, 0.25);
		cursor: not-allowed;
	}
	.btn-small {
		background: #ef4444;
		color: white;
		border: none;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		word-break: break-all;
		color: #93c5fd;
	}
	.hint {
		color: #fde68a;
		margin: 0.75rem 0;
	}
	.signers-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	.signer {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		padding: 0.75rem;
	}
	.signer-title {
		font-weight: 700;
		color: #93c5fd;
	}
	.signer-addr {
		font-weight: 400;
		font-size: 0.85rem;
		color: #94a3b8;
		font-family: monospace;
	}
	.type-badge {
		background: rgba(99, 102, 241, 0.2);
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		font-size: 0.8rem;
		color: #a5b4fc;
	}
	.status-badge {
		font-size: 0.85rem;
		color: #fbbf24;
	}
	.status-badge.resolved {
		color: #34d399;
	}
	.pubkey-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		width: 100%;
	}
	.pubkey-input {
		flex: 1;
		font-family: monospace;
		font-size: 0.75rem;
		color: #a5b4fc;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
		width: 100%;
	}
	.status-bar {
		display: flex;
		gap: 1.5rem;
		margin-top: 1rem;
		padding: 0.75rem;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 8px;
		flex-wrap: wrap;
	}
	.status-bar strong {
		color: #60a5fa;
	}
	.status-bar .ready {
		color: #34d399;
	}
	.warning {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: rgba(251, 191, 36, 0.12);
		border: 1px solid rgba(251, 191, 36, 0.35);
		border-radius: 10px;
		color: #fde68a;
	}
	.error {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: rgba(220, 38, 38, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.35);
		border-radius: 10px;
		color: #fecaca;
	}
	.result {
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: rgba(16, 185, 129, 0.12);
		border: 1px solid rgba(16, 185, 129, 0.35);
		border-radius: 10px;
		color: #bbf7d0;
	}
	.result pre {
		background: rgba(2, 6, 23, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.08);
		padding: 0.75rem;
		border-radius: 8px;
		overflow: auto;
		font-size: 0.8rem;
		max-height: 300px;
	}
	.current-wallet-info {
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.3);
		border-radius: 10px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.signers-sign-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0.75rem 0;
	}
	.signer-sign-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		transition: all 0.2s ease;
	}
	.signer-sign-row.active {
		background: rgba(16, 185, 129, 0.08);
		border-color: rgba(16, 185, 129, 0.4);
	}
	.signer-sign-row.signed {
		background: rgba(99, 102, 241, 0.08);
		border-color: rgba(99, 102, 241, 0.3);
	}
	.signer-info {
		flex: 1;
		min-width: 0;
	}
	.signer-name {
		font-weight: 600;
		color: #e2e8f0;
	}
	.signer-weight {
		font-weight: 400;
		color: #94a3b8;
		font-size: 0.85rem;
	}
	.signer-address {
		font-size: 0.75rem;
		color: #64748b;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.signer-status {
		min-width: 100px;
		text-align: center;
	}
	.signed-badge {
		color: #34d399;
		font-weight: 600;
	}
	.match-badge {
		color: #10b981;
		font-size: 0.85rem;
		font-weight: 500;
	}
	.pending-badge {
		color: #94a3b8;
		font-size: 0.85rem;
	}
	.sign-btn {
		min-width: 80px;
	}
</style>
