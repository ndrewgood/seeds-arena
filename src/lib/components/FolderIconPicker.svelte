<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { iconoirIcons, DEFAULT_FOLDER_ICON, type FolderIcon } from '$lib/folder-icons';
	import IconoirGlyph from './IconoirGlyph.svelte';

	let { current, busy, onselect, onclose }: {
		current: FolderIcon | null;
		busy: boolean;
		onselect: (icon: FolderIcon | null) => void;
		onclose: () => void;
	} = $props();

	const id = $props.id();
	const pageSize = 120;
	const styles = [
		{ value: 'all', label: 'All' },
		{ value: 'regular', label: 'Outline' },
		{ value: 'solid', label: 'Solid' }
	] as const;
	let query = $state('');
	let style = $state<'all' | 'regular' | 'solid'>('all');
	let visibleLimit = $state(pageSize);
	let dialog: HTMLDivElement;
	let search: HTMLInputElement;
	let grid: HTMLDivElement;
	const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
	const filteredIcons = $derived(iconoirIcons.filter((entry) =>
		(style === 'all' || entry.style === style) &&
		words.every((word) => entry.label.toLowerCase().includes(word))
	));
	const visibleIcons = $derived(filteredIcons.slice(0, visibleLimit));
	const currentName = $derived(current?.value ?? DEFAULT_FOLDER_ICON);
	const currentEntry = $derived(iconoirIcons.find((entry) => entry.value === currentName));
	const currentLabel = $derived(current ? (currentEntry ? iconLabel(currentEntry) : current.value) : 'Default folder');

	function iconLabel(entry: typeof iconoirIcons[number]) {
		return `${entry.label} (${entry.style === 'solid' ? 'Solid' : 'Outline'})`;
	}

	function resetVisible() {
		visibleLimit = pageSize;
		grid.scrollTop = 0;
	}

	async function showMore() {
		const firstNewIndex = visibleIcons.length;
		visibleLimit += pageSize;
		await tick();
		// Move focus into the newly revealed page, including when the last page removes this button.
		grid.querySelectorAll<HTMLButtonElement>('button')[firstNewIndex]?.focus();
	}

	function select(icon: FolderIcon | null) {
		if (!busy) onselect(icon);
	}

	function close() {
		if (!busy) onclose();
	}

	onMount(() => {
		const previousFocus = document.activeElement;
		search.focus();

		function keydown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				close();
			} else if (event.key === 'Tab') {
				const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
					'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
				)).filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]'));
				const index = elements.indexOf(document.activeElement as HTMLElement);
				const next = event.shiftKey
					? (index <= 0 ? elements.length - 1 : index - 1)
					: (index + 1) % elements.length;
				event.preventDefault();
				(elements[next] ?? dialog).focus();
			}
		}

		document.addEventListener('keydown', keydown, true);
		return () => {
			document.removeEventListener('keydown', keydown, true);
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(event) => { if (event.target === event.currentTarget) close(); }}>
	<div bind:this={dialog} class="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy} tabindex="-1">
		<header>
			<h2 id={`${id}-title`}>Choose folder icon</h2>
			<button class="close" type="button" aria-label="Close icon picker" disabled={busy} onclick={close}>×</button>
		</header>

		<div class="current" aria-label={`Current selection: ${currentLabel}`}>
			<span class="preview" aria-hidden="true"><IconoirGlyph name={currentName} size={20} /></span>
			<span>Current: <strong>{currentLabel}</strong></span>
		</div>

		<label class="sr-only" for={`${id}-search`}>Search Iconoir icons</label>
		<input bind:this={search} id={`${id}-search`} class="search" type="search" value={query} oninput={(event) => { query = event.currentTarget.value; resetVisible(); }} placeholder="Search all icons…" autocomplete="off" />

		<div class="filters" role="group" aria-label="Icon style">
			{#each styles as option}
				<button type="button" aria-pressed={style === option.value} onclick={() => { style = option.value; resetVisible(); }}>{option.label}</button>
			{/each}
		</div>

		<p class="counts" role="status">{filteredIcons.length} matching · {iconoirIcons.length} icons in catalog · {visibleIcons.length} shown</p>

		<div bind:this={grid} id={`${id}-grid`} class="grid" role="group" aria-label="Folder icons">
			{#each visibleIcons as entry (entry.value)}
				<button class="tile" type="button" aria-label={`${iconLabel(entry)} icon`} title={iconLabel(entry)} aria-pressed={current?.value === entry.value} disabled={busy} onclick={() => select({ kind: 'icon', library: 'iconoir', value: entry.value })}>
					<span aria-hidden="true"><IconoirGlyph name={entry.value} size={21} /></span>
				</button>
			{/each}
			{#if !filteredIcons.length}<p class="empty">No icons found. Try another search or style.</p>{/if}
		</div>

		{#if visibleIcons.length < filteredIcons.length}
			<button class="show-more" type="button" aria-controls={`${id}-grid`} aria-label={`Show ${Math.min(pageSize, filteredIcons.length - visibleIcons.length)} more icons`} disabled={busy} onclick={showMore}>Show more ({Math.min(pageSize, filteredIcons.length - visibleIcons.length)})</button>
		{/if}

		<footer>
			<button class="reset" type="button" disabled={busy} onclick={() => select(null)}><span aria-hidden="true"><IconoirGlyph name={DEFAULT_FOLDER_ICON} size={16} /></span> Use default</button>
			<span class="status" role="status">{busy ? 'Saving…' : 'Select to save'}</span>
		</footer>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 16px;
		background: color-mix(in srgb, var(--bg) 65%, transparent);
		backdrop-filter: blur(4px);
	}
	.dialog {
		width: 100%;
		max-width: 430px;
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		box-sizing: border-box;
		padding: 16px;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 16px 48px rgb(0 0 0 / 16%);
	}
	header, footer, .current { display: flex; align-items: center; gap: 10px; }
	header, footer { justify-content: space-between; }
	h2 { margin: 0; font-size: 15px; font-weight: 600; }
	button, input { font: inherit; color: var(--text); }
	button { border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
	button:hover:not(:disabled) { background: var(--hover); }
	button:disabled { opacity: 0.45; cursor: default; }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.close { width: 28px; height: 28px; font-size: 23px; line-height: 1; color: var(--muted); }
	.current { margin: 12px 0; font-size: 12px; color: var(--muted); }
	.current strong { color: var(--text); font-weight: 500; overflow-wrap: anywhere; }
	.preview { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border-radius: 8px; background: var(--hover); color: var(--text); }
	.filters { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
	.filters button { flex: 1; padding: 7px; color: var(--muted); font-size: 13px; }
	.filters button[aria-pressed='true'] { background: var(--active); color: var(--text); font-weight: 600; }
	input { min-width: 0; box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); font-size: 13px; }
	input::placeholder { color: var(--muted); }
	.search { margin-bottom: 12px; }
	.counts { margin: 10px 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 4px; max-height: 280px; overflow-y: auto; padding: 3px; }
	.tile { display: grid; place-items: center; min-width: 0; height: 40px; border: 1px solid transparent; }
	.tile span, .reset span { display: flex; }
	.tile[aria-pressed='true'] { background: var(--active); border-color: var(--accent); color: var(--accent); }
	.empty { grid-column: 1 / -1; padding: 16px 0; margin: 0; text-align: center; font-size: 13px; color: var(--muted); }
	.show-more { width: 100%; margin-top: 10px; padding: 8px 10px; background: var(--active); font-size: 12px; }
	footer { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
	.reset { display: flex; align-items: center; gap: 7px; padding: 6px 8px; font-size: 12px; }
	.status { color: var(--muted); font-size: 11px; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
