import type { Connectable } from './types';

export const BLOCK_MIME = 'application/x-seeds-block';
export const FOLDER_MIME = 'application/x-seeds-folder';

/** Where a dragged block currently lives. */
export interface DragSource {
	slug: string;
	id: number | null;
}

export interface BlockDrag {
	kind: 'block';
	blockId: number;
	/** The block's connection in its source channel, used to remove it after a move. */
	connectionId: number | null;
	sourceSlug: string;
	sourceId: number | null;
	/** All selected blocks, including the anchor above, from the same source channel. */
	blocks?: { blockId: number; connectionId: number | null }[];
}

export interface FolderDrag {
	kind: 'folder';
	channelId: number;
}

class Dnd {
	/** What Seeds itself is dragging (dataTransfer contents aren't readable during dragover). */
	current = $state.raw<BlockDrag | FolderDrag | null>(null);
	/** Key of the sidebar row currently highlighted as a drop target. */
	over = $state<string | null>(null);
	/** Command can be pressed or released after the drag has started. */
	copy = $state(false);

	updateModifiers(e: { metaKey: boolean }) {
		this.copy = this.current?.kind === 'block' && e.metaKey === true;
	}

	reset() {
		this.current = null;
		this.over = null;
		this.copy = false;
	}
}

export const dnd = new Dnd();

/** A small translucent snapshot, shared by grid cards, table rows and viewer images. */
export function createBlockDragPreview(node: HTMLElement, count = 1): HTMLElement | null {
	const { width, height } = node.getBoundingClientRect();
	if (!width || !height) return null;

	const scale = Math.min(0.5, 200 / width, 140 / height);
	const preview = document.createElement('div');
	Object.assign(preview.style, {
		position: 'fixed', left: '0', top: '0',
		width: `${width * scale}px`, height: `${height * scale}px`,
		opacity: '0.5', pointerEvents: 'none', overflow: 'hidden',
		zIndex: '2147483647', borderRadius: '6px'
	});
	preview.setAttribute('aria-hidden', 'true');
	const clone = node.cloneNode(true) as HTMLElement;
	clone.removeAttribute('id');
	clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
	Object.assign(clone.style, {
		width: `${width}px`, height: `${height}px`, margin: '0',
		transform: `scale(${scale})`, transformOrigin: 'top left', opacity: '1'
	});
	if (node.tagName === 'TR') {
		// Keep the row's table formatting context when it is detached from its table.
		const table = document.createElement('table');
		table.style.width = `${width}px`;
		table.style.borderCollapse = 'collapse';
		table.style.transform = `scale(${scale})`;
		table.style.transformOrigin = 'top left';
		clone.style.transform = 'none';
		table.appendChild(clone);
		preview.appendChild(table);
	} else {
		preview.appendChild(clone);
	}
	if (count > 1) {
		const badge = document.createElement('span');
		badge.textContent = String(count);
		Object.assign(badge.style, {
			position: 'absolute', top: '6px', right: '6px',
			minWidth: '22px', height: '22px', padding: '0 6px',
			display: 'grid', placeItems: 'center', boxSizing: 'border-box',
			borderRadius: '11px', background: '#333', color: '#fff',
			font: '600 12px/1 system-ui, sans-serif',
			boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)'
		});
		preview.appendChild(badge);
	}
	return preview;
}

/** Selection entries must carry their connections in `source`, not connections from another channel. */
export function blockDragFor(item: Connectable, source: DragSource, selected?: Connectable[]): BlockDrag | null {
	if (item.type === 'Channel') return null;
	const payload: BlockDrag = {
		kind: 'block',
		blockId: item.id,
		connectionId: item.connection?.id ?? null,
		sourceSlug: source.slug,
		sourceId: source.id
	};
	if (selected?.some((block) => block.type !== 'Channel' && block.id === item.id)) {
		const blocks = new Map<number, { blockId: number; connectionId: number | null }>();
		for (const block of selected) {
			if (block.type === 'Channel' || blocks.has(block.id)) continue;
			blocks.set(block.id, {
				blockId: block.id,
				connectionId: block.id === item.id ? payload.connectionId : block.connection?.id ?? null
			});
		}
		if (blocks.size > 1) payload.blocks = [...blocks.values()];
	}
	return payload;
}

export function isBlockDragging(id: number): boolean {
	const current = dnd.current;
	return current?.kind === 'block' && (current.blocks
		? current.blocks.some((block) => block.blockId === id)
		: current.blockId === id);
}

export function startBlockDrag(e: DragEvent, item: Connectable, source: DragSource, selected?: Connectable[]) {
	const payload = blockDragFor(item, source, selected);
	if (!payload || !e.dataTransfer) return;
	e.dataTransfer.clearData();
	e.dataTransfer.effectAllowed = 'copyMove';
	e.dataTransfer.setData(BLOCK_MIME, JSON.stringify(payload));
	dnd.current = payload;
	dnd.updateModifiers(e);
	if (typeof HTMLElement !== 'undefined' && e.currentTarget instanceof HTMLElement) {
		const preview = createBlockDragPreview(e.currentTarget, payload.blocks?.length ?? 1);
		if (preview) {
			document.body.appendChild(preview);
			e.dataTransfer.setDragImage(preview, 12, 12);
			// Native consumers must keep the snapshot rendered through dragstart.
			setTimeout(() => preview.remove(), 0);
		}
	}
}

export function startFolderDrag(e: DragEvent, channelId: number) {
	if (!e.dataTransfer) return;
	e.dataTransfer.clearData();
	const payload: FolderDrag = { kind: 'folder', channelId };
	e.dataTransfer.effectAllowed = 'move';
	e.dataTransfer.setData(FOLDER_MIME, JSON.stringify(payload));
	dnd.current = payload;
	dnd.copy = false;
}

export function readBlockDrag(dt: DataTransfer): BlockDrag | null {
	try {
		const parsed = JSON.parse(dt.getData(BLOCK_MIME));
		const validId = (id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
		const validConnection = (id: unknown) => id === null || validId(id);
		if (parsed?.kind !== 'block' || !validId(parsed.blockId) || !validConnection(parsed.connectionId)
			|| typeof parsed.sourceSlug !== 'string' || !parsed.sourceSlug
			|| !validConnection(parsed.sourceId)) return null;
		if (parsed.blocks !== undefined) {
			if (!Array.isArray(parsed.blocks) || !parsed.blocks.length) return null;
			const blocks: NonNullable<BlockDrag['blocks']> = [];
			for (const block of parsed.blocks) {
				if (!block || !validId(block.blockId) || !validConnection(block.connectionId)) return null;
				const duplicate = blocks.find((entry) => entry.blockId === block.blockId);
				if (duplicate && duplicate.connectionId !== block.connectionId) return null;
				if (!duplicate) blocks.push({ blockId: block.blockId, connectionId: block.connectionId });
			}
			if (!blocks.some((block) => block.blockId === parsed.blockId && block.connectionId === parsed.connectionId)) return null;
			parsed.blocks = blocks;
		}
		return parsed;
	} catch {
		return null;
	}
}

/**
 * What is being dragged: one of Seeds' own blocks/folders, or something from outside
 * (files, images, text, links). Only reads `types`, which is available during dragover.
 */
export function dragKind(e: DragEvent): 'block' | 'folder' | 'external' | null {
	const types = Array.from(e.dataTransfer?.types ?? []);
	if (types.includes(BLOCK_MIME)) return 'block';
	if (types.includes(FOLDER_MIME)) return 'folder';
	const external = ['Files', 'text/uri-list', 'text/html', 'text/plain'];
	return types.some((t) => external.includes(t)) ? 'external' : null;
}
