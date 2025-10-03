<script module lang="ts">
	import type { SuiWallet, ZkLoginGoogleConfig } from '../SuiModule/SuiModule.svelte';

	interface NotInstalledSelection {
		wallet: SuiWallet;
		installUrl: string;
	}

	let _resolve = $state<((value: any) => void) | undefined>();
	let resolve = {
		get value() {
			return _resolve;
		},
		set(value: ((val: any) => void) | undefined) {
			_resolve = value;
		}
	};
	let connectModal = $state<HTMLDialogElement>();
	let getConnectModal = (): HTMLDialogElement | undefined => connectModal;
</script>

<script lang="ts">
	interface Props {
		availableWallets: SuiWallet[];
		onPickInstalled?: (wallet: SuiWallet) => void;
		zkLoginGoogle?: ZkLoginGoogleConfig | null;
	}

	let { availableWallets, onPickInstalled = undefined, zkLoginGoogle = null }: Props = $props();
	let isOpen = $state<boolean>(false);
	let showOther = $state<boolean>(false);

	// Show install hint when clicking a wallet that is not installed
	let notInstalledSelection = $state<NotInstalledSelection | undefined>();
	let installHintEl = $state<HTMLDivElement | undefined>();

	const getInstallUrlForWallet = (wallet: SuiWallet): string => {
		console.log('getInstallUrlForWallet', wallet);
		try {
			const urls = wallet?.downloadUrl;
			if (urls) {
				if (typeof urls === 'string') return urls;
				if (typeof urls === 'object') {
					if (typeof urls.chrome === 'string') return urls.chrome;
					const first = Object.values(urls).find(
						(u) => typeof u === 'string' && /^https?:\/\//.test(u)
					);
					if (typeof first === 'string') return first;
				}
			}
			const candidates: (string | undefined)[] = [
				wallet?.installUrl,
				wallet?.downloadUrl,
				wallet?.website,
				wallet?.homepage,
				wallet?.homeUrl,
				wallet?.url
			];
			for (const u of candidates) {
				if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
			}
			return `https://chromewebstore.google.com/search/${encodeURIComponent(wallet?.originalName || wallet?.name || 'Sui wallet')}`;
		} catch (_) {
			return 'https://chromewebstore.google.com/search/sui%20wallet';
		}
	};

	const getWalletDisplayName = (wallet: SuiWallet): string =>
		wallet?.displayName || wallet?.name || '';

	const detectedWallets = $derived<SuiWallet[]>(
		Array.isArray(availableWallets) ? availableWallets.filter((w) => w?.installed) : []
	);

	const otherWallets = $derived<SuiWallet[]>(
		Array.isArray(availableWallets) ? availableWallets.filter((w) => !w?.installed) : []
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

	export const openAndWaitForResponse = (): Promise<
		{ wallet: SuiWallet; installed: boolean; started?: boolean } | undefined
	> => {
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

	const onClose = (): void => {
		if (resolve.value) {
			resolve.value(undefined);
		}
		connectModal?.close();
		notInstalledSelection = undefined;
	};

	const onSelected = (wallet: SuiWallet): void => {
		// Keep modal open for not installed to allow user to pick another wallet
		if (wallet?.installed) {
			notInstalledSelection = undefined;
			// Start connection immediately within the click handler to preserve user gesture
			try {
				onPickInstalled?.(wallet);
			} catch {}
			if (resolve.value) {
				resolve.value({ wallet, installed: true, started: true });
			}
			connectModal?.close();
			return;
		}

		notInstalledSelection = {
			wallet,
			installUrl: getInstallUrlForWallet(wallet)
		};
		setTimeout(() => {
			try {
				installHintEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			} catch {}
		}, 0);
		if (resolve.value) {
			resolve.value({ wallet, installed: false });
		}
	};

	const onOverlayClick = (event: MouseEvent): void => {
		// Close only when clicking directly on the overlay (outside modal content)
		if (event.target === event.currentTarget) {
			onClose();
		}
	};

	const onOverlayKeydown = (event: KeyboardEvent): void => {
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

			{#if notInstalledSelection}
				<div class="install-hint" role="alert" bind:this={installHintEl}>
					<div class="install-hint-row">
						<strong>{getWalletDisplayName(notInstalledSelection.wallet)}</strong>
						<span>is not installed.</span>
					</div>
					<a
						href={notInstalledSelection.installUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="install-link"
					>
						Install this wallet
					</a>
				</div>
			{/if}

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
									<img
										src={wallet.iconUrl}
										alt={getWalletDisplayName(wallet)}
										class="wallet-icon"
									/>
									<div class="wallet-info">
										<div class="wallet-name">{getWalletDisplayName(wallet)}</div>
									</div>
									<div class="wallet-status">
										{#if wallet.name === 'Sign in with Google' && zkLoginGoogle}
											{#if zkLoginGoogle.network !== 'mainnet'}
												<span class="installed-badge">{zkLoginGoogle.network}</span>
											{/if}
										{:else}
											<span class="installed-badge">Installed</span>
										{/if}
										<svg class="wallet-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 5l7 7-7 7"
											></path>
										</svg>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if otherWallets.length > 0}
					<div class="section">
						<button class="toggle-other-btn" onclick={() => (showOther = !showOther)}>
							<svg
								class="toggle-icon"
								class:rotated={showOther}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 9l-7 7-7-7"
								></path>
							</svg>
							<span>{showOther ? 'Hide' : 'More'} ({otherWallets.length})</span>
						</button>
						{#if showOther}
							<div class="wallet-list">
								{#each otherWallets as wallet (wallet.name)}
									<div class="wallet-button disabled">
										<img
											src={wallet.iconUrl}
											alt={getWalletDisplayName(wallet)}
											class="wallet-icon"
										/>
										<div class="wallet-info">
											<div class="wallet-name">{getWalletDisplayName(wallet)}</div>
										</div>
										<div class="wallet-status">
											<a
												href={getInstallUrlForWallet(wallet)}
												target="_blank"
												rel="noopener noreferrer"
												class="install-label"
											>
												Install
											</a>
											<div class="arrow-spacer"></div>
										</div>
									</div>
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
		max-width: 22rem;
		max-height: min(85vh, 700px);
		overflow-y: auto;
		overflow-x: hidden;
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
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-height: 400px;
		overflow-y: auto;
		overflow-x: hidden;
		padding-right: 0.25rem;
	}

	.wallet-button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid #e5e7eb;
		background: white;
		cursor: pointer;
		transition: all 0.2s ease;
		/* Ensure padding and border are included in width */
		box-sizing: border-box;
		font: inherit;
	}

	.wallet-button:hover {
		border-color: #93c5fd;
		background-color: #eff6ff;
	}

	.wallet-icon {
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		flex-shrink: 0;
	}

	.wallet-info {
		flex: 1;
		text-align: left;
		/* Allow the name to shrink inside a flex row */
		min-width: 0;
	}

	.wallet-name {
		font-size: 0.875rem;
		line-height: 1.1rem;
		font-weight: 600;
		color: #111827;
		transition: color 0.2s ease;
		/* Prevent overflowing long wallet names */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.section {
		display: block;
		margin-bottom: 1rem;

		&:last-child {
			margin-bottom: 0;
		}
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.toggle-other-btn:hover {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.toggle-icon {
		width: 1rem;
		height: 1rem;
		transition: transform 0.2s ease;
	}

	.toggle-icon.rotated {
		transform: rotate(180deg);
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

	.wallet-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		/* Keep the status area from shrinking so the name can truncate */
		flex-shrink: 0;
	}

	.installed-badge {
		background: #dcfce7;
		color: #166534;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		border: 1px solid #bbf7d0;
		white-space: nowrap;
	}

	.wallet-button.disabled {
		cursor: default;
		opacity: 0.7;
	}

	.wallet-button.disabled:hover {
		border-color: #e5e7eb;
		background: white;
	}

	.install-label {
		color: #2563eb;
		font-size: 0.75rem;
		font-weight: 600;
		text-decoration: underline;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		transition: all 0.15s ease;
		cursor: pointer;
	}

	.install-label:hover {
		color: #1d4ed8;
		background: #eff6ff;
		text-decoration: none;
	}

	.arrow-spacer {
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
	}

	.install-hint {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #991b1b;
		border-radius: 0.5rem;
		padding: 0.75rem 0.875rem;
		margin-bottom: 0.75rem;
	}

	.install-hint-row {
		display: flex;
		gap: 0.375rem;
		align-items: baseline;
		margin-bottom: 0.375rem;
	}

	.install-link {
		color: #b91c1c;
		font-weight: 600;
		text-decoration: underline;
	}

	.install-link:hover {
		color: #7f1d1d;
	}

	/* Custom scrollbar styling */
	.wallet-list::-webkit-scrollbar {
		width: 6px;
	}

	.wallet-list::-webkit-scrollbar-track {
		background: #f1f5f9;
		border-radius: 3px;
	}

	.wallet-list::-webkit-scrollbar-thumb {
		background: #cbd5e1;
		border-radius: 3px;
	}

	.wallet-list::-webkit-scrollbar-thumb:hover {
		background: #94a3b8;
	}
</style>
