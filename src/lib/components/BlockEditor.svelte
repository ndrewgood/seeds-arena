<script lang="ts">
	import { untrack } from 'svelte';
	import { updateBlock } from '$lib/arena';
	import { updateBlockFeeds } from '$lib/feed.svelte';
	import type { Block } from '$lib/types';

	let {
		item,
		saving = $bindable(false),
		oncancel,
		onsaved
	}: {
		item: Block;
		saving?: boolean;
		oncancel: () => void;
		onsaved: () => void;
	} = $props();

	// Drafts are local to this editor; cancel never changes the cached block.
	let title = $state(untrack(() => item.title ?? ''));
	let description = $state(untrack(() => item.description?.markdown ?? item.description?.plain ?? ''));
	let error = $state<string | null>(null);

	function focusTitle(node: HTMLInputElement) {
		node.focus();
	}

	async function save() {
		if (saving) return;
		saving = true;
		error = null;
		try {
			const updated = await updateBlock(item.id, { title, description });
			updateBlockFeeds(updated);
			onsaved();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not save this block. Try again.';
		} finally {
			saving = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
		}
	}
</script>

<svelte:window {onkeydown} />

<aside class="editor" aria-label="Edit block">
	<form onsubmit={(e) => { e.preventDefault(); void save(); }} aria-busy={saving}>
		<h2>Edit block</h2>
		<label for="block-title">Title</label>
		<input id="block-title" type="text" bind:value={title} disabled={saving} use:focusTitle placeholder="Type block title" />

		<label for="block-description">Description</label>
		<textarea id="block-description" bind:value={description} disabled={saving} placeholder="Type block description"></textarea>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="editor-actions">
			<button class="cancel" type="button" disabled={saving} onclick={oncancel}>Cancel</button>
			<button class="save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</aside>

<style>
	.editor {
		flex: none;
		width: 380px;
		max-width: 45%;
		min-height: 0;
		padding: 56px 24px 24px;
		border-left: 1px solid var(--line);
		background: var(--panel);
		overflow-y: auto;
	}

	form {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}

	h2 {
		margin: 0 0 24px;
		font-size: 15px;
		font-weight: 600;
	}

	label {
		margin-bottom: 8px;
		color: var(--muted);
		font-size: 12px;
	}

	input,
	textarea {
		width: 100%;
		padding: 12px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: var(--tile);
		color: var(--text);
		font: inherit;
	}

	input {
		margin-bottom: 24px;
	}

	textarea {
		min-height: 180px;
		resize: vertical;
		line-height: 1.5;
	}

	input:focus-visible,
	textarea:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.error {
		color: #c0392b;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.editor-actions {
		display: flex;
		gap: 10px;
		margin-top: auto;
		padding-top: 24px;
	}

	button {
		padding: 10px 16px;
		border: 0;
		border-radius: 6px;
		font-weight: 500;
	}

	.cancel { background: var(--hover); }
	.cancel:hover:not(:disabled) { background: var(--active); }
	.save { flex: 1; background: var(--text); color: #fff; }
	.save:hover:not(:disabled) { background: #000; }
	button:disabled { opacity: 0.5; cursor: default; }

	@media (max-width: 700px) {
		.editor {
			position: absolute;
			inset: 0 0 0 auto;
			z-index: 3;
			width: 380px;
			max-width: calc(100% - 56px);
			box-shadow: -8px 0 24px rgba(0, 0, 0, 0.05);
		}
	}
</style>
