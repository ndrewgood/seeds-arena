<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { channels } from '$lib/channels.svelte';
	import { nav } from '$lib/nav.svelte';
	import { droptarget } from '$lib/actions';
	import { dnd, startFolderDrag } from '$lib/dnd.svelte';
	import { createFolder, deleteFolder, handleChannelDrop, nestFolder, setFolderIcon } from '$lib/operations';
	import { canNest, displayTitle, pathIds, sanitizeFolderName, type FolderNode } from '$lib/seeds';
	import { ui } from '$lib/ui.svelte';
	import type { Channel } from '$lib/types';
	import { readFolderIcon, type FolderIcon as IconChoice } from '$lib/folder-icons';
	import FolderIcon from './FolderIcon.svelte';
	import FolderIconPicker from './FolderIconPicker.svelte';
	import RenameFolderInput from './RenameFolderInput.svelte';

	let query = $state('');
	let searchOpen = $state(false);
	let searchButton: HTMLButtonElement | undefined = $state();
	let menuOpen = $state(false);

	function openSearch() {
		searchOpen = true;
	}

	async function closeSearch() {
		query = '';
		searchOpen = false;
		await tick();
		searchButton?.focus();
	}

	let creating = $state(false);
	let draft = $state('');
	let saving = $state(false);

	const activeSlug = $derived(page.params.slug);
	const onInboxPage = $derived(page.url.pathname === '/inbox');
	const searching = $derived(query.trim().length > 0);
	const q = $derived(query.trim().toLowerCase());

	const inbox = $derived(channels.inbox);
	const folderRoots = $derived(channels.folders.roots);

	function folderMatches(node: FolderNode): boolean {
		return node.key.toLowerCase().includes(q) || node.children.some(folderMatches);
	}

	const visibleFolders = $derived(searching ? folderRoots.filter(folderMatches) : folderRoots);
	const visibleChannels = $derived(
		searching ? channels.others.filter((c) => c.title.toLowerCase().includes(q)) : channels.others
	);
	const channelsOpen = $derived(ui.channelsOpen || searching);

	// Navigating into a folder (or one of its ancestors' children) reveals it in the tree.
	let lastRevealed: string | undefined;
	$effect(() => {
		const slug = activeSlug;
		const all = channels.folders.all;
		const node = slug ? all.find((n) => n.channel.slug === slug) : undefined;
		if (!node || lastRevealed === slug) return;
		lastRevealed = slug;
		untrack(() => ui.expand(pathIds(node, all)));
	});

	let context = $state<{ channel: Channel; x: number; y: number; trigger: HTMLElement | null } | null>(null);
	let editingIcon = $state<Channel | null>(null);
	let renamingId = $state<number | null>(null);
	let savingIcon = $state(false);
	let deletingFolder = $state(false);
	let contextMenu = $state<HTMLDivElement | undefined>();

	function openContext(e: MouseEvent, channel: Channel) {
		e.preventDefault();
		e.stopPropagation();
		if (editingIcon || deletingFolder) return;
		const row = e.currentTarget as HTMLElement;
		const anchor = row.querySelector('a');
		const rect = row.getBoundingClientRect();
		context = {
			channel,
			x: Math.max(8, Math.min(e.clientX || rect.left, window.innerWidth - 176)),
			y: Math.max(8, Math.min(e.clientY || rect.bottom, window.innerHeight - 152)),
			trigger: anchor
		};
	}

	function closeContext() {
		context?.trigger?.focus();
		context = null;
	}

	function dismissContext(e: PointerEvent) {
		if (context && !contextMenu?.contains(e.target as Node)) closeContext();
	}

	function contextKey(e: KeyboardEvent) {
		if (!context) return;
		if (e.key === 'Escape' || e.key === 'Tab') {
			if (e.key === 'Escape') e.preventDefault();
			closeContext();
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const items = [...(contextMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
			const index = items.indexOf(document.activeElement as HTMLElement);
			const delta = e.key === 'ArrowDown' ? 1 : -1;
			items[(index + delta + items.length) % items.length]?.focus();
		} else if (e.key === ' ' && document.activeElement instanceof HTMLAnchorElement && contextMenu?.contains(document.activeElement)) {
			e.preventDefault();
			document.activeElement.click();
		}
	}

	async function confirmDeleteFolder() {
		const selected = context?.channel;
		if (!selected || deletingFolder || ui.folderRenaming || selected.can?.destroy === false) return;
		closeContext();
		if (!window.confirm(`Delete folder “${displayTitle(selected)}”? This permanently deletes its Are.na channel. Subfolders will not be deleted, and blocks in other folders/channels will be kept. This cannot be undone.`)) return;
		deletingFolder = true;
		try {
			if (await deleteFolder(selected)) {
				if (activeSlug === selected.slug) await goto('/inbox');
			}
		} finally {
			deletingFolder = false;
		}
	}

	async function saveIcon(icon: IconChoice | null) {
		if (!editingIcon || savingIcon) return;
		savingIcon = true;
		try {
			if (await setFolderIcon(editingIcon, icon)) editingIcon = null;
		} finally {
			savingIcon = false;
		}
	}

	/* ------------------------------ new folder ------------------------------ */

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	function startCreating() {
		draft = '';
		creating = true;
	}

	function cancelCreating() {
		creating = false;
		draft = '';
	}

	async function commitCreating() {
		if (saving) return;
		// No title, no folder.
		if (!sanitizeFolderName(draft)) return cancelCreating();
		saving = true;
		const channel = await createFolder(draft);
		saving = false;
		if (channel) cancelCreating();
	}

	function onDraftKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void commitCreating();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelCreating();
		}
	}

	/* ----------------------------- drag and drop ----------------------------- */

	function draggedFolder(): FolderNode | null {
		const current = dnd.current;
		if (current?.kind !== 'folder') return null;
		return channels.folders.all.find((n) => n.channel.id === current.channelId) ?? null;
	}

	function canDropOnChannel(kind: 'block' | 'folder' | 'external', channel: Channel) {
		if (kind === 'folder') return false;
		const current = dnd.current;
		if (kind === 'block' && current?.kind === 'block' && current.sourceSlug === channel.slug) return false;
		return true;
	}

	function canDropOnFolder(kind: 'block' | 'folder' | 'external', node: FolderNode) {
		if (kind !== 'folder') return canDropOnChannel(kind, node.channel);
		const dragged = draggedFolder();
		return dragged !== null && canNest(dragged, node);
	}

	function dropOnFolder(e: DragEvent, kind: 'block' | 'folder' | 'external', node: FolderNode) {
		if (kind === 'folder') {
			const dragged = draggedFolder();
			if (dragged) void nestFolder(dragged, node);
			return;
		}
		handleChannelDrop(e, kind, node.channel);
	}

	function expandFolder(node: FolderNode) {
		if (node.children.length) ui.expand([node.channel.id]);
	}

	let folderClick: { id: number; expanded: boolean } | null = null;

	function clickFolder(event: MouseEvent, node: FolderNode) {
		if (event.detail === 1) {
			folderClick = { id: node.channel.id, expanded: ui.isExpanded(node.channel.id) };
		}
		nav.clear();
	}

	function doubleClickFolder(event: MouseEvent, node: FolderNode) {
		event.preventDefault();
		if (!node.children.length) return;
		const wasExpanded = folderClick?.id === node.channel.id
			? folderClick.expanded : ui.isExpanded(node.channel.id);
		// The first click may already have navigated and auto-expanded this folder.
		lastRevealed = node.channel.slug;
		if (ui.isExpanded(node.channel.id) === wasExpanded) ui.toggle(node.channel.id);
		folderClick = null;
	}
</script>

{#snippet folderRow(node: FolderNode, depth: number)}
	{@const hasChildren = node.children.length > 0}
	{@const open = hasChildren && (searching || ui.isExpanded(node.channel.id))}
	{@const key = `f${node.channel.id}`}
	<div
		class="row"
		class:active={activeSlug === node.channel.slug}
		class:drop={dnd.over === key}
		class:dragging={dnd.current?.kind === 'folder' && dnd.current.channelId === node.channel.id}
		style:padding-left="{depth === 0 && !hasChildren ? 10 : 4 + depth * 14}px"
		draggable={renamingId !== node.channel.id && !ui.folderRenaming}
		role="presentation"
		oncontextmenu={(e) => openContext(e, node.channel)}
		ondragstart={(e) => startFolderDrag(e, node.channel.id)}
		ondragend={() => dnd.reset()}
		use:droptarget={{
			key,
			accepts: (kind) => canDropOnFolder(kind, node),
			ondrop: (e, kind) => dropOnFolder(e, kind, node),
			onhold: () => expandFolder(node)
		}}
	>
		{#if depth > 0 || hasChildren}
		<button
			class="chevron"
			class:open
			class:hidden={!hasChildren}
			type="button"
			tabindex={hasChildren ? 0 : -1}
			aria-label={open ? 'Collapse folder' : 'Expand folder'}
			aria-expanded={hasChildren ? open : undefined}
			onclick={() => ui.toggle(node.channel.id)}
		>
			<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3.500 4.500 4.500L6 12.500" /></svg>
		</button>
		{/if}
		{#if renamingId === node.channel.id}
			<FolderIcon channel={node.channel} />
			<RenameFolderInput channel={node.channel} onclose={() => (renamingId = null)} />
		{:else}
		<a
			class="link"
			href="/c/{node.channel.slug}"
			draggable="false"
			title={node.key}
			onclick={(event) => clickFolder(event, node)}
			ondblclick={(event) => doubleClickFolder(event, node)}
		>
			<FolderIcon channel={node.channel} />
			<span class="name">{node.label}</span>
			<span class="count">{node.channel.counts.contents}</span>
		</a>
		{/if}
	</div>

	{#if open}
		{#each node.children as child (child.channel.id)}
			{#if !searching || folderMatches(child)}
				{@render folderRow(child, depth + 1)}
			{/if}
		{/each}
	{/if}
{/snippet}

<svelte:window onpointerdown={dismissContext} onkeydown={contextKey} onresize={closeContext} />

{#if context}
	<div class="context-menu" role="menu" aria-label="Folder options" bind:this={contextMenu}
		style:left="{context.x}px" style:top="{context.y}px">
		<button type="button" role="menuitem" use:focusOnMount onclick={() => {
			const selected = context?.channel;
			closeContext();
			if (selected) editingIcon = selected;
		}}>Edit icon</button>
		<button type="button" role="menuitem" disabled={ui.folderRenaming} onclick={() => {
			const selected = context?.channel;
			closeContext();
			if (selected) renamingId = selected.id;
		}}>Rename</button>
		<a role="menuitem" href="https://www.are.na/channel/{encodeURIComponent(context.channel.slug)}"
			target="_blank" rel="noopener noreferrer" onclick={closeContext}>View in Are.na</a>
		<button type="button" role="menuitem" class="danger"
			disabled={deletingFolder || ui.folderRenaming || context.channel.can?.destroy === false}
			onclick={() => void confirmDeleteFolder()}>Delete folder</button>
	</div>
{/if}

{#if editingIcon}
	<FolderIconPicker
		current={readFolderIcon(editingIcon.description?.markdown)}
		busy={savingIcon}
		onselect={(icon) => void saveIcon(icon)}
		onclose={() => { if (!savingIcon) editingIcon = null; }}
	/>
{/if}

<aside class="sidebar">
	<div class="sidebar-header">
		{#if searchOpen}
			<div class="search">
				<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
					<circle cx="7" cy="7" r="4.500" />
					<path d="m10.500 10.500 3 3" />
				</svg>
				<input type="search" placeholder="Filter" bind:value={query} aria-label="Filter folders and channels"
					use:focusOnMount onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); void closeSearch(); } }} />
				<button class="icon-button close-search" type="button" aria-label="Close filter" onclick={() => void closeSearch()}>
					<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
				</button>
			</div>
		{:else}
			<a class="brand" href="/inbox" onclick={() => nav.clear()}><span aria-hidden="true">🌱</span> Seeds</a>
			<button class="icon-button" type="button" aria-label="Show filter" aria-expanded={searchOpen}
				bind:this={searchButton} onclick={openSearch}>
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
			</button>
		{/if}
	</div>

	<nav class="list">
		{#if inbox}
			{@const count = inbox.counts.contents}
			<a
				class="row inbox"
				class:active={onInboxPage || activeSlug === inbox.slug}
				class:drop={dnd.over === 'inbox'}
				href="/inbox"
				draggable="false"
				onclick={() => nav.clear()}
				use:droptarget={{
					key: 'inbox',
					accepts: (kind) => canDropOnChannel(kind, inbox),
					ondrop: (e, kind) => handleChannelDrop(e, kind, inbox)
				}}
			>
				<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
					<path d="M2.500 9.500 4.200 4.300A1 1 0 0 1 5.150 3.600h5.700a1 1 0 0 1 .95.700L13.500 9.500v2.500a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.500Zm0 0h3.200l.8 1.500h3l.8-1.500h3.200" />
				</svg>
				<span class="name">Inbox</span>
				{#if count > 0}
					<span class="badge" aria-label="{count} unsorted">{count > 999 ? '999+' : count}</span>
				{/if}
			</a>
		{:else if channels.loaded}
			<button class="row setup" type="button" onclick={() => (ui.initPrompt = true)}>
				<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M8 3.500v9M3.500 8h9" /></svg>
				<span class="name">Set up Inbox</span>
			</button>
		{/if}

		<div
			class="section"
			class:drop={dnd.over === 'folders-root'}
			use:droptarget={{
				key: 'folders-root',
				accepts: (kind) => {
					const dragged = draggedFolder();
					return kind === 'folder' && dragged !== null && canNest(dragged, null);
				},
				ondrop: (_e, kind) => {
					const dragged = draggedFolder();
					if (kind === 'folder' && dragged) void nestFolder(dragged, null);
				}
			}}
		>
			<span class="heading">Folders</span>
			<button class="add" type="button" onclick={startCreating} title="New folder" aria-label="New folder">
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
			</button>
		</div>

		{#if creating}
			<div class="row creating" style:padding-left="4px">
				<span class="chevron hidden"></span>
				<span class="link">
					<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">
						<path d="M2.500 4.500a1.500 1.500 0 0 1 1.500-1.500h2.600l1.400 1.600H12a1.500 1.500 0 0 1 1.500 1.500v5.400A1.500 1.500 0 0 1 12 13H4a1.500 1.500 0 0 1-1.500-1.500v-7Z" />
					</svg>
					<input
						class="draft"
						type="text"
						placeholder="Folder name"
						maxlength="80"
						autocomplete="off"
						spellcheck="false"
						disabled={saving}
						bind:value={draft}
						onkeydown={onDraftKey}
						onblur={() => void commitCreating()}
						use:focusOnMount
					/>
				</span>
			</div>
		{/if}

		{#each visibleFolders as node (node.channel.id)}
			{@render folderRow(node, 0)}
		{/each}

		{#if !visibleFolders.length && !creating && (channels.loaded || searching)}
			<div class="note">{searching ? 'No matching folders' : 'No folders yet'}</div>
		{/if}

		<button
			class="section toggle"
			class:drop={dnd.over === 'channels-head'}
			type="button"
			aria-expanded={channelsOpen}
			onclick={() => ui.toggleChannels()}
			use:droptarget={{
				key: 'channels-head',
				// Hovering a collapsed Channels header opens it so a block can be dropped on a channel.
				accepts: (kind) => kind === 'block' && !channelsOpen,
				ondrop: () => ui.openChannels(),
				onhold: () => ui.openChannels()
			}}
		>
			<svg class="caret" class:open={channelsOpen} viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3.500 4.500 4.500L6 12.500" /></svg>
			<span class="heading">Other channels</span>
		</button>

		{#if channelsOpen}
			{#each visibleChannels as channel (channel.id)}
				{@const key = `c${channel.id}`}
				<a
					class="row plain"
					class:active={activeSlug === channel.slug}
					class:drop={dnd.over === key}
					href="/c/{channel.slug}"
					draggable="false"
					title={channel.title}
					onclick={() => nav.clear()}
					use:droptarget={{
						key,
						accepts: (kind) => canDropOnChannel(kind, channel),
						ondrop: (e, kind) => handleChannelDrop(e, kind, channel)
					}}
				>
					<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">
						<rect x="2.500" y="3" width="11" height="10" rx="2" />
						<path d="M2.500 6.500h11" />
					</svg>
					<span class="name">{channel.title}</span>
					{#if channel.visibility === 'private'}
						<svg class="lock" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-label="Private">
							<path d="M4.500 7V5a3.500 3.500 0 1 1 7 0v2H13v7H3V7h1.500Zm1.500 0h4V5a2 2 0 1 0-4 0v2Z" />
						</svg>
					{/if}
					<span class="count">{channel.counts.contents}</span>
				</a>
			{/each}

			{#if !visibleChannels.length && channels.loaded}
				<div class="note">{searching ? 'No matching channels' : 'No other channels'}</div>
			{/if}
		{/if}

		{#if channels.error}
			<div class="note error">
				{channels.error}
				<button type="button" onclick={() => channels.loadAll()}>Retry</button>
			</div>
		{:else if channels.loading}
			<div class="note">Loading…</div>
		{/if}
	</nav>

	<div class="footer">
		<button class="account" type="button" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen}>
			{#if auth.user?.avatar}
				<img src={auth.user.avatar} alt="" width="20" height="20" />
			{:else}
				<span class="initials">{auth.user?.initials}</span>
			{/if}
			<span class="name">{auth.user?.name}</span>
			<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m4 10 4-4 4 4" />
			</svg>
		</button>

		{#if menuOpen}
			<div class="menu">
				{#if !inbox && channels.loaded}
					<button
						type="button"
						onclick={() => {
							menuOpen = false;
							ui.initPrompt = true;
						}}
					>
						Initialize Inbox
					</button>
				{/if}
				<button type="button" onclick={() => auth.signOut()}>Sign out</button>
			</div>
		{/if}
	</div>
</aside>

<style>
	.context-menu {
		position: fixed;
		z-index: 80;
		width: 168px;
		padding: 4px;
		border-radius: 8px;
		background: var(--panel);
		box-shadow: 0 0 0 1px var(--line), 0 8px 24px rgba(0, 0, 0, 0.14);
	}

	.context-menu [role='menuitem'] {
		display: block;
		font: inherit;
		line-height: 20px;
		width: 100%;
		padding: 6px 10px;
		border: 0;
		border-radius: 5px;
		background: none;
		text-align: left;
	}

	.context-menu [role='menuitem']:not(:disabled):hover, .context-menu [role='menuitem']:focus-visible {
		background: var(--hover);
		outline: none;
	}

	.context-menu .danger {
		color: #c0392b;
	}

	.context-menu button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.sidebar {
		width: 244px;
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
		padding: 8px;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 28px;
		margin: 2px 10px 10px;
		flex: none;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 10px;
		height: 28px;
		border-radius: 6px;
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
	}

	.icon-button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted);
	}

	.brand:hover, .icon-button:hover {
		background: var(--hover);
		color: var(--text);
	}

	.brand:focus-visible, .icon-button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.search {
		position: relative;
		width: 100%;
		color: var(--muted);
	}

	.close-search {
		position: absolute;
		right: 4px;
		top: 4px;
		width: 20px;
		height: 20px;
	}

	.search > svg {
		position: absolute;
		left: 9px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}

	.search input {
		width: 100%;
		height: 28px;
		padding: 0 28px;
		border: 0;
		border-radius: 8px;
		background: var(--hover);
		outline: none;
		color: var(--text);
	}

	.search input::placeholder {
		color: var(--muted);
	}

	.search input:focus {
		background: var(--active);
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 10px 10px;
	}

	.section {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		width: 100%;
		height: 28px;
		margin-top: 10px;
		padding: 0 4px 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		text-align: left;
	}

	.section.toggle {
		justify-content: flex-start;
		gap: 5px;
		padding-left: 10px;
	}

	.section.toggle:hover .heading {
		color: var(--text);
	}

	.heading {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--muted);
	}

	.caret {
		flex: none;
		color: var(--muted);
		transition: transform 0.12s;
	}

	.caret.open {
		transform: rotate(90deg);
	}

	.add {
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted);
	}

	.add:hover {
		background: var(--hover);
		color: var(--text);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px 0 4px;
		border-radius: 8px;
		color: var(--text);
		position: relative;
	}

	/* Inbox / channels / setup rows have no chevron gutter. */
	.row.inbox,
	.row.plain,
	.row.setup {
		gap: 8px;
		padding-left: 10px;
	}

	.row.setup {
		width: 100%;
		border: 0;
		background: none;
		text-align: left;
		color: var(--muted);
	}

	.row:hover {
		background: var(--hover);
	}

	.row.active {
		background: var(--active);
	}

	.row.dragging {
		opacity: 0.45;
	}

	/* Drop highlight: shared by every kind of target. */
	.row.drop,
	.section.drop {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}

	.row.drop .count {
		background: rgba(47, 107, 255, 0.16);
		color: var(--accent);
	}

	.chevron {
		flex: none;
		width: 16px;
		height: 20px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: none;
		color: var(--muted);
	}

	.chevron svg {
		transition: transform 0.12s;
	}

	.chevron.open svg {
		transform: rotate(90deg);
	}

	.chevron:hover {
		background: var(--active);
	}

	.chevron.hidden {
		visibility: hidden;
	}

	.link {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.icon {
		flex: none;
		color: #55555a;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lock {
		flex: none;
		color: var(--faint);
	}

	.count {
		flex: none;
		min-width: 22px;
		padding: 0 6px;
		height: 16px;
		line-height: 16px;
		border-radius: 8px;
		background: var(--hover);
		color: var(--muted);
		font-size: 10.5px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.row.active .count {
		background: rgba(0, 0, 0, 0.06);
	}

	.badge {
		flex: none;
		min-width: 18px;
		height: 18px;
		padding: 0 6px;
		line-height: 18px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-size: 10.5px;
		font-weight: 600;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.draft {
		flex: 1;
		min-width: 0;
		height: 22px;
		padding: 0 6px;
		border: 0;
		border-radius: 5px;
		background: var(--panel);
		box-shadow: 0 0 0 1.5px var(--accent);
		outline: none;
		color: var(--text);
	}

	.draft:disabled {
		opacity: 0.6;
	}

	.note {
		padding: 8px 10px;
		color: var(--muted);
		font-size: 12px;
	}

	.note.error {
		color: #c0392b;
	}

	.note button {
		margin-left: 6px;
		border: 0;
		background: none;
		text-decoration: underline;
		padding: 0;
		color: inherit;
	}

	.footer {
		position: relative;
		padding: 8px 10px 10px;
		flex: none;
	}

	.account {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: none;
		text-align: left;
	}

	.account:hover {
		background: var(--hover);
	}

	.account img,
	.initials {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	.initials {
		display: grid;
		place-items: center;
		background: var(--active);
		font-size: 9px;
		font-weight: 600;
	}

	.account svg {
		color: var(--muted);
	}

	.menu {
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 44px;
		padding: 4px;
		background: var(--panel);
		border-radius: 10px;
		box-shadow:
			0 0 0 1px var(--line),
			0 8px 24px rgba(0, 0, 0, 0.1);
		z-index: 5;
	}

	.menu button {
		width: 100%;
		height: 28px;
		padding: 0 10px;
		border: 0;
		border-radius: 6px;
		background: none;
		text-align: left;
	}

	.menu button:hover {
		background: var(--hover);
	}
</style>
