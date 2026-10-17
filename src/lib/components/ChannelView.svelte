<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { nav } from '$lib/nav.svelte';
	import { droptarget, inview } from '$lib/actions';
	import { channels } from '$lib/channels.svelte';
	import { dnd } from '$lib/dnd.svelte';
	import { getFeed, keyOf, refreshFeed } from '$lib/feed.svelte';
	import { addDropped, convertToFolder } from '$lib/operations';
	import { readDrop } from '$lib/dropped';
	import { prefs, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN } from '$lib/prefs.svelte';
	import { displayTitle, folderSummary, isFolder, isInbox, parseFolderTitle, PATH_SEPARATOR } from '$lib/seeds';
	import { toast } from '$lib/toast.svelte';
	import type { Block, Channel, Connectable, SortKey } from '$lib/types';
	import Grid from './Grid.svelte';
	import BlockList from './BlockList.svelte';
	import Viewer from './Viewer.svelte';
	import FolderIcon from './FolderIcon.svelte';
	import RenameFolderInput from './RenameFolderInput.svelte';
	import IconoirGlyph from './IconoirGlyph.svelte';
	import { ui } from '$lib/ui.svelte';

	let {
		slug,
		emptyText = 'This channel is empty.'
	}: {
		slug: string;
		emptyText?: string;
	} = $props();

	let version = $state(0);
	const feed = $derived.by(() => {
		version;
		return getFeed(slug, prefs.sort);
	});

	let scroller: HTMLElement | undefined = $state();
	let openKey = $state<string | null>(null);

	// The full record (has `can`) once fetched, overlaid with the sidebar's copy, which stays current
	// when a folder is renamed by nesting or a block is added/moved.
	const channel = $derived.by<Channel | null>(() => {
		const full = feed.channel;
		const listed = channels.bySlug(slug);
		if (full && listed) return { ...full, title: listed.title, counts: listed.counts };
		return full ?? listed;
	});

	$effect(() => {
		const current = feed;
		untrack(() => current.start());
	});

	// Switching channels: close the viewer and jump back to the top.
	$effect(() => {
		slug;
		openKey = null;
		if (scroller) scroller.scrollTop = 0;
	});

	// Keep the sidebar's counts (and the Inbox badge) in step with what the API just told us.
	$effect(() => {
		const fresh = feed.channel;
		if (fresh) untrack(() => channels.syncCounts(fresh));
	});

	// Arrived here via browser back/forward onto the channel we drilled in from: drop it from the trail.
	$effect(() => {
		const current = slug;
		untrack(() => {
			if (nav.trail.at(-1)?.slug === current) nav.pop();
		});
	});

	let renamingId = $state<number | null>(null);
	const canRename = $derived(channel !== null && isFolder(channel) &&
		channel.can?.update === true && channels.bySlug(slug) !== null);

	// Are.na may change a slug after a title edit, including an ancestor rename from the sidebar.
	$effect(() => {
		const currentSlug = slug;
		const updatedSlug = channel?.slug;
		if (updatedSlug && updatedSlug !== currentSlug) {
			untrack(() => void goto(`/c/${encodeURIComponent(updatedSlug)}`, { replaceState: true }));
		}
	});

	let converting = $state(false);
	const canConvert = $derived(
		channel !== null && !isFolder(channel) && !isInbox(channel) &&
		channel.can?.update === true && channels.bySlug(slug) !== null
	);

	async function convert() {
		if (!channel || !canConvert || converting) return;
		const currentFeed = feed;
		const currentSlug = slug;
		converting = true;
		try {
			const folder = await convertToFolder(channel);
			if (!folder) return;
			currentFeed.channel = folder;
			if (slug === currentSlug && folder.slug !== currentSlug) {
				await goto(`/c/${encodeURIComponent(folder.slug)}`, { replaceState: true });
			}
		} finally {
			converting = false;
		}
	}

	const title = $derived(channel ? displayTitle(channel) : slug);
	const breadcrumbs = $derived.by(() => {
		const segments = channel ? parseFolderTitle(channel.title) : null;
		if (!segments) return nav.trail;
		return segments.slice(0, -1).map((title, index) => {
			const key = segments.slice(0, index + 1).join(PATH_SEPARATOR);
			const ancestor = channels.folders.all.find((node) => node.key === key);
			return { title, slug: ancestor?.channel.slug ?? null };
		});
	});

	function enterChannel(_child: Channel) {
		nav.push({ slug, title });
	}

	function followBreadcrumb(index: number) {
		if (channel && isFolder(channel)) nav.clear();
		else nav.trail = nav.trail.slice(0, index);
	}

	// Folders nested directly inside this one show up as channel tiles at the top of the grid.
	const childFolders = $derived.by<Channel[]>(() => {
		if (!channel) return [];
		const node = channels.folders.all.find((n) => n.channel.id === channel.id);
		return node ? node.children.map((c) => c.channel) : [];
	});

	const gridItems = $derived.by<Connectable[]>(() => {
		if (!childFolders.length) return feed.items;
		const ids = new Set(childFolders.map((c) => c.id));
		return [...childFolders, ...feed.items.filter((i) => !(i.type === 'Channel' && ids.has(i.id)))];
	});

	const itemCount = $derived(feed.total + (gridItems.length - feed.items.length));

	const blocks = $derived(feed.items.filter((i): i is Block => i.type !== 'Channel'));
	const openIndex = $derived(
		openKey === null ? -1 : blocks.findIndex((b) => `b${b.id}` === openKey)
	);

	// A block moved out from under the viewer: land on its neighbour instead of closing.
	let lastIndex = 0;
	$effect(() => {
		if (openIndex >= 0) {
			lastIndex = openIndex;
			return;
		}
		untrack(() => {
			if (openKey === null) return;
			const next = blocks[Math.min(lastIndex, blocks.length - 1)];
			openKey = next ? `b${next.id}` : null;
		});
	});

	function step(delta: number) {
		const next = blocks[openIndex + delta];
		if (next) openKey = `b${next.id}`;
		// Keep paging in the background while flipping through the viewer.
		if (openIndex + delta >= blocks.length - 6) void feed.loadMore();
	}

	function refresh() {
		refreshFeed(slug, prefs.sort);
		version++;
		if (scroller) scroller.scrollTop = 0;
	}

	const sorts: { value: SortKey; label: string }[] = [
		{ value: 'position_desc', label: 'Default order' },
		{ value: 'created_at_desc', label: 'Newest first' },
		{ value: 'created_at_asc', label: 'Oldest first' }
	];

	const source = $derived({ slug, id: channel?.id ?? null });

	/* ---------------- dropping images / files / text / links in ---------------- */

	function dropIn(e: DragEvent) {
		const target = channel;
		if (!target) {
			toast.error('This channel is still loading. Try again in a moment.');
			return;
		}
		if (target.can && !target.can.add_to) {
			toast.error(`You can't add to “${displayTitle(target)}”.`);
			return;
		}
		const dt = e.dataTransfer;
		if (dt) void addDropped(readDrop(dt), target);
	}
</script>

<svelte:head>
	<title>{title} · Seeds</title>
</svelte:head>

<div
	class="view"
	use:droptarget={{
		key: 'viewport',
		accepts: (kind) => kind === 'external',
		ondrop: (e) => dropIn(e)
	}}
>
	<header>
		<div class="heading">
			{#if breadcrumbs.length}
				<nav class="breadcrumbs" aria-label="Breadcrumb">
					{#each breadcrumbs as crumb, index}
						{#if crumb.slug}
							<a href="/c/{encodeURIComponent(crumb.slug)}" onclick={() => followBreadcrumb(index)}>{crumb.title}</a>
						{:else}
							<span>{crumb.title}</span>
						{/if}
						<span class="separator" aria-hidden="true">›</span>
					{/each}
				</nav>
			{/if}
			{#if channel && isFolder(channel)}<FolderIcon {channel} size={16} />{/if}
			<div class="folder-heading">
				{#if channel && renamingId === channel.id}
					<RenameFolderInput {channel} onclose={() => (renamingId = null)} />
				{:else}
					<h1>{title}</h1>
					{#if channel && canRename}
						<button class="rename-button" type="button" aria-label="Rename folder" title="Rename folder"
							disabled={ui.folderRenaming} onclick={() => (renamingId = channel?.id ?? null)}>
							<IconoirGlyph name="regular/edit-pencil" size={12} />
						</button>
					{/if}
				{/if}
			</div>
			{#if canConvert}
				<button class="convert" type="button" onclick={convert} disabled={converting}>
					{converting ? 'Converting…' : 'Convert to folder'}
				</button>
			{/if}
			{#if channel && isFolder(channel)}
				<span class="count">{folderSummary(channel, channels.folders.all)}</span>
			{:else if itemCount > 0}
				<span class="count">{itemCount.toLocaleString()} {itemCount === 1 ? 'item' : 'items'}</span>
			{/if}
		</div>

		<div class="controls">
			<div class="sort-control">
				<select
					value={prefs.sort}
					onchange={(e) => (prefs.sort = e.currentTarget.value as SortKey)}
					aria-label="Sort"
				>
					{#each sorts as s (s.value)}
						<option value={s.value}>{s.label}</option>
					{/each}
				</select>
				<svg class="sort-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
			</div>

			{#if prefs.viewMode === 'grid'}
			<label class="zoom" title="Tile size">
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
				<input
					type="range"
					min={ROW_HEIGHT_MIN}
					max={ROW_HEIGHT_MAX}
					step="10"
					bind:value={prefs.rowHeight}
					aria-label="Tile size"
				/>
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5" /></svg>
			</label>
			{/if}

			<div class="view-toggle" role="group" aria-label="Channel view">
				<button class="icon-btn" type="button" aria-label="Grid view" title="Grid view"
					aria-pressed={prefs.viewMode === 'grid'} onclick={() => (prefs.viewMode = 'grid')}>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
				</button>
				<button class="icon-btn" type="button" aria-label="List view" title="List view"
					aria-pressed={prefs.viewMode === 'list'} onclick={() => (prefs.viewMode = 'list')}>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M6 3h8M6 8h8M6 13h8M2 3h.5M2 8h.5M2 13h.5" /></svg>
				</button>
			</div>

			<button class="icon-btn" type="button" onclick={refresh} title="Refresh" aria-label="Refresh">
				<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" /></svg>
			</button>
		</div>
	</header>

	<div class="scroller" bind:this={scroller}>
		{#if prefs.viewMode === 'grid'}
			<Grid
				items={gridItems}
				rowHeight={prefs.rowHeight}
				{source}
				onopen={(key) => (openKey = key)}
				onchannel={enterChannel}
			/>
		{:else}
			<BlockList
				items={gridItems}
				{source}
				onopen={(key) => (openKey = key)}
				onchannel={enterChannel}
			/>
		{/if}

		{#if feed.error}
			<div class="status error">
				{feed.error}
				<button type="button" onclick={() => feed.loadMore()}>Retry</button>
			</div>
		{:else if feed.loading}
			<div class="status">Loading…</div>
		{:else if !gridItems.length}
			<div class="status">{emptyText}</div>
		{/if}

		{#if feed.hasMore && !feed.error}
			<div
				class="sentinel"
				use:inview={{
					onVisible: () => feed.loadMore(),
					key: `${feed.items.length}:${feed.pages}:${prefs.rowHeight}:${prefs.viewMode}`
				}}
			></div>
		{/if}
	</div>

	{#if openIndex >= 0}
		<Viewer
			items={blocks}
			index={openIndex}
			{source}
			onclose={() => (openKey = null)}
			onstep={step}
		/>
	{/if}

	{#if dnd.over === 'viewport'}
		<div class="drop-hint" aria-hidden="true">
			<span>Drop to add to {title}</span>
		</div>
	{/if}
</div>

<style>
	.view {
		height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	header {
		flex: none;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 0 16px;
	}

	.heading {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.heading h1 {
		min-width: 0;
	}

	.folder-heading {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		align-self: center;
	}

	.rename-button {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--muted);
		opacity: 0;
	}

	.folder-heading:hover .rename-button, .folder-heading:focus-within .rename-button {
		opacity: 1;
	}

	.rename-button:hover { background: var(--hover); color: var(--text); }
	.rename-button:focus-visible { outline: 2px solid var(--accent); }
	.rename-button:disabled { cursor: default; }

	@media (hover: none) { .rename-button { opacity: 1; } }

	.breadcrumbs {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		overflow-x: auto;
		white-space: nowrap;
		color: var(--muted);
		font-size: 13px;
	}

	.breadcrumbs a {
		color: inherit;
		text-decoration: none;
		border-radius: 2px;
	}

	.breadcrumbs a:hover {
		color: var(--text);
		text-decoration: underline;
	}

	.breadcrumbs a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.breadcrumbs .separator {
		flex: none;
	}

	h1 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.convert {
		flex: none;
		align-self: center;
		height: 26px;
		padding: 0 10px;
		border: 0;
		border-radius: 7px;
		background: var(--hover);
		font-size: 12px;
	}

	.convert:hover:not(:disabled) {
		background: var(--active);
	}

	.convert:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.count {
		flex: none;
		color: var(--muted);
		font-size: 12px;
	}

	.controls {
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--muted);
	}

	.sort-control {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.sort-chevron {
		position: absolute;
		right: 8px;
		pointer-events: none;
		color: var(--text);
	}

	select {
		appearance: none;
		-webkit-appearance: none;
		height: 26px;
		padding: 0 28px 0 8px;
		border: 0;
		border-radius: 7px;
		background: var(--hover);
		color: var(--text);
		font-size: 12px;
		outline: none;
	}

	.zoom {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	input[type='range'] {
		width: 96px;
		height: 4px;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 2px;
		background: var(--active);
		outline: none;
	}

	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		box-shadow:
			0 0 0 0.5px rgba(0, 0, 0, 0.18),
			0 1px 3px rgba(0, 0, 0, 0.2);
	}

	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 50%;
		background: #fff;
		box-shadow:
			0 0 0 0.5px rgba(0, 0, 0, 0.18),
			0 1px 3px rgba(0, 0, 0, 0.2);
	}

	.icon-btn {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
	}

	.view-toggle {
		display: flex;
		gap: 2px;
	}

	.icon-btn:hover {
		background: var(--hover);
		color: var(--text);
	}

	.icon-btn[aria-pressed='true'] {
		background: var(--active);
		color: var(--text);
	}

	.icon-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.scroller {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 16px 16px;
	}

	.status {
		padding: 24px 0;
		text-align: center;
		color: var(--muted);
	}

	.status.error {
		color: #c0392b;
	}

	.status button {
		margin-left: 6px;
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		text-decoration: underline;
	}

	.sentinel {
		height: 1px;
	}

	.drop-hint {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 2px var(--accent);
		pointer-events: none;
	}

	.drop-hint span {
		padding: 8px 16px;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-weight: 500;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
</style>
