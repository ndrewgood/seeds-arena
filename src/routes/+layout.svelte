<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, tick, untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { channels } from '$lib/channels.svelte';
	import { dnd, dragKind } from '$lib/dnd.svelte';
	import InitDialog from '$lib/components/InitDialog.svelte';
	import Login from '$lib/components/Login.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { ui } from '$lib/ui.svelte';

	let { children } = $props();

	let drawer = $state<HTMLDivElement>();

	const drawerOpen = $derived(ui.mobile && ui.sidebarOpen);

	function closeSidebar() {
		ui.sidebarOpen = false;
	}

	onMount(() => {
		const media = window.matchMedia('(max-width: 900px)');
		function updateMobile() {
			ui.mobile = media.matches;
			closeSidebar();
		}
		updateMobile();
		media.addEventListener('change', updateMobile);
		void auth.init();
		return () => media.removeEventListener('change', updateMobile);
	});

	afterNavigate(closeSidebar);

	$effect(() => {
		if (!drawerOpen || !drawer) return;
		const panel = drawer;
		const previousFocus = document.activeElement;
		const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
			'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'
		)).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') &&
			!element.closest('[inert]') && element.getClientRects().length > 0);
		panel.querySelector<HTMLButtonElement>('.close-sidebar')?.focus();

		function trapKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				closeSidebar();
			} else if (event.key === 'Tab') {
				const elements = focusable();
				const first = elements[0] ?? panel;
				const last = elements.at(-1) ?? panel;
				if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) {
					event.preventDefault();
					first.focus();
				}
			}
		}
		function trapFocus(event: FocusEvent) {
			if (!panel.contains(event.target as Node)) (focusable()[0] ?? panel).focus();
		}
		window.addEventListener('keydown', trapKeydown, true);
		document.addEventListener('focusin', trapFocus);
		return () => {
			window.removeEventListener('keydown', trapKeydown, true);
			document.removeEventListener('focusin', trapFocus);
			void tick().then(() => {
				if (ui.mobile && ui.sidebarOpen) return;
				if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
					!previousFocus.closest('[inert]') && previousFocus.getClientRects().length) {
					previousFocus.focus();
				} else if (!ui.mobile && panel.isConnected) {
					focusable()[0]?.focus();
				}
			});
		};
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
		<div
			id="sidebar-drawer"
			class="sidebar-drawer"
			class:open={drawerOpen}
			bind:this={drawer}
			role={drawerOpen ? 'dialog' : undefined}
			aria-modal={drawerOpen ? true : undefined}
			aria-label={drawerOpen ? 'Navigation' : undefined}
			aria-hidden={ui.mobile && !ui.sidebarOpen ? true : undefined}
			inert={ui.mobile && !ui.sidebarOpen}
			tabindex="-1"
		>

			<Sidebar />
		</div>
		{#if drawerOpen}
			<button class="drawer-backdrop" type="button" tabindex="-1" aria-label="Dismiss sidebar" onclick={closeSidebar}></button>
		{/if}
		<div class="workspace" inert={drawerOpen}>
			<header class="mobile-toolbar">
				<button class="panel-button" type="button" aria-label="Toggle sidebar" aria-expanded={drawerOpen} aria-controls="sidebar-drawer" onclick={() => ui.sidebarOpen = !ui.sidebarOpen}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<rect x="3" y="4" width="18" height="16" rx="2" />
						<path d="M9 4v16" />
					</svg>
				</button>
				<span>🌱 Seeds</span>
			</header>
			<main class="panel">
				{@render children()}
			</main>
			{#if ui.initPrompt && !channels.inbox}
				<InitDialog />
			{/if}
		</div>
	</div>
{:else if auth.status === 'signed-out'}
	<Login />
{/if}

{#if dnd.current?.kind === 'block' && dnd.copy}
	<div class="drag-hint" role="status">
		<span aria-hidden="true">⌘</span> Connect to folder — keep in original
	</div>
{/if}

<div inert={drawerOpen}>
	<Toasts />
</div>

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
		height: 100dvh;
		gap: 0;
	}

	.sidebar-drawer {
		display: flex;
		width: 244px;
		flex: none;
		min-height: 0;
	}

	.workspace {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}

	.mobile-toolbar {
		display: none;
	}

	.panel-button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		padding: 0;
		border: 0;
		background: transparent;
		border-radius: 6px;
	}

	.panel-button:hover {
		background: var(--hover);
	}

	.panel-button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -4px;
	}

	.drawer-backdrop {
		display: none;
	}

	@media (max-width: 900px) {
		.mobile-toolbar {
			display: flex;
			align-items: center;
			height: 44px;
			flex: none;
			gap: 4px;
			font-weight: 600;
			/*border-bottom: 1px solid var(--line);*/
		}

		.sidebar-drawer {
			width: 300px;
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 120;
			flex-direction: column;
			max-width: calc(100vw - 44px);
			height: 100dvh;
			background: var(--bg);
			transform: translateX(-100%);
			visibility: hidden;
			transition: transform 200ms ease, visibility 200ms;
		}

		.sidebar-drawer.open {
			transform: translateX(0);
			visibility: visible;
			box-shadow: 8px 0 24px rgba(0, 0, 0, 0.15);
		}

		.sidebar-drawer :global(.sidebar) {
			width: 100%;
			flex: 1;
		}

		.drawer-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 110;
			border: 0;
			padding: 0;
			background: rgba(0, 0, 0, 0.3);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sidebar-drawer {
			transition: none;
		}
	}

	.panel {
		flex: 1;
		min-height: 0;
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
