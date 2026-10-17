<script lang="ts">
	import { DEFAULT_FOLDER_ICON, folderIconUrl } from '$lib/folder-icons';
	let { name = DEFAULT_FOLDER_ICON, size = 14 }: { name?: string; size?: number } = $props();
	const url = $derived(folderIconUrl(name));
</script>

<span class="glyph" aria-hidden="true" style:width="{size}px" style:height="{size}px"
	style:mask-image="url('{url}')" style:-webkit-mask-image="url('{url}')"></span>

<style>
	.glyph {
		display: inline-block;
		flex: none;
		background-color: currentColor;
		mask-size: contain;
		mask-position: center;
		mask-repeat: no-repeat;
		-webkit-mask-size: contain;
		-webkit-mask-position: center;
		-webkit-mask-repeat: no-repeat;
	}
</style>
