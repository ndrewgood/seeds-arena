<script lang="ts">
	import { channels } from '$lib/channels.svelte';
	import { DEFAULT_FOLDER_ICON, readFolderIcon } from '$lib/folder-icons';
	import type { Channel } from '$lib/types';
	import IconoirGlyph from './IconoirGlyph.svelte';

	let { channel, size = 14 }: { channel: Channel; size?: number } = $props();
	const current = $derived(channels.items.find((c) => c.id === channel.id) ?? channel);
	const icon = $derived(readFolderIcon(current.description?.markdown));
</script>

<span class="folder-icon" style:width="{size}px" style:height="{size}px" aria-hidden="true">
	<IconoirGlyph name={icon?.value ?? DEFAULT_FOLDER_ICON} {size} />
</span>

<style>
	.folder-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; color: #55555a; }
</style>
