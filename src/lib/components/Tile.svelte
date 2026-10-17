<script lang="ts">
	import { dnd, type DragSource } from '$lib/dnd.svelte';
		import { blockdrag } from '$lib/blockdrag';
	import { previews } from '$lib/previews.svelte';
	import { displayTitle, folderMembers, folderSummary, isFolder } from '$lib/seeds';
		import { channels } from '$lib/channels.svelte';
	import type { Connectable } from '$lib/types';
	import FolderIcon from './FolderIcon.svelte';
	import {
		downloadFile,
		fileExt,
		hostOf,
		imageFor,
		isGif,
		itemTitle,
		linkUrl,
		pickImage,
		videoSrc
	} from '$lib/media';

	let {
		item,
		width,
		source,
		onopen
	}: {
		item: Connectable;
		width: number;
		source: DragSource;
		onopen: () => void;
	} = $props();

	// Channel and folder tiles show a few thumbnails of what's inside, fetched once they're on screen.
	const thumbs = $derived(item.type === 'Channel' && isFolder(item) ? previews.get(item.id) : undefined);

	let visible = $state(false);
	$effect(() => {
		if (visible && item.type === 'Channel' && isFolder(item)) {
			previews.request(item, folderMembers(item, channels.folders.all));
		}
	});

	function preview(node: HTMLElement, channel: Extract<Connectable, { type: 'Channel' }>) {
		if (!isFolder(channel)) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				visible = true;
				observer.disconnect();
			}
		});
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const image = $derived(imageFor(item));
	const video = $derived(videoSrc(item));
	const img = $derived(image ? pickImage(image, width) : null);
	const url = $derived(linkUrl(item));
	const badge = $derived(video ? 'Video' : image && isGif(image) ? 'GIF' : null);

	let videoEl: HTMLVideoElement | undefined = $state();
	let downloading = $state(false);

	async function download() {
		if (!image || downloading) return;
		downloading = true;
		try {
			await downloadFile(image.src, image.filename || `seeds-${item.id}`);
		} finally {
			downloading = false;
		}
	}

	function play() {
		videoEl?.play().catch(() => {});
	}

	function stop() {
		if (!videoEl) return;
		videoEl.pause();
		videoEl.currentTime = 0;
	}
</script>

{#if item.type === 'Channel'}
	<a
		class="tile channel"
		href="/c/{item.slug}"
		draggable="false"
		title={item.title}
		onclick={onopen}
		use:preview={item}
	>
		{#if thumbs && thumbs.length}
			<div class="thumbs" class:one={thumbs.length === 1} aria-hidden="true">
				{#each thumbs as src (src)}
					<img {src} alt="" loading="lazy" decoding="async" draggable="false" />
				{/each}
			</div>
		{:else if !isFolder(item)}
			<svg class="glyph" viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
				<rect x="2.5" y="3" width="11" height="10" rx="2" />
				<path d="M2.5 6.5h11" />
			</svg>
		{/if}
		<span class="label">
			<span class="folder-title">
				{#if isFolder(item)}<FolderIcon channel={item} />{/if}
				<span class="title">{displayTitle(item)}</span>
			</span>
			<span class="meta">{#if isFolder(item)}{folderSummary(item, channels.folders.all)}{:else}{item.counts.contents} {item.counts.contents === 1 ? 'item' : 'items'}{/if}</span>
		</span>
	</a>
{:else}
	<div
		class="wrap"
		class:dragging={dnd.current?.kind === 'block' && dnd.current.blockId === item.id}
		draggable="true"
		onmouseenter={play}
		onmouseleave={stop}
		use:blockdrag={{ item, source }}
		role="presentation"
	>
		<button class="tile" type="button" draggable="false" aria-label={itemTitle(item)} onclick={onopen}>
			{#if video}
				<video
					bind:this={videoEl}
					src={image ? video : `${video}#t=0.1`}
					poster={image?.medium.src}
					preload={image ? 'none' : 'metadata'}
					muted
					loop
					playsinline
				></video>
			{:else if img && image}
				<img
					src={img.src}
					srcset={img.srcset}
					alt={image.alt_text ?? ''}
					loading="lazy"
					decoding="async"
					draggable="false"
				/>
				{#if item.type === 'Embed'}
					<span class="play" aria-hidden="true">
						<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.8-4.8a.5.5 0 0 0 0-.86l-7.8-4.8A.5.5 0 0 0 5 3.2Z" /></svg>
					</span>
				{/if}
			{:else if item.type === 'Text'}
				<div class="text">{item.content.plain}</div>
			{:else if item.type === 'Attachment'}
				<div class="card">
					<span class="ext">{fileExt(item) || 'file'}</span>
					<span class="title">{itemTitle(item)}</span>
				</div>
			{:else}
				<div class="card">
					<span class="title">{itemTitle(item)}</span>
				</div>
			{/if}
		</button>

		{#if image}
			<button class="download" type="button" draggable="false" disabled={downloading}
				aria-label={downloading ? 'Downloading…' : isGif(image) ? 'Download GIF' : 'Download image'}
				title={downloading ? 'Downloading…' : isGif(image) ? 'Download GIF' : 'Download image'}
				onclick={(e) => { e.stopPropagation(); void download(); }}>
				<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M4.5 7 8 10.5 11.5 7M3 13h10" /></svg>
			</button>
		{/if}

		{#if badge || url}
			<div class="hover-actions" class:has-download={image !== null}>
				{#if badge}
					<span class="badge">{badge}</span>
				{/if}
				{#if url}
					<a
						class="link"
						draggable="false"
						href={url}
						target="_blank"
						rel="noreferrer noopener"
						title={url}
						aria-label="Open {hostOf(url)}"
					>
						<span class="host">{hostOf(url)}</span>
						<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.500 3.500 12.500" /></svg>
					</a>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 6px;
		transition: box-shadow 0.12s;
	}

	.wrap:hover {
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.14);
	}

	.wrap.dragging {
		opacity: 0.45;
	}

	.tile {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: var(--tile);
		overflow: hidden;
		text-align: left;
		color: inherit;
		transition: box-shadow 0.12s;
	}

	a.tile:hover {
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.14);
	}

	.tile:focus-visible {
		outline: 2px solid rgba(0, 0, 0, 0.5);
		outline-offset: 1px;
	}

	img,
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		user-select: none;
	}

	.download {
		position: absolute;
		right: 6px;
		bottom: 6px;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.86);
		backdrop-filter: blur(8px);
		color: var(--text);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s, background 0.12s;
	}

	.wrap:hover .download,
	.wrap:focus-within .download {
		opacity: 1;
		pointer-events: auto;
	}

	.download:hover:not(:disabled) { background: #fff; }
	.download:disabled { opacity: 0.5; cursor: default; }
	.download:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

	@media (hover: none) {
		.download { opacity: 1; pointer-events: auto; }
	}

	.hover-actions {
		position: absolute;
		left: 6px;
		bottom: 6px;
		max-width: calc(100% - 12px);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.12s;
		pointer-events: none;
	}

	.hover-actions.has-download {
		max-width: calc(100% - 44px);
	}

	.wrap:hover .hover-actions,
	.wrap:focus-within .hover-actions {
		opacity: 1;
	}

	.badge,
	.link {
		max-width: 100%;
		padding: 2px 7px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.86);
		backdrop-filter: blur(8px);
		font-size: 10.5px;
		font-weight: 500;
		line-height: 16px;
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		pointer-events: auto;
		transition: background 0.12s;
	}

	.link:hover {
		background: #fff;
	}

	.host {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.play {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(8px);
		color: var(--text);
		pointer-events: none;
	}

	.text {
		height: 100%;
		padding: 12px 14px;
		font-size: 12px;
		line-height: 1.5;
		color: #3a3a3d;
		overflow: hidden;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		mask-image: linear-gradient(to bottom, #000 70%, transparent);
	}

	.card,
	.channel {
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 2px;
		padding: 12px 14px;
	}

	.channel {
		justify-content: space-between;
		align-items: flex-start;
		color: #55555a;
		gap: 8px;
	}

	.channel .label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 100%;
		margin-top: auto;
	}

	.channel .title {
		color: var(--text);
		font-weight: 500;
	}

	/* A 2x2 contact sheet of what's inside. */
	.thumbs {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-auto-rows: 1fr;
		gap: 3px;
	}

	.thumbs.one {
		grid-template-columns: 1fr;
	}

	.thumbs img {
		min-width: 0;
		min-height: 0;
		border-radius: 3px;
		background: var(--active);
	}

	.glyph {
		flex: none;
	}

	.folder-title {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.ext {
		margin-bottom: auto;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.title {
		font-size: 12px;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow-wrap: anywhere;
	}

	.meta {
		font-size: 11px;
		color: var(--muted);
	}
</style>
