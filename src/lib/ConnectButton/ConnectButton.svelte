<script>
	import { connectWithModal, disconnect, account } from '$lib/SuiModule';

	const { class: className = '', style = '' } = $props();

	const onClick = function () {
		if (!account.value) {
			connectWithModal();
		} else {
			disconnect();
		}
	};
</script>

<button type="button" class={className} {style} onclick={onClick}>
	{account.value ? 'Disconnect' : 'Connect'}
</button>
