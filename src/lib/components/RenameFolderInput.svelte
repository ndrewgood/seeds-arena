<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { renameFolder } from '$lib/operations';
	import { displayTitle } from '$lib/seeds';
	import type { Channel } from '$lib/types';

	let { channel, onclose }: { channel: Channel; onclose: () => void } = $props();
	let draft = $state('');
	let saving = $state(false);
	let finished = false;
	let input: HTMLInputElement;

	onMount(() => {
		draft = displayTitle(channel);
		void tick().then(() => { input.focus(); input.select(); });
	});

	function close() {
		if (saving || finished) return;
		finished = true;
		onclose();
	}

	async function commit() {
		if (saving || finished) return;
		if (!draft.trim()) return close();
		saving = true;
		const saved = await renameFolder(channel, draft);
		saving = false;
		if (saved) close();
		else {
			await tick();
			input.focus();
		}
	}

	function keydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') { e.preventDefault(); void commit(); }
		if (e.key === 'Escape') { e.preventDefault(); close(); }
	}
</script>

<input bind:this={input} type="text" class="rename-input" bind:value={draft}
	aria-label="Folder name" aria-busy={saving} disabled={saving} autocomplete="off"
	spellcheck="false" onkeydown={keydown} onblur={() => void commit()} />

<style>
	.rename-input {
		width: 100%; min-width: 0; height: 24px; padding: 0 6px;
		border: 0; border-radius: 5px; background: var(--panel); color: var(--text);
		box-shadow: 0 0 0 1.5px var(--accent); outline: none; font: inherit;
	}
	.rename-input:disabled { opacity: 0.6; }
</style>
