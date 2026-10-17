import type { Channel } from './types';

/*
 * Seeds' "file system" is just Are.na channels with a naming convention:
 *
 *   Inbox   title "📨 Inbox"                  description "Inbox - Seeds for Are.na"
 *   Folder  title "🌱 Parent > Child"          description "Child folder - Seeds for Are.na"
 *
 * Nesting a folder only rewrites its title (and its descendants' titles).
 */

export const INBOX_TITLE = '📨 Inbox';
export const INBOX_DESCRIPTION = 'Inbox - Seeds for Are.na';
export const FOLDER_EMOJI = '🌱';
export const PATH_SEPARATOR = ' > ';

/** Visibility for channels Seeds creates. Private so an unsorted Inbox is never published by accident. */
export const DEFAULT_VISIBILITY = 'private' as const;

export function folderDescription(name: string) {
	return `${name} folder - Seeds for Are.na`;
}

/** Makes a user-typed folder name safe to embed in a path-style title. */
export function sanitizeFolderName(raw: string) {
	return raw.replaceAll('>', '').replace(/\s+/g, ' ').trim();
}

export function folderTitle(segments: string[]) {
	return `${FOLDER_EMOJI} ${segments.join(PATH_SEPARATOR)}`;
}

/** "🌱 A > B" -> ["A", "B"]; null if the title isn't a Seeds folder. */
export function parseFolderTitle(title: string): string[] | null {
	const t = title.trim();
	if (!t.startsWith(FOLDER_EMOJI)) return null;
	const segments = t
		.slice(FOLDER_EMOJI.length)
		.split('>')
		.map((s) => s.trim())
		.filter(Boolean);
	return segments.length ? segments : null;
}

export function isInbox(channel: Channel) {
	return channel.title.trim() === INBOX_TITLE;
}

export function isFolder(channel: Channel) {
	return parseFolderTitle(channel.title) !== null;
}

/** What the UI should call a channel (folders show only their own name). */
export function displayTitle(channel: Channel) {
	if (isInbox(channel)) return 'Inbox';
	const segments = parseFolderTitle(channel.title);
	return segments ? segments[segments.length - 1] : channel.title;
}

export interface FolderNode {
	channel: Channel;
	/** Full path, e.g. ["Design", "Type"]. */
	segments: string[];
	/** Path as a string key, e.g. "Design > Type". */
	key: string;
	/** Folder's own name. */
	name: string;
	/** Shown in the sidebar; the full path for orphans whose parent folder is missing. */
	label: string;
	children: FolderNode[];
}

const byName = (a: FolderNode, b: FolderNode) =>
	a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

/** Builds the folder tree (and a flat list) from every channel in the account. */
export function buildFolders(channels: Channel[]): { roots: FolderNode[]; all: FolderNode[] } {
	const all: FolderNode[] = [];
	for (const channel of channels) {
		const segments = parseFolderTitle(channel.title);
		if (!segments) continue;
		all.push({
			channel,
			segments,
			key: segments.join(PATH_SEPARATOR),
			name: segments[segments.length - 1],
			label: segments[segments.length - 1],
			children: []
		});
	}

	const byKey = new Map<string, FolderNode>();
	for (const node of all) if (!byKey.has(node.key)) byKey.set(node.key, node);

	const roots: FolderNode[] = [];
	for (const node of all) {
		if (node.segments.length === 1) {
			roots.push(node);
			continue;
		}
		const parent = byKey.get(node.segments.slice(0, -1).join(PATH_SEPARATOR));
		if (parent) {
			parent.children.push(node);
		} else {
			// Parent folder was deleted/renamed outside Seeds: keep the folder reachable at the top level.
			node.label = node.key;
			roots.push(node);
		}
	}

	const sortTree = (nodes: FolderNode[]) => {
		nodes.sort(byName);
		for (const n of nodes) sortTree(n.children);
	};
	sortTree(roots);

	return { roots, all };
}

/** All folders nested anywhere beneath `node`. */
export function descendantsOf(node: FolderNode, all: FolderNode[]): FolderNode[] {
	const prefix = node.key + PATH_SEPARATOR;
	return all.filter((n) => n.key.startsWith(prefix));
}

/** The folder itself followed by every descendant, including paths with a missing intermediate folder. */
export function folderMembers(channel: Channel, all: FolderNode[]): Channel[] {
	const segments = parseFolderTitle(channel.title);
	if (!segments) return [channel];
	const prefix = segments.join(PATH_SEPARATOR) + PATH_SEPARATOR;
	return [channel, ...all.filter((node) => node.channel.id !== channel.id && node.key.startsWith(prefix))
		.map((node) => node.channel)];
}

export function folderSummary(channel: Channel, all: FolderNode[]): string {
	const members = folderMembers(channel, all);
	const blocks = members.reduce((total, member) => total + member.counts.blocks, 0);
	const folders = members.length - 1;
	return `${blocks.toLocaleString()} ${blocks === 1 ? 'block' : 'blocks'}, ${folders.toLocaleString()} ${folders === 1 ? 'folder' : 'folders'}`;
}

/** Can `node` be nested inside `target` (null = top level)? */
export function canNest(node: FolderNode, target: FolderNode | null): boolean {
	if (!target) return node.segments.length > 1;
	if (target.channel.id === node.channel.id) return false;
	// Not into its own subtree, and not into the folder it already lives in.
	if (target.key.startsWith(node.key + PATH_SEPARATOR) || target.key === node.key) return false;
	return target.key !== node.segments.slice(0, -1).join(PATH_SEPARATOR);
}

/** Folders that must be expanded to reveal `node`, including the node itself. */
export function pathIds(node: FolderNode, all: FolderNode[]): number[] {
	const ids = [node.channel.id];
	for (let i = 1; i < node.segments.length; i++) {
		const key = node.segments.slice(0, i).join(PATH_SEPARATOR);
		const ancestor = all.find((n) => n.key === key);
		if (ancestor) ids.push(ancestor.channel.id);
	}
	return ids;
}
