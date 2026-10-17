import { ArenaError, connect, createBlock, createChannel, deleteChannel, disconnect, getChannel, updateChannel, uploadFile } from './arena';
import { channels } from './channels.svelte';
import { readBlockDrag, type BlockDrag, type DragSource } from './dnd.svelte';
import { readDrop, type Dropped } from './dropped';
import { adjustChannelFeedCounts, refreshChannelFeeds, removeBlockFromFeeds, removeChannelFromFeeds, updateChannelFeeds } from './feed.svelte';
import { planFolderRename } from './folder-rename';
import { nav } from './nav.svelte';
import { previews } from './previews.svelte';
import { validFolderIcon, writeFolderIcon, type FolderIcon } from './folder-icons';
import {
	DEFAULT_VISIBILITY,
	INBOX_DESCRIPTION,
	INBOX_TITLE,
	PATH_SEPARATOR,
	canNest,
	descendantsOf,
	displayTitle,
	folderDescription,
	folderTitle,
	isFolder,
	isInbox,
	pathIds,
	sanitizeFolderName,
	type FolderNode
} from './seeds';
import { toast } from './toast.svelte';
import type { Block, Channel } from './types';
import { ui } from './ui.svelte';

function messageOf(e: unknown) {
	return e instanceof Error ? e.message : 'Something went wrong.';
}

/* ------------------------------- setup ------------------------------- */

/** Creates the "📨 Inbox" channel. Resolves to the channel, or null if it failed. */
export async function initializeInbox(): Promise<Channel | null> {
	if (channels.inbox) return channels.inbox;
	if (ui.initializing) return null;

	ui.initializing = true;
	try {
		const inbox = await createChannel({
			title: INBOX_TITLE,
			description: INBOX_DESCRIPTION,
			visibility: DEFAULT_VISIBILITY
		});
		channels.add(inbox);
		ui.initPrompt = false;
		toast.success('Inbox created');
		return inbox;
	} catch (e) {
		toast.error(`Couldn't create the Inbox. ${messageOf(e)}`);
		return null;
	} finally {
		ui.initializing = false;
	}
}

/* ------------------------------ folders ------------------------------ */

/** Deletes one folder's Are.na channel; descendants and blocks in other channels are untouched. */
export async function deleteFolder(channel: Channel): Promise<boolean> {
	if (!isFolder(channel)) return false;
	if (channel.can?.destroy === false) {
		toast.error('You do not have permission to delete this folder.');
		return false;
	}
	if (ui.folderRenaming) {
		toast.error('Another folder change is still saving. Try again in a moment.');
		return false;
	}

	// Share the folder-write lock so a rename/move cannot race this deletion.
	ui.folderRenaming = true;
	try {
		await deleteChannel(channel.id);
		const parents = removeChannelFromFeeds(channel);
		channels.remove(channel.id);
		for (const id of parents) {
			channels.adjustChannelCount(id, -1);
			previews.invalidate(id);
		}
		previews.invalidate(channel.id);
		nav.trail = nav.trail.filter((crumb) => crumb.slug !== channel.slug);
		toast.success('Folder deleted');
		return true;
	} catch (e) {
		toast.error(`Couldn't delete the folder. ${messageOf(e)}`);
		return false;
	} finally {
		ui.folderRenaming = false;
	}
}

/** Renames the folder and its descendant paths; never reconnects blocks or overwrites descriptions. */
export async function renameFolder(channel: Channel, name: string): Promise<boolean> {
	if (ui.folderRenaming) {
		toast.error('Another folder rename is still saving. Try again in a moment.');
		return false;
	}
	if (!channels.loaded) {
		toast.error('Wait for folders to finish loading before renaming.');
		return false;
	}

	let plan: ReturnType<typeof planFolderRename>;
	try {
		plan = planFolderRename(channel.id, name, channels.items);
	} catch (e) {
		toast.error(messageOf(e));
		return false;
	}
	if (!plan.length) return true;
	if (plan.some(({ channel }) => channel.can?.update === false)) {
		toast.error('You do not have permission to rename this folder or one of its subfolders.');
		return false;
	}

	ui.folderRenaming = true;
	const changes: { before: Channel; after: Channel }[] = [];
	const progress = toast.show('Renaming folder…', 'info', 0);
	let success = false;
	let rollbackFailed = false;
	try {
		for (const [index, move] of plan.entries()) {
			if (index) await new Promise((resolve) => setTimeout(resolve, 250));
			const updated = await updateChannel(move.channel.id, { title: move.title });
			changes.push({ before: move.channel, after: updated });
		}
		success = true;
	} catch (e) {
		// Are.na has no atomic subtree rename. Restore completed writes when a later one fails.
		for (const change of [...changes].reverse()) {
			try {
				await new Promise((resolve) => setTimeout(resolve, 250));
				change.after = await updateChannel(change.before.id, { title: change.before.title });
			} catch {
				rollbackFailed = true;
			}
		}
		toast.error(`Couldn't rename the folder. ${messageOf(e)}${rollbackFailed ? ' Some folder paths could not be restored; refresh to check their current state.' : ''}`);
	} finally {
		for (const { after } of changes) channels.add(after);
		updateChannelFeeds(changes);
		nav.trail = nav.trail.map((crumb) => {
			const change = changes.find(({ before }) => before.slug === crumb.slug);
			return change ? { slug: change.after.slug, title: displayTitle(change.after) } : crumb;
		});
		toast.dismiss(progress);
		ui.folderRenaming = false;
	}
	if (success) toast.success('Folder renamed');
	return success;
}

/** Re-read the description before editing so cached sidebar data doesn't overwrite user text. */
export async function setFolderIcon(channel: Channel, icon: FolderIcon | null): Promise<boolean> {
	if (icon !== null && !validFolderIcon(icon)) return false;
	try {
		const fresh = await getChannel(channel.id);
		if (!isFolder(fresh)) throw new Error('This channel is no longer a Seeds folder.');
		if (fresh.can?.update === false) throw new Error('You do not have permission to edit this folder.');
		const description = writeFolderIcon(fresh.description?.markdown ?? '', icon);
		const updated = await updateChannel(channel.id, { description });
		channels.add(updated);
		toast.success(icon ? 'Folder icon updated' : 'Folder icon reset');
		return true;
	} catch (e) {
		toast.error(`Couldn't update the folder icon. ${messageOf(e)}`);
		return false;
	}
}

/** Converts the existing channel in place, preserving its contents, description and visibility. */
export async function convertToFolder(channel: Channel): Promise<Channel | null> {
	if (isFolder(channel) || isInbox(channel) || channel.can?.update === false) return null;

	const title = folderTitle([channel.title]);
	if (channels.items.some((c) => c.id !== channel.id && c.title.trim().toLowerCase() === title.trim().toLowerCase())) {
		toast.error(`A folder named “${channel.title}” already exists.`);
		return null;
	}

	try {
		const folder = await updateChannel(channel.id, { title });
		channels.add(folder);
		const node = channels.folders.all.find((n) => n.channel.id === folder.id);
		if (node) ui.expand(pathIds(node, channels.folders.all));
		toast.success(`Converted “${channel.title}” to a folder`);
		return folder;
	} catch (e) {
		toast.error(`Couldn't convert the channel. ${messageOf(e)}`);
		return null;
	}
}

/** Creates a top-level folder. Resolves to the channel, or null if it failed. */
export async function createFolder(rawName: string): Promise<Channel | null> {
	const name = sanitizeFolderName(rawName);
	if (!name) return null;

	const key = name.toLowerCase();
	if (channels.folders.roots.some((n) => n.key.toLowerCase() === key)) {
		toast.error(`A folder named “${name}” already exists.`);
		return null;
	}

	try {
		const channel = await createChannel({
			title: folderTitle([name]),
			description: folderDescription(name),
			visibility: DEFAULT_VISIBILITY
		});
		channels.add(channel);
		return channel;
	} catch (e) {
		toast.error(`Couldn't create the folder. ${messageOf(e)}`);
		return null;
	}
}

/**
 * Nests `node` (and everything beneath it) inside `target`, or moves it to the top level when
 * `target` is null. In Are.na this is just a title rewrite: "🌱 A > B" -> "🌱 T > A > B".
 */
export async function nestFolder(node: FolderNode, target: FolderNode | null): Promise<boolean> {
	if (ui.folderRenaming || !canNest(node, target)) return false;

	const { all } = channels.folders;
	const base = target ? target.segments : [];
	const nextSegments = [...base, node.name];
	const nextKey = nextSegments.join(PATH_SEPARATOR);

	if (all.some((n) => n.channel.id !== node.channel.id && n.key.toLowerCase() === nextKey.toLowerCase())) {
		toast.error(
			target
				? `“${target.name}” already contains a folder named “${node.name}”.`
				: `A top-level folder named “${node.name}” already exists.`
		);
		return false;
	}

	// The folder itself first, then its descendants, so a partial failure leaves orphans
	// (still reachable) rather than children pointing at a parent that no longer exists.
	const moves = [node, ...descendantsOf(node, all)].map((n) => ({
		node: n,
		title: folderTitle([...nextSegments, ...n.segments.slice(node.segments.length)])
	}));

	const progress = moves.length > 1 ? toast.show(`Moving ${moves.length} folders…`, 'info', 0) : null;
	const done = new Map<number, string>();
	try {
		for (const move of moves) {
			await updateChannel(move.node.channel.id, { title: move.title });
			done.set(move.node.channel.id, move.title);
		}
	} catch (e) {
		channels.retitle(done);
		channels.reload();
		if (progress !== null) toast.dismiss(progress);
		toast.error(`Couldn't move “${node.name}”. ${messageOf(e)}`);
		return false;
	}

	channels.retitle(done);
	if (progress !== null) toast.dismiss(progress);

	// Make sure the moved folder is visible where it landed.
	const moved = channels.folders.all.find((n) => n.channel.id === node.channel.id);
	if (moved) ui.expand(pathIds(moved, channels.folders.all));
	toast.success(target ? `Moved “${node.name}” into “${target.name}”` : `Moved “${node.name}” to the top level`);
	return true;
}

/* ------------------------------- blocks ------------------------------ */

/** Disconnects only the current folder connection, committing local changes after API success. */
export async function removeBlockFromFolder(item: Block, source: DragSource): Promise<boolean> {
	const connectionId = item.connection?.id;
	if (connectionId == null) {
		toast.error("Couldn't remove the block: its folder connection is missing. Refresh and try again.");
		return false;
	}
	try {
		await disconnect(connectionId);
		removeBlockFromFeeds(source.slug, item.id);
		const sourceId = source.id ?? channels.bySlug(source.slug)?.id;
		channels.adjustCount(sourceId, -1);
		if (sourceId != null) {
			adjustChannelFeedCounts(sourceId, 'blocks', -1);
			previews.invalidate(sourceId);
		}
		toast.success('Block removed from folder');
		return true;
	} catch (e) {
		toast.error(`Couldn't remove the block from this folder. ${messageOf(e)}`);
		return false;
	}
}

/** Connects a block to the target, keeping its source connection only when copying. */
export async function moveBlock(drag: BlockDrag, target: Channel, copy: boolean = false): Promise<boolean> {
	if (target.slug === drag.sourceSlug || target.id === drag.sourceId) return false;

	// Only moves optimistically remove the block from its source.
	const restore = copy ? null : removeBlockFromFeeds(drag.sourceSlug, drag.blockId);
	if (!copy) channels.adjustCount(drag.sourceId, -1);
	channels.adjustCount(target.id, 1);

	try {
		await connect(drag.blockId, 'Block', target.id);
	} catch (e) {
		restore?.();
		if (!copy) channels.adjustCount(drag.sourceId, 1);
		channels.adjustCount(target.id, -1);
		toast.error(`Couldn't ${copy ? 'connect' : 'move'} the block. ${messageOf(e)}`);
		return false;
	}

	if (!copy && drag.connectionId !== null) {
		try {
			await disconnect(drag.connectionId);
		} catch (e) {
			// It's in both places now; put the block back in the source grid so the UI matches.
			restore?.();
			channels.adjustCount(drag.sourceId, 1);
			toast.error(`Added to “${displayTitle(target)}” but couldn't remove it from the original. ${messageOf(e)}`);
		}
	}

	refreshChannelFeeds(target.slug);
	previews.invalidate(target.id);
	if (!copy && drag.sourceId !== null) previews.invalidate(drag.sourceId);
	if (copy) toast.success(`Connected to “${displayTitle(target)}”`);
	return true;
}

function extensionFor(mime: string) {
	const sub = mime.split('/')[1]?.split('+')[0] ?? 'png';
	return sub === 'jpeg' ? 'jpg' : sub;
}

async function fileFromDataUrl(url: string): Promise<File> {
	const blob = await (await fetch(url)).blob();
	return new File([blob], `image.${extensionFor(blob.type)}`, { type: blob.type });
}

async function blockValueFor(drop: Dropped): Promise<string> {
	switch (drop.kind) {
		case 'text':
			return drop.text;
		case 'file':
			return uploadFile(drop.file);
		case 'url':
			if (drop.url.startsWith('data:')) return uploadFile(await fileFromDataUrl(drop.url));
			return drop.url;
	}
}

/** Creates a block from a single drop, retrying with the dropped bytes if Are.na can't fetch the URL. */
async function addOne(drop: Dropped, channel: Channel) {
	const value = await blockValueFor(drop);
	try {
		await createBlock({ value, channel_ids: [channel.id] });
	} catch (e) {
		// Some sites block hotlinking; if the browser gave us the file too, upload that instead.
		// Auth and rate-limit failures would just fail again, so don't retry those.
		const retryable = !(e instanceof ArenaError && [401, 403, 429].includes(e.status));
		if (drop.kind === 'url' && drop.file && retryable) {
			const uploaded = await uploadFile(drop.file);
			await createBlock({ value: uploaded, channel_ids: [channel.id] });
			return;
		}
		throw e;
	}
}

/** Creates blocks in `channel` from things dragged in from outside Seeds. */
export async function addDropped(drops: Dropped[], channel: Channel): Promise<number> {
	if (!drops.length) {
		toast.error('Nothing droppable found. Try an image, file, link or text.');
		return 0;
	}

	const name = displayTitle(channel);
	const progress = toast.show(
		drops.length === 1 ? `Adding to ${name}…` : `Adding 1 of ${drops.length} to ${name}…`,
		'info',
		0
	);

	let added = 0;
	let failure: string | null = null;
	for (const [i, drop] of drops.entries()) {
		if (drops.length > 1) toast.update(progress, `Adding ${i + 1} of ${drops.length} to ${name}…`, 'info', 0);
		try {
			await addOne(drop, channel);
			added++;
		} catch (e) {
			failure = messageOf(e);
			// A rate limit or auth problem won't get better on the next item.
			if (e instanceof ArenaError && (e.status === 429 || e.status === 403 || e.status === 401)) break;
		}
	}

	if (added) {
		channels.adjustCount(channel.id, added);
		refreshChannelFeeds(channel.slug);
		previews.invalidate(channel.id);
	}

	if (failure && added) {
		toast.update(progress, `Added ${added} of ${drops.length} to ${name}. ${failure}`, 'error', 7000);
	} else if (failure) {
		toast.update(progress, `Couldn't add to ${name}. ${failure}`, 'error', 7000);
	} else {
		toast.update(progress, added === 1 ? `Added to ${name}` : `Added ${added} items to ${name}`, 'success');
	}
	return added;
}

/**
 * Handles a drop onto a channel/folder/Inbox: either one of Seeds' own blocks (move, or connect with Command) or
 * something from outside (a new block). Call synchronously from the `drop` event.
 */
export function handleChannelDrop(e: DragEvent, kind: 'block' | 'folder' | 'external', channel: Channel) {
	const dt = e.dataTransfer;
	if (!dt || kind === 'folder') return;

	if (kind === 'block') {
		const drag = readBlockDrag(dt);
		if (drag) void moveBlock(drag, channel, e.metaKey);
		return;
	}

	void addDropped(readDrop(dt), channel);
}
