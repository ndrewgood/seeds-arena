<script lang="ts">
	import {
		downloadFile,
		embedIframeSrc,
		hostOf,
		imageFor,
		isGif,
		itemTitle,
		linkUrl,
		videoSrc
	} from '$lib/media';
	import { dnd, type DragSource } from '$lib/dnd.svelte';
		import { blockdrag } from '$lib/blockdrag';
	import type { Block } from '$lib/types';
	import { tick } from 'svelte';
	import BlockEditor from './BlockEditor.svelte';
	import { removeBlockFromFolder } from '$lib/operations';

	let {
		items,
		index,
		source,
		onclose,
		onstep
	}: {
		items: Block[];
		index: number;
		source: DragSource;
		onclose: () => void;
		onstep: (delta: number) => void;
	} = $props();

	const item = $derived(items[index]);
	const image = $derived(imageFor(item));
	const video = $derived(videoSrc(item));
	const iframeSrc = $derived(item.type === 'Embed' ? embedIframeSrc(item.embed.html) : null);
	const url = $derived(linkUrl(item));
	const embedRatio = $derived(
		item.type === 'Embed' && item.embed.width && item.embed.height
			? item.embed.width / item.embed.height
			: 16 / 9
	);

	// Only offered for actual image blocks (including GIFs), not link/embed thumbnails.
	const downloadable = $derived(item.type === 'Image' ? item.image : null);

	let downloading = $state(false);
	let editing = $state(false);
	let saving = $state(false);
	let removing = $state(false);

	async function remove() {
		if (saving || removing || editing || !item.connection?.id) return;
		if (!window.confirm('Remove this block from the current folder? It will remain in any other channels.')) return;
		removing = true;
		try {
			await removeBlockFromFolder(item, source);
		} finally {
			removing = false;
		}
	}
	let editButton: HTMLButtonElement | undefined = $state();

	async function closeEditor() {
		if (saving) return;
		editing = false;
		await tick();
		editButton?.focus();
	}

	function close() {
		if (!saving && !removing) onclose();
	}

	async function download() {
		if (!downloadable || downloading) return;
		downloading = true;
		await downloadFile(downloadable.src, downloadable.filename || `seeds-${item.id}`);
		downloading = false;
	}


	function onkeydown(e: KeyboardEvent) {
		if (removing || e.metaKey || e.ctrlKey || e.altKey) return;
		if (editing) {
			if (e.key === 'Escape') {
				e.preventDefault();
				void closeEditor();
			}
			return;
		}
		const target = e.target;
		if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowRight') onstep(1);
		else if (e.key === 'ArrowLeft') onstep(-1);
		else return;
		e.preventDefault();
	}

	// Close when clicking the empty backdrop, but not the media or controls.
	function onbackdrop(e: MouseEvent) {
		const el = e.target as HTMLElement;
		if (!editing && (el === e.currentTarget || el.classList.contains('stage'))) close();
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label={itemTitle(item)} onclick={onbackdrop}>
	<button class="edit" type="button" aria-label="Edit block" title="Edit block"
		aria-expanded={editing} aria-controls={editing ? 'block-editor' : undefined}
		bind:this={editButton} disabled={saving || removing} onclick={() => editing ? closeEditor() : (editing = true)}>
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.5 2.5 3 3M3 10l7.5-7.5a2.12 2.12 0 0 1 3 3L6 13l-4 1 1-4Z" /></svg>
	</button>

	<button class="remove" type="button" aria-label="Remove block from folder"
		title={editing ? 'Close the editor to remove this block' : 'Remove block from folder'}
		disabled={saving || removing || editing || !item.connection?.id} onclick={remove}>
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4" /></svg>
	</button>

	<div class="viewer-content">
	<button class="close" type="button" aria-label="Close" onclick={close} disabled={saving || removing}>
		<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>
	</button>

	{#if index > 0 && !editing}
		<button class="nav prev" type="button" aria-label="Previous" disabled={removing} onclick={() => onstep(-1)}>
			<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m10 3-5 5 5 5" /></svg>
		</button>
	{/if}
	{#if index < items.length - 1 && !editing}
		<button class="nav next" type="button" aria-label="Next" disabled={removing} onclick={() => onstep(1)}>
			<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5" /></svg>
		</button>
	{/if}

	<div class="stage">
		{#key item.id}
			{#if video}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					class="media"
					src={video}
					poster={image?.large.src}
					controls
					autoplay
					loop
					playsinline
				></video>
			{:else if iframeSrc}
				<iframe
					class="embed"
					style:--ratio={embedRatio}
					src={iframeSrc}
					title={itemTitle(item)}
					sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
					allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
					allowfullscreen
				></iframe>
			{:else if image}
				<img
					class="media"
					class:dragging={dnd.current?.kind === 'block' && dnd.current.blockId === item.id}
					src={isGif(image) ? image.src : image.large.src}
					srcset={isGif(image) ? undefined : `${image.large.src} 1x, ${image.large.src_2x} 2x`}
					alt={image.alt_text ?? ''}
					draggable="true"
					use:blockdrag={{ item, source }}
				/>
			{:else if item.type === 'Text'}
				<div class="text">{item.content.plain}</div>
			{:else}
				<div class="text">{itemTitle(item)}</div>
			{/if}
		{/key}
	</div>

	<footer>
		<div class="info">
			<span class="title">{itemTitle(item)}</span>
			{#if item.user?.name}
				<span class="sub">Added by {item.user.name}</span>
			{/if}
		</div>
		<div class="actions">

			<span class="pos">{index + 1} / {items.length}</span>
			<a class="ghost" href="https://www.are.na/block/{item.id}" target="_blank" rel="noreferrer noopener">Open in Are.na</a>

			{#if downloadable}
				<button class="pill" type="button" onclick={download} disabled={downloading}>
					<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.5 7 8 10.5 11.5 7M3 13h10" /></svg>
					{downloading ? 'Downloading…' : isGif(downloadable) ? 'Download GIF' : 'Download'}
				</button>
			{:else if item.type === 'Attachment' && !video}
				<a class="pill" href={item.attachment.url} target="_blank" rel="noreferrer noopener" download>
					<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.5 7 8 10.5 11.5 7M3 13h10" /></svg>
					Download
				</a>
			{/if}

			{#if url}
				<a class="pill primary" href={url} target="_blank" rel="noreferrer noopener" title={url}>
					Visit {hostOf(url)}
					<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 3.5 12.5" /></svg>
				</a>
			{/if}
		</div>
	</footer>
	</div>

	{#if editing}
		<div id="block-editor" class="editor-container">
			{#key item.id}
				<BlockEditor {item} bind:saving oncancel={closeEditor} onsaved={() => {
					editing = false;
					void tick().then(() => editButton?.focus());
				}} />
			{/key}
		</div>
	{/if}
</div>

<style>
	.overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		background: rgba(255, 255, 255, 0.94);
		backdrop-filter: blur(24px);
		animation: fade 0.12s ease-out;
	}

	.viewer-content {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.editor-container {
		display: contents;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	/*
	 * The stage is a size container, so media can be capped to the stage's real
	 * width/height with cq units. This keeps tall images from overflowing the viewport.
	 */
	.stage {
		flex: 1;
		min-height: 0;
		container-type: size;
		display: grid;
		place-items: center;
		padding: 56px 72px 8px;
	}

	.media {
		display: block;
		max-width: 100cqw;
		max-height: 100cqh;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 6px;
		box-shadow: 0 6px 30px rgba(0, 0, 0, 0.1);
		background: var(--tile);
	}

	.media.dragging {
		opacity: 0.4;
	}

	.embed {
		display: block;
		border: 0;
		border-radius: 6px;
		aspect-ratio: var(--ratio, 1.7778);
		width: min(100cqw, 100cqh * var(--ratio, 1.7778), 1200px);
		background: var(--tile);
		box-shadow: 0 6px 30px rgba(0, 0, 0, 0.1);
	}

	.text {
		max-width: min(620px, 100cqw);
		max-height: 100cqh;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 15px;
		line-height: 1.6;
	}

	.close,
	.edit,
	.remove,
	.nav {
		position: absolute;
		z-index: 2;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 50%;
		background: var(--hover);
		display: grid;
		place-items: center;
		color: var(--text);
		transition: background 0.12s;
	}

	.close:hover:not(:disabled),
	.edit:hover:not(:disabled),
	.nav:hover {
		background: var(--active);
	}

	.close {
		top: 14px;
		left: 14px;
	}

	.edit {
		top: 14px;
		right: 14px;
		z-index: 4;
	}

	.remove {
		top: 14px;
		right: 52px;
		z-index: 4;
	}

	.remove:hover:not(:disabled) {
		background: rgba(192, 57, 43, 0.1);
		color: #c0392b;
	}

	.edit[aria-expanded='true'] {
		background: var(--active);
	}

	button:focus-visible, a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	button:disabled { opacity: 0.5; cursor: default; }

	.nav {
		top: 50%;
		transform: translateY(-50%);
	}

	.prev {
		left: 20px;
	}

	.next {
		right: 20px;
	}

	footer {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 16px;
		padding: 10px 20px 16px;
	}

	.info {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.title {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		color: var(--muted);
		font-size: 12px;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		margin-left: auto;
		gap: 10px;
		color: var(--muted);
		font-size: 12px;
	}

	.ghost:hover {
		color: var(--text);
	}


	.pos {
		font-variant-numeric: tabular-nums;
		margin-right: 4px;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 13px;
		border: 0;
		border-radius: 15px;
		background: var(--active);
		color: var(--text);
		font-size: 12.5px;
		font-weight: 500;
		white-space: nowrap;
		transition:
			background 0.12s,
			opacity 0.12s;
	}

	.pill:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.12);
	}

	.pill:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.pill.primary {
		background: var(--text);
		color: #fff;
	}

	.pill.primary:hover {
		background: #000;
	}
</style>
