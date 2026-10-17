import { buildFolders, descendantsOf, folderTitle } from './seeds';
import type { Channel } from './types';

export function planFolderRename(
	channelId: number,
	rawName: string,
	channels: Channel[]
): { channel: Channel; title: string }[] {
	const { all } = buildFolders(channels);
	const folder = all.find((node) => node.channel.id === channelId);
	if (!folder) throw new Error(`Folder with channel ID ${channelId} not found.`);

	const name = rawName.replace(/\s+/g, ' ').trim();
	if (!name) throw new Error('Folder name cannot be blank.');
	if (name.includes('>')) throw new Error('Folder name cannot contain ">".');
	if (name === folder.name) return [];

	const segments = [...folder.segments.slice(0, -1), name];
	const moving = [folder, ...descendantsOf(folder, all)];
	const movingIds = new Set(moving.map((node) => node.channel.id));
	const outsideTitles = new Set(
		all
			.filter((node) => !movingIds.has(node.channel.id))
			.map((node) => folderTitle(node.segments).toLowerCase())
	);
	const plan = moving.map((node) => ({
		channel: node.channel,
		title: folderTitle([...segments, ...node.segments.slice(folder.segments.length)])
	}));

	for (const { title } of plan) {
		if (outsideTitles.has(title.toLowerCase())) {
			throw new Error(`A folder already exists at "${title}".`);
		}
	}

	return plan;
}
