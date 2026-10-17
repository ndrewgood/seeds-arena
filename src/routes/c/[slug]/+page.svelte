<script lang="ts">
	import { page } from '$app/state';
	import ChannelView from '$lib/components/ChannelView.svelte';

	const slug = $derived(page.params.slug ?? '');
</script>

<ChannelView {slug} />
