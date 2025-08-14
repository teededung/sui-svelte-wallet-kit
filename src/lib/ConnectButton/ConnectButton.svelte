<script>
	import { connectWithModal, disconnect, account } from '$lib/SuiModule';

	const { class: className = '', style = '', onWalletSelection } = $props();

	const onClick = async function () {
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
