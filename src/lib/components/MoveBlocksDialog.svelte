<script lang="ts">
	import { channels } from '$lib/channels.svelte';
	import { blockDragFor, type DragSource } from '$lib/dnd.svelte';
	import { moveBlock } from '$lib/operations';
	import { toast } from '$lib/toast.svelte';
	import type { FolderNode } from '$lib/seeds';
	import type { Block, Channel } from '$lib/types';
	import FolderIcon from './FolderIcon.svelte';

	let { blocks, source, onclose, onmoved }: {
		blocks: Block[];
		source: DragSource;
		onclose: () => void;
		onmoved: () => void;
	} = $props();

	let query = $state('');
	let moving = $state(false);
	let expanded = $state(new Set<number>());
	let searchCollapsed = $state(new Set<number>());
	const searching = $derived(query.trim().length > 0);
	const folders = $derived(filterFolders(channels.folders.roots));
	const inbox = $derived.by(() => {
		const target = channels.inbox;
		return target && canMoveTo(target) && 'inbox'.includes(query.trim().toLowerCase()) ? target : null;
	});

	function canMoveTo(target: Channel) {
		return target.id !== source.id && target.slug !== source.slug && target.can?.add_to !== false;
	}

	function filterFolders(nodes: FolderNode[]): FolderNode[] {
		const search = query.trim().toLowerCase();
		return nodes.flatMap((node) => {
			const children = filterFolders(node.children);
			// Keep unavailable parents as navigation to their writable descendants.
			return (canMoveTo(node.channel) && node.key.toLowerCase().includes(search)) || children.length
				? [{ ...node, children }]
				: [];
		});
	}

	function toggleFolder(id: number) {
		const next = new Set(searching ? searchCollapsed : expanded);
		if (!next.delete(id)) next.add(id);
		if (searching) searchCollapsed = next;
		else expanded = next;
	}

	function show(node: HTMLDialogElement) {
		node.showModal();
	}

	async function move(target: Channel) {
		if (moving || !blocks.length || !canMoveTo(target)) return;
		// Capture the source connections before optimistic feed updates remove the selection.
		const payload = blockDragFor(blocks[0], source, blocks);
		if (!payload) return;
		if (blocks.some((block) => block.connection?.id == null)) {
			toast.error('A selected block is missing its folder connection. Refresh and try again.');
			return;
		}
		moving = true;
		try {
			if (await moveBlock(payload, target)) onmoved();
		} finally {
			moving = false;
		}
	}
</script>

{#snippet folderRow(node: FolderNode, depth: number)}
	{@const hasChildren = node.children.length > 0}
	{@const open = hasChildren && (searching ? !searchCollapsed.has(node.channel.id) : expanded.has(node.channel.id))}
	<li>
		<div class="folder-row" style:padding-left="{10 + depth * 14}px">
			<span class="folder-slot"><FolderIcon channel={node.channel} size={18} /></span>
			<button class="folder" type="button" title={node.key}
				disabled={moving || !canMoveTo(node.channel)} onclick={() => move(node.channel)}>
				<span>{node.label}</span>
			</button>
			{#if hasChildren}
				<button class="folder-toggle" class:open type="button" disabled={moving}
					aria-label="{open ? 'Collapse' : 'Expand'} {node.label} folder"
					aria-expanded={open} aria-controls="move-folder-{node.channel.id}"
					onclick={() => toggleFolder(node.channel.id)}>
					<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
				</button>
			{/if}
		</div>
		{#if hasChildren}
			<ul id="move-folder-{node.channel.id}" hidden={!open}>
				{#if open}
					{#each node.children as child (child.channel.id)}
						{@render folderRow(child, depth + 1)}
					{/each}
				{/if}
			</ul>
		{/if}
	</li>
{/snippet}

<dialog use:show aria-labelledby="move-title" onclose={onclose}
	oncancel={(event) => { event.preventDefault(); if (!moving) onclose(); }}>
	<header>
		<h2 id="move-title">Move to</h2>
		<button type="button" disabled={moving} onclick={onclose} aria-label="Close folder picker">✕</button>
	</header>
	<p>{blocks.length} {blocks.length === 1 ? 'block' : 'blocks'} selected</p>
	<input type="search" bind:value={query} oninput={() => (searchCollapsed = new Set())}
		placeholder="Find a destination" aria-label="Find a destination" disabled={moving} />
	<div class="folders" aria-busy={moving}>
		{#if inbox || folders.length}
			<ul aria-label="Move destinations">
				{#if inbox}
					<li>
						<div class="folder-row" style:padding-left="10px">
							<span class="folder-slot">
								<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
									<path d="M2.5 9.5 4.2 4.3a1 1 0 0 1 .95-.7h5.7a1 1 0 0 1 .95.7l1.7 5.2V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.5Zm0 0h3.2l.8 1.5h3l.8-1.5h3.2" />
								</svg>
							</span>
							<button class="folder" type="button" title="Inbox" disabled={moving} onclick={() => inbox && move(inbox)}>
								<span>Inbox</span>
							</button>
						</div>
					</li>
				{/if}
				{#each folders as node (node.channel.id)}
					{@render folderRow(node, 0)}
				{/each}
			</ul>
		{:else}
			<p>{channels.loaded ? 'No matching destinations.' : 'Loading destinations…'}</p>
		{/if}
	</div>
	{#if moving}<p role="status">Moving blocks…</p>{/if}
</dialog>

<style>
	dialog {
		width: min(420px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		padding: 20px;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
	}
	dialog::backdrop { background: rgba(0, 0, 0, 0.25); }
	header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	h2 { margin: 0; font-size: 16px; }
	p { color: var(--muted); }
	button { border: 0; border-radius: 6px; background: none; min-height: 44px; }
	header button { width: 44px; }
	input { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--hover); font-size: 16px; }
	.folders { max-height: 50dvh; overflow-y: auto; margin-top: 12px; font-size: 15px; }
	ul { list-style: none; padding: 0; margin: 0; }
	.folder-row { display: flex; align-items: center; gap: 8px; min-height: 44px; border-radius: 8px; }
	.folder-row:hover { background: var(--hover); }
	.folder-slot { flex: none; display: grid; place-items: center; width: 18px; color: #55555a; }
	.folder { flex: 1; min-width: 0; padding: 10px 0; color: var(--text); text-align: left; }
	.folder span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.folder-toggle { display: grid; place-items: center; width: 44px; flex: none; padding: 0; color: var(--muted); }
	.folder-toggle svg { transition: transform 0.12s; }
	.folder-toggle.open svg { transform: rotate(90deg); }
	button:hover:not(:disabled) { background: var(--hover); }
	button:disabled { opacity: 0.5; cursor: default; }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	@media (prefers-reduced-motion: reduce) { .folder-toggle svg { transition: none; } }
</style>
