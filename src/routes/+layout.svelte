<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { channels } from '$lib/channels.svelte';
	import { dnd, dragKind } from '$lib/dnd.svelte';
	import InitDialog from '$lib/components/InitDialog.svelte';
	import Login from '$lib/components/Login.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { ui } from '$lib/ui.svelte';

	let { children } = $props();

	onMount(() => {
		void auth.init();
	});

	$effect(() => {
		const slug = auth.status === 'ready' ? auth.user?.slug : null;
		if (!slug) return;
		untrack(() => {
			channels.reset(slug);
			void channels.loadAll();
		});
	});

	// Right after signing in, offer to create the Inbox if the account doesn't have one yet.
	$effect(() => {
		if (!auth.justSignedIn || !channels.loaded) return;
		untrack(() => {
			auth.justSignedIn = false;
			if (!channels.inbox) ui.initPrompt = true;
		});
	});

	// Things get added to the Inbox from elsewhere (extensions, other tabs), so refresh its badge on focus.
	function onfocus() {
		const inbox = channels.inbox;
		if (inbox && auth.status === 'ready') void channels.refreshCounts(inbox.id);
	}

	// A file dropped outside a drop target would make the browser navigate away from the app.
	function stopStrayDrop(e: DragEvent) {
		dnd.updateModifiers(e);
		if (dragKind(e)) e.preventDefault();
		if (e.type === 'drop') dnd.reset();
	}

	function updateDragModifiers(e: DragEvent | KeyboardEvent) {
		dnd.updateModifiers(e);
	}

	// If a drag ends anywhere (cancelled, dropped on nothing), clear highlighting.
	function resetDnd() {
		if (dnd.over !== null || dnd.current !== null) dnd.reset();
	}
</script>

<svelte:window {onfocus} ondragover={stopStrayDrop} ondrop={stopStrayDrop} ondragend={resetDnd}
	ondrag={updateDragModifiers} onkeydown={updateDragModifiers} onkeyup={updateDragModifiers} />

<svelte:head>
	<title>Seeds</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if auth.status === 'ready'}
	<div class="app">
		<Sidebar />
		<main class="panel">
			{@render children()}
		</main>
	</div>
	{#if ui.initPrompt && !channels.inbox}
		<InitDialog />
	{/if}
{:else if auth.status === 'signed-out'}
	<Login />
{/if}

{#if dnd.current?.kind === 'block' && dnd.copy}
	<div class="drag-hint" role="status">
		<span aria-hidden="true">⌘</span> Connect to folder — keep in original
	</div>
{/if}

<Toasts />

<style>
	.drag-hint {
		position: fixed;
		z-index: 100;
		left: 50%;
		bottom: 20px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: calc(100vw - 32px);
		padding: 9px 14px;
		border-radius: 8px;
		background: var(--text);
		color: var(--panel);
		font-size: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		pointer-events: none;
	}

	.app {
		display: flex;
		height: 100vh;
		gap: 0;
	}

	.panel {
		flex: 1;
		min-width: 0;
		position: relative;
		background: var(--panel);
		border-radius: var(--radius);
		box-shadow:
			0 0 0 1px var(--line),
			0 1px 3px rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}
</style>
