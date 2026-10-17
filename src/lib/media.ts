import type { AttachmentBlock, BlockImage, Connectable } from './types';

const MIN_RATIO = 0.45;
const MAX_RATIO = 3.2;

/** The preview image attached to a block, if any. */
export function imageFor(item: Connectable): BlockImage | null {
	switch (item.type) {
		case 'Image':
			return item.image;
		case 'Link':
		case 'Attachment':
		case 'Embed':
			return item.image ?? null;
		default:
			return null;
	}
}

export function isGif(image: BlockImage) {
	return image.content_type === 'image/gif';
}

/** URL of a playable video file (uploaded video attachments). */
export function videoSrc(item: Connectable): string | null {
	if (item.type !== 'Attachment') return null;
	return item.attachment.content_type?.startsWith('video/') ? item.attachment.url : null;
}

export function fileExt(item: AttachmentBlock): string {
	const ext = item.attachment.file_extension ?? item.attachment.filename?.split('.').pop() ?? '';
	return ext.toLowerCase();
}

function safeHttp(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
	} catch {
		return null;
	}
}

/** The external URL a block points at (its source, an embed's page, or a text block that is just a URL). */
export function linkUrl(item: Connectable): string | null {
	switch (item.type) {
		case 'Channel':
			return null;
		case 'Embed':
			return safeHttp(item.embed.source_url) ?? safeHttp(item.source?.url);
		case 'Text': {
			const text = item.content.plain.trim();
			return /^https?:\/\/\S+$/.test(text) ? safeHttp(text) : safeHttp(item.source?.url);
		}
		default:
			return safeHttp(item.source?.url);
	}
}

/**
 * Downloads a file. Cross-origin `download` attributes are ignored by browsers, so we
 * fetch the bytes and save a blob; if the host blocks that (CORS) we open the file instead.
 */
export async function downloadFile(url: string, filename: string) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(String(res.status));
		const objectUrl = URL.createObjectURL(await res.blob());
		const a = document.createElement('a');
		a.href = objectUrl;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
	} catch {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}

export function hostOf(url: string | null | undefined): string {
	if (!url) return '';
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

/** Picks a resolution appropriate for the rendered width. GIFs always use the original so they animate. */
export function pickImage(image: BlockImage, renderedWidth: number): { src: string; srcset?: string } {
	if (isGif(image)) return { src: image.src };
	const version = renderedWidth > 480 ? image.large : image.medium;
	return { src: version.src, srcset: `${version.src} 1x, ${version.src_2x} 2x` };
}

function rawRatio(item: Connectable): number {
	if (item.type === 'Channel') return 1.4;

	const image = imageFor(item);
	if (image) {
		if (image.aspect_ratio) return image.aspect_ratio;
		if (image.width && image.height) return image.width / image.height;
	}

	if (item.type === 'Embed') {
		const { width, height } = item.embed;
		return width && height ? width / height : 16 / 9;
	}
	if (videoSrc(item)) return 16 / 9;
	if (item.type === 'Link') return 1.4;
	return 1;
}

/** Aspect ratio used for layout, clamped so extreme panoramas/strips don't wreck row heights. */
export function itemRatio(item: Connectable): number {
	return Math.min(MAX_RATIO, Math.max(MIN_RATIO, rawRatio(item)));
}

/**
 * Extracts the iframe URL from provider-supplied embed HTML. We render our own
 * sandboxed iframe rather than injecting third-party markup.
 */
export function embedIframeSrc(html: string | null): string | null {
	if (!html) return null;
	const src = new DOMParser().parseFromString(html, 'text/html').querySelector('iframe')?.getAttribute('src');
	if (!src) return null;
	try {
		const url = new URL(src, 'https://www.are.na');
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export function itemTitle(item: Connectable): string {
	if (item.title) return item.title;
	switch (item.type) {
		case 'Attachment':
			return item.attachment.filename ?? 'Untitled';
		case 'Image':
			return item.image.filename ?? 'Untitled';
		case 'Embed':
			return item.embed.title ?? 'Untitled';
		case 'Text':
			return item.content.plain.slice(0, 60);
		default:
			return 'Untitled';
	}
}
