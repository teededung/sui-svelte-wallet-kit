<script lang="ts">
	import { connectWithModal, disconnect, useCurrentAccount } from '$lib/SuiModule';
	import type { WalletSelectionPayload } from '$lib/SuiModule';

	interface Props {
		class?: string;
		style?: string;
		onWalletSelection?: (payload: WalletSelectionPayload) => void;
	}

	let account = $derived(useCurrentAccount());

	const { class: className = '', style = '', onWalletSelection }: Props = $props();

	const onClick = async (): Promise<void> => {
		if (!account) {
			await connectWithModal(onWalletSelection);
		} else {
			disconnect();
		}
	};
</script>

<button type="button" class={className} {style} onclick={onClick}>
	{account ? 'Disconnect' : 'Connect'}
</button>
