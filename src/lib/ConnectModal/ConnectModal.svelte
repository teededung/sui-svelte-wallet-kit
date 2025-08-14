<script module>
	let _resolve = $state();
	let resolve = {
		get value() {
			return _resolve;
		},
		set(value) {
			_resolve = value;
		}
	};
	let connectModal = $state();
	let getConnectModal = () => connectModal;
</script>

<script>
	let { availableWallets } = $props();
	let isOpen = $state(false);
	let showOther = $state(false);

	const sortByName = (a, b) => (a?.name || '').localeCompare(b?.name || '');

	const detectedWallets = $derived(
		Array.isArray(availableWallets)
			? availableWallets.filter((w) => w?.installed).sort(sortByName)
			: []
	);

	const otherWallets = $derived(
		Array.isArray(availableWallets)
			? availableWallets.filter((w) => !w?.installed).sort(sortByName)
			: []
	);

	$effect(() => {
		if (!connectModal) return;
		if (isOpen) {
			// Ensure modal is placed on the top layer
			if (!connectModal.open) {
				connectModal.showModal();
			} else {
				connectModal.focus();
			}
		} else {
			connectModal.close();
		}
	});

	export const openAndWaitForResponse = () => {
		return new Promise((res) => {
			// Use showModal to guarantee top-layer rendering
			if (connectModal && !connectModal.open) {
				connectModal.showModal();
			} else {
				connectModal?.focus();
			}
			resolve.set(res);
		});
	};

	const onClose = () => {
		if (resolve.value) {
			resolve.value(undefined);
		}
		connectModal?.close();
	};

	const onSelected = (wallet) => {
		// Resolve with a structured payload so callers can detect installation state
		if (resolve.value) {
			resolve.value({ wallet, installed: !!wallet?.installed });
		}
		// Keep modal open for not installed to allow user to pick another wallet
		if (wallet?.installed) {
			connectModal?.close();
		}
	};

	const onOverlayClick = (event) => {
		// Close only when clicking directly on the overlay (outside modal content)
		if (event.target === event.currentTarget) {
			onClose();
		}
	};

	const onOverlayKeydown = (event) => {
		// Close when overlay is focused and user presses Enter or Space
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClose();
		}
	};
</script>

<dialog bind:this={connectModal} class="connect-modal">
	<div
		class="modal-overlay"
		onclick={onOverlayClick}
		role="button"
		tabindex="0"
		onkeydown={onOverlayKeydown}
	>
		<div class="modal-content">
			<div class="modal-header">
				<h2 class="modal-title">Connect Wallet</h2>
				<button aria-label="Close" class="close-button" onclick={onClose}>
					<svg class="close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						></path>
					</svg>
				</button>
			</div>

			{#if detectedWallets.length === 0 && otherWallets.length === 0}
				<div class="no-wallets">
					<div class="no-wallets-message">No wallets detected</div>
					<p class="no-wallets-text">
						Please install a Sui wallet. We recommend
						<a
							href="https://chromewebstore.google.com/detail/slush-%E2%80%94-a-sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
							target="_blank"
							class="wallet-link"
						>
							Slush — A Sui wallet
						</a>.
					</p>
				</div>
			{:else}
				{#if detectedWallets.length > 0}
					<div class="section">
						<div class="section-header">Detected wallets</div>
						<div class="wallet-list">
							{#each detectedWallets as wallet (wallet.name)}
								<button class="wallet-button" onclick={() => onSelected(wallet)}>
									<img src={wallet.iconUrl} alt={wallet.name} class="wallet-icon" />
									<div class="wallet-info">
										<div class="wallet-name">{wallet.name}</div>
										<div class="wallet-secondary"><span class="wallet-badge">detected</span></div>
									</div>
									<svg class="wallet-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 5l7 7-7 7"
										></path>
									</svg>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if otherWallets.length > 0}
					<div class="section">
						<button class="toggle-other-btn" onclick={() => (showOther = !showOther)}>
							{#if showOther}Hide other wallets{/if}
							{#if !showOther}Show other wallets ({otherWallets.length}){/if}
						</button>
						{#if showOther}
							<div class="wallet-list">
								{#each otherWallets as wallet (wallet.name)}
									<button class="wallet-button" onclick={() => onSelected(wallet)}>
										<img src={wallet.iconUrl} alt={wallet.name} class="wallet-icon" />
										<div class="wallet-info">
											<div class="wallet-name">{wallet.name}</div>
										</div>
										<svg class="wallet-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 5l7 7-7 7"
											></path>
										</svg>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</dialog>

<style>
	.connect-modal {
		padding: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		/* Ensure always on top even if not in top-layer (fallback) */
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		z-index: 2147483647;
	}

	.connect-modal::backdrop {
		background-color: rgba(0, 0, 0, 0.5);
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 2;
	}

	.modal-content {
		background: white;
		border-radius: 0.75rem;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		padding: 1.5rem;
		width: 100%;
		max-width: 28rem;
		max-height: min(85vh, 700px);
		overflow-y: auto;
		animation: fadeInZoom 0.2s ease-out;
		z-index: 3;
	}

	@keyframes fadeInZoom {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.modal-title {
		font-size: 1.5rem;
		font-weight: bold;
		color: #111827;
		margin: 0;
	}

	.close-button {
		color: #9ca3af;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 9999px;
		border: none;
		background: none;
		cursor: pointer;
		line-height: 0;
		transition: all 0.15s ease;
	}

	.close-button:hover {
		color: #4b5563;
		background-color: #f3f4f6;
	}

	.close-icon {
		width: 1.5rem;
		height: 1.5rem;
		display: block;
	}

	.no-wallets {
		text-align: center;
		padding: 2rem 0;
	}

	.no-wallets-message {
		color: #6b7280;
		margin-bottom: 1rem;
	}

	.no-wallets-text {
		font-size: 0.875rem;
		color: #4b5563;
		margin: 0;
	}

	.wallet-link {
		color: #2563eb;
		font-weight: 600;
		text-decoration: underline;
	}

	.wallet-link:hover {
		color: #1d4ed8;
	}

	.wallet-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.wallet-button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		border-radius: 0.5rem;
		border: 1px solid #e5e7eb;
		background: white;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.wallet-button:hover {
		border-color: #93c5fd;
		background-color: #eff6ff;
	}

	.wallet-icon {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.5rem;
		flex-shrink: 0;
	}

	.wallet-info {
		flex: 1;
		text-align: left;
	}

	.wallet-name {
		font-weight: 600;
		color: #111827;
		transition: color 0.2s ease;
	}

	.wallet-secondary {
		font-size: 0.875rem;
		color: #6b7280;
		margin-top: 0.125rem;
	}

	.wallet-badge {
		font-size: 0.675rem;
		font-weight: 600;
		color: #065f46;
		background-color: #d1fae5;
		border: 1px solid #10b98133;
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
		text-transform: lowercase;
	}

	.section {
		display: block;
		margin-bottom: 1rem;
	}

	.section-header {
		font-size: 0.875rem;
		font-weight: 600;
		color: #374151;
		margin: 0 0 0.5rem 0;
	}

	.toggle-other-btn {
		width: 100%;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		color: #374151;
		font-weight: 600;
		margin-bottom: 0.75rem;
		transition: all 0.2s ease;
	}

	.toggle-other-btn:hover {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.wallet-button:hover .wallet-name {
		color: #1e3a8a;
	}

	.wallet-arrow {
		width: 1.25rem;
		height: 1.25rem;
		color: #9ca3af;
		transition: color 0.2s ease;
	}

	.wallet-button:hover .wallet-arrow {
		color: #2563eb;
	}
</style>
