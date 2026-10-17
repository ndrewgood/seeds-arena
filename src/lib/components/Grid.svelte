<script lang="ts">
	import { keyOf } from '$lib/feed.svelte';
	import { justify } from '$lib/layout';
	import { itemRatio } from '$lib/media';
	import type { DragSource } from '$lib/dnd.svelte';
	import type { Channel, Connectable } from '$lib/types';
	import Tile from './Tile.svelte';

	const GAP = 8;

	let {
		items,
		rowHeight,
		source,
		onopen,
		onchannel
	}: {
		items: Connectable[];
		rowHeight: number;
		/** The channel these items are shown in; blocks dragged out of the grid are moved away from it. */
		source: DragSource;
		onopen: (key: string) => void;
		onchannel: (channel: Channel) => void;
	} = $props();

	let width = $state(0);

	// Absolutely positioned cells keyed by item, so resizing/zooming never remounts tiles.
	const layout = $derived.by(() => {
		const rows = justify(items.map(itemRatio), width, rowHeight, GAP);
		const boxes: { x: number; y: number; w: number; h: number }[] = new Array(items.length);
		let y = 0;
		for (const row of rows) {
			let x = 0;
			for (const p of row.items) {
				boxes[p.index] = { x, y, w: p.width, h: p.height };
				x += p.width + GAP;
			}
			y += row.height + GAP;
		}
		return { boxes, height: Math.max(0, y - GAP) };
	});
</script>

<div class="grid" bind:clientWidth={width} style:height="{layout.height}px">
	{#each items as item, i (keyOf(item))}
		{@const box = layout.boxes[i]}
		{#if box}
			<div
				class="cell"
				style:width="{box.w}px"
				style:height="{box.h}px"
				style:transform="translate({box.x}px, {box.y}px)"
			>
				<Tile
					{item}
					{source}
					width={box.w}
					onopen={() => (item.type === 'Channel' ? onchannel(item) : onopen(keyOf(item)))}
				/>
			</div>
		{/if}
	{/each}
</div>

<style>
	.grid {
		position: relative;
		width: 100%;
	}

	.cell {
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
