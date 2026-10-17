/** Something dragged in from outside Seeds, normalised into what we can turn into a block. */
export type Dropped =
	| { kind: 'url'; url: string; /** Bytes to upload if Are.na can't fetch the URL itself. */ file?: File }
	| { kind: 'file'; file: File }
	| { kind: 'text'; text: string };

function httpUrl(value: string): string | null {
	try {
		const url = new URL(value.trim());
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

/**
 * Reads a drop. Must be called synchronously inside the `drop` handler: the browser clears the
 * DataTransfer as soon as the handler returns.
 *
 * Priority: an image on a web page (keeps its source URL) > links > local files > plain text.
 */
export function readDrop(dt: DataTransfer): Dropped[] {
	const files = Array.from(dt.files);
	const html = dt.getData('text/html');
	const uriList = dt.getData('text/uri-list');
	const plain = dt.getData('text/plain');

	if (html) {
		const src = new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src');
		if (src) {
			const url = src.startsWith('data:image/') ? src : httpUrl(src);
			if (url) return [{ kind: 'url', url, file: files[0] }];
		}
	}

	const urls = uriList
		.split(/\r?\n/)
		.filter((line) => line && !line.startsWith('#'))
		.map(httpUrl)
		.filter((u): u is string => u !== null);
	if (urls.length) {
		return urls.map((url) => ({ kind: 'url', url, file: urls.length === 1 ? files[0] : undefined }));
	}

	if (files.length) return files.map((file) => ({ kind: 'file', file }));

	const text = plain.trim();
	if (!text) return [];
	const url = /^https?:\/\/\S+$/.test(text) ? httpUrl(text) : null;
	return [url ? { kind: 'url', url } : { kind: 'text', text }];
}
