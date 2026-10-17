<script lang="ts">
	import { dnd, type DragSource } from '$lib/dnd.svelte';
		import { blockdrag } from '$lib/blockdrag';
	import { keyOf } from '$lib/feed.svelte';
	import { fileExt, imageFor, itemTitle, linkUrl, pickImage, videoSrc } from '$lib/media';
	import { displayTitle, folderSummary, isFolder } from '$lib/seeds';
		import { channels } from '$lib/channels.svelte';
	import type { Channel, Connectable } from '$lib/types';
	import FolderIcon from './FolderIcon.svelte';

	let {
		items,
		source,
		onopen,
		onchannel
	}: {
		items: Connectable[];
		source: DragSource;
		onopen: (key: string) => void;
		onchannel: (channel: Channel) => void;
	} = $props();
</script>

{#snippet thumbnail(item: Connectable)}
	{@const image = imageFor(item)}
	{@const img = image ? pickImage(image, 400) : null}
	{@const video = videoSrc(item)}
	{#if item.type === 'Channel'}
		<span class="placeholder">
			{#if isFolder(item)}
				<FolderIcon channel={item} size={24} />
			{:else}
				<svg viewBox="0 0 16 16" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
					<rect x="2.5" y="3" width="11" height="10" rx="2" />
					<path d="M2.5 6.5h11" />
				</svg>
			{/if}
			<span>{#if isFolder(item)}{folderSummary(item, channels.folders.all)}{:else}{item.counts.contents} {item.counts.contents === 1 ? 'item' : 'items'}{/if}</span>
		</span>
	{:else if video}
		<video
			src={image ? video : `${video}#t=0.1`}
			poster={img?.src}
			preload={image ? 'none' : 'metadata'}
			muted
			playsinline
			draggable="false"
			aria-hidden="true"
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
	{:else}
		<span class="placeholder">
			{#if item.type === 'Text'}
				<span class="text-preview clamp">{item.content.plain || 'Text'}</span>
			{:else}
				<span class="type">{item.type === 'Attachment' ? fileExt(item) || 'File' : item.type}</span>
			{/if}
		</span>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex (The overflow region needs focus for keyboard scrolling.) -->
<div class="table-scroll" role="region" aria-label="Channel contents" tabindex="0">
	<table aria-label="Channel contents">
		<thead>
			<tr>
				<th scope="col">Thumbnail</th>
				<th scope="col">Name</th>
				<th scope="col">Description</th>
				<th scope="col">URL</th>
			</tr>
		</thead>
		<tbody>
			{#each items as item (keyOf(item))}
				{@const title = item.type === 'Channel' ? displayTitle(item) : itemTitle(item)}
				{@const description = item.description?.plain || (item.type === 'Text' ? item.content.plain : '')}
				{@const url = linkUrl(item)}
				<tr
					draggable={item.type !== 'Channel'}
					class:dragging={item.type !== 'Channel' && dnd.current?.kind === 'block' && dnd.current.blockId === item.id}
					use:blockdrag={{ item, source }}
				>
					<td class="thumbnail-cell">
						{#if item.type === 'Channel'}
							<a class="thumbnail" href="/c/{item.slug}" draggable="false" aria-label="Open {title}" onclick={() => onchannel(item)}>
								{@render thumbnail(item)}
							</a>
						{:else}
							<button class="thumbnail" type="button" draggable="false" aria-label="Open {title}" onclick={() => onopen(keyOf(item))}>
								{@render thumbnail(item)}
							</button>
						{/if}
					</td>
					<th class="name-cell" scope="row">
						{#if item.type === 'Channel'}
							<a class="name" href="/c/{item.slug}" draggable="false" onclick={() => onchannel(item)}>{title}</a>
						{:else}
							<button class="name" type="button" draggable="false" onclick={() => onopen(keyOf(item))}>{title}</button>
						{/if}
					</th>
					<td class="description-cell"><span class="description clamp">{description}</span></td>
					<td class="url-cell">
						{#if url}
							<a class="external-link" href={url} target="_blank" rel="noopener noreferrer" draggable="false" aria-label="Open {url} in a new tab">
								<span class="url-text clamp">{url}</span>
								<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M6 3.5h6.5V10M12.5 3.5l-9 9" />
								</svg>
							</a>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-scroll {
		width: 100%;
		min-width: 0;
		overflow-x: auto;
	}

	table {
		width: 100%;
		min-width: 760px;
		border-collapse: collapse;
		text-align: left;
		font-size: 12px;
	}

	th,
	td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	thead th {
		color: var(--muted);
		font-size: 11px;
		font-weight: 500;
	}

	tbody tr:hover {
		background: var(--hover);
	}

	.dragging {
		opacity: 0.45;
	}

	.thumbnail-cell {
		width: 1%;
		white-space: nowrap;
	}

	.thumbnail {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 100px;
		max-width: 400px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: var(--tile);
		color: inherit;
		vertical-align: middle;
	}

	img,
	video {
		display: block;
		width: auto;
		height: 100px;
		max-width: 400px;
		object-fit: contain;
		user-select: none;
	}

	.placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 140px;
		height: 100px;
		padding: 12px;
		color: var(--muted);
		font-size: 11px;
		white-space: normal;
	}

	.type {
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.text-preview {
		color: var(--text);
		text-align: left;
	}

	.name-cell {
		width: 22%;
		min-width: 140px;
		font-weight: 500;
	}

	.name {
		padding: 0;
		border: 0;
		background: none;
		color: var(--text);
		text-align: left;
		overflow-wrap: anywhere;
	}

	.description-cell {
		width: 38%;
		min-width: 180px;
	}

	.description {
		white-space: pre-wrap;
	}

	.clamp {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.url-cell {
		min-width: 160px;
	}

	.external-link {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}

	.external-link svg {
		flex: none;
	}

	.url-text {
		min-width: 0;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.name:hover,
	.external-link:hover {
		color: var(--text);
		text-decoration: underline;
	}

	a:focus-visible,
	button:focus-visible,
	.table-scroll:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
