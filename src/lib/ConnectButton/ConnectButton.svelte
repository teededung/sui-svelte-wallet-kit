<script lang="ts">
	import { connectWithModal, disconnect, account } from '$lib/SuiModule';
	import type { WalletSelectionPayload } from '$lib/SuiModule';

	interface Props {
		class?: string;
		style?: string;
		onWalletSelection?: (payload: WalletSelectionPayload) => void;
	}

	const { class: className = '', style = '', onWalletSelection }: Props = $props();

	const onClick = async (): Promise<void> => {
		if (!account.value) {
			await connectWithModal(onWalletSelection);
		} else {
			disconnect();
		}
	};
</script>

<button type="button" class={className} {style} onclick={onClick}>
	{account.value ? 'Disconnect' : 'Connect'}
</button>
