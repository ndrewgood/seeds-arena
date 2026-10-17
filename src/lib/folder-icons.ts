// Only URLs go into the catalog; SVGs are separate local assets fetched as they are displayed.
// This includes every regular and solid icon in the installed Iconoir package.
const assets = import.meta.glob<string>('/node_modules/iconoir/icons/**/*.svg', {
	query: '?url&no-inline', import: 'default', eager: true
});

export const DEFAULT_FOLDER_ICON = 'regular/folder';

export const iconoirIcons = Object.entries(assets).flatMap(([path, url]) => {
	const match = path.match(/\/icons\/(regular|solid)\/([^/]+)\.svg$/);
	if (!match) return [];
	const style = match[1] as 'regular' | 'solid';
	return [{ value: `${style}/${match[2]}`, label: match[2].replaceAll('-', ' '), style, url }];
}).sort((a, b) => a.label.localeCompare(b.label) || a.style.localeCompare(b.style));

const byName = new Map(iconoirIcons.map((icon) => [icon.value, icon]));

export function folderIconUrl(name = DEFAULT_FOLDER_ICON): string {
	return (byName.get(name) ?? byName.get(DEFAULT_FOLDER_ICON))?.url ?? '';
}

export type FolderIcon = { kind: 'icon'; library: 'iconoir'; value: string };

const MARKER = /^\[seeds-folder-icon\]: (.+)$/gm;

// Existing Lucide selections keep the closest Iconoir equivalent without rewriting descriptions.
const legacyNames: Record<string, string> = {
	folder: 'folder', archive: 'archive', book: 'open-book', bookmark: 'bookmark',
	briefcase: 'suitcase', camera: 'camera', code: 'code', coffee: 'coffee-cup',
	compass: 'compass', document: 'page', film: 'cinema-old', flag: 'white-flag',
	flower: 'flower', globe: 'globe', heart: 'heart', home: 'home', image: 'media-image',
	layers: 'multiple-pages', leaf: 'leaf', lightbulb: 'light-bulb', map: 'map',
	music: 'music-note', palette: 'palette', pencil: 'edit-pencil', rocket: 'rocket',
	search: 'search', shapes: 'hexagon', sparkles: 'sparks', star: 'star',
	sun: 'sun-light', tag: 'label', target: 'archery', trophy: 'trophy',
	users: 'group', video: 'media-video', zap: 'flash'
};

export function validFolderIcon(value: unknown): value is FolderIcon {
	if (!value || typeof value !== 'object') return false;
	const icon = value as { kind?: unknown; library?: unknown; value?: unknown };
	return icon.kind === 'icon' && icon.library === 'iconoir' &&
		typeof icon.value === 'string' && byName.has(icon.value);
}

/** A Markdown reference definition keeps the metadata out of the rendered description. */
export function readFolderIcon(description: string | null | undefined): FolderIcon | null {
	for (const match of (description ?? '').matchAll(MARKER)) {
		try {
			const icon = JSON.parse(match[1]);
			if (validFolderIcon(icon)) return icon;
			if (icon?.kind === 'icon' && icon.library === undefined &&
				typeof icon.value === 'string' && Object.hasOwn(legacyNames, icon.value)) {
				const value = `regular/${legacyNames[icon.value]}`;
				if (byName.has(value)) return { kind: 'icon', library: 'iconoir', value };
			}
		} catch {
			// Malformed metadata and removed emoji selections use the default folder icon.
		}
	}
	return null;
}

export function writeFolderIcon(description: string, icon: FolderIcon | null): string {
	// Remove only our metadata and its separator, leaving user Markdown (including whitespace) intact.
	const text = description.replace(/(?:\r?\n\r?\n|\r?\n|^)\[seeds-folder-icon\]: [^\r\n]*(?=\r?$)/gm, '');
	return icon ? `${text}${text ? '\n\n' : ''}[seeds-folder-icon]: ${JSON.stringify(icon)}` : text;
}
