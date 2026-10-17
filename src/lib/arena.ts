import type { Block, Channel, Connectable, Connection, Me, Paginated, SortKey } from './types';

export const API_BASE = 'https://api.are.na';

export class ArenaError extends Error {
	status: number;
	retryAfter?: number;

	constructor(status: number, message: string, retryAfter?: number) {
		super(message);
		this.name = 'ArenaError';
		this.status = status;
		this.retryAfter = retryAfter;
	}
}

let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(token: string | null) {
	currentToken = token;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
	onUnauthorized = fn;
}

type Params = Record<string, string | number | undefined>;

interface RequestOptions {
	token?: string | null;
	signal?: AbortSignal;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
}

async function request<T>(path: string, params: Params = {}, opts: RequestOptions = {}): Promise<T> {
	const token = opts.token === undefined ? currentToken : opts.token;
	const method = opts.method ?? 'GET';
	const url = new URL(path, API_BASE);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			signal: opts.signal
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		throw new ArenaError(0, 'Could not reach Are.na. Check your connection.');
	}

	if (!res.ok) {
		let message = res.statusText || `Request failed (${res.status})`;
		try {
			const body = await res.json();
			message =
				body?.details?.message ??
				body?.error?.message ??
				(typeof body?.error === 'string' ? body.error : message);
		} catch {
			// body wasn't JSON; keep the status text
		}

		const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
		if (res.status === 429) {
			message = `Rate limited by Are.na${retryAfter ? ` — try again in ${retryAfter}s` : ''}.`;
		}
		if (res.status === 403 && method !== 'GET') {
			message = `${message} Seeds needs a token with read and write access.`;
		}
		if (res.status === 401 && token && token === currentToken) onUnauthorized?.();
		throw new ArenaError(res.status, message, retryAfter);
	}

	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export function getMe(token?: string): Promise<Me> {
	return request<Me>('/v3/me', {}, { token });
}

/** Channels owned by a user, most recently updated first. */
export function getUserChannels(userSlug: string, page: number, per = 100) {
	return request<Paginated<Channel>>(`/v3/users/${encodeURIComponent(userSlug)}/contents`, {
		type: 'Channel',
		sort: 'updated_at_desc',
		page,
		per
	});
}

export function getChannel(slugOrId: string | number) {
	return request<Channel>(`/v3/channels/${encodeURIComponent(String(slugOrId))}`);
}

export function getChannelContents(slug: string, opts: { page: number; per?: number; sort: SortKey }) {
	return request<Paginated<Connectable>>(`/v3/channels/${encodeURIComponent(slug)}/contents`, {
		page: opts.page,
		per: opts.per ?? 50,
		sort: opts.sort
	});
}

/* ----------------------------- writes ----------------------------- */

export function createChannel(input: {
	title: string;
	description?: string;
	visibility?: 'public' | 'private' | 'closed';
}) {
	return request<Channel>('/v3/channels', {}, { method: 'POST', body: input });
}

export function updateChannel(id: number, input: { title?: string; description?: string | null }) {
	return request<Channel>(`/v3/channels/${id}`, {}, { method: 'PUT', body: input });
}

/** Deletes only this channel, not the channels or blocks connected to it. */
export function deleteChannel(id: number): Promise<void> {
	return request<void>(`/v3/channels/${id}`, {}, { method: 'DELETE' });
}

/** Creates a block (from a URL or text) and connects it to the given channels. */
export function createBlock(input: { value: string; channel_ids: number[]; title?: string }) {
	return request<Block>('/v3/blocks', {}, { method: 'POST', body: input });
}

export function updateBlock(
	id: number,
	input: { title?: string; description?: string | null }
): Promise<Block> {
	// v3 accepts description as a non-nullable string; use an empty string to clear it.
	const body = {
		title: input.title,
		description: input.description === null ? '' : input.description
	};
	return request<Block>(`/v3/blocks/${id}`, {}, { method: 'PUT', body });
}

export function connect(connectableId: number, type: 'Block' | 'Channel', channelId: number) {
	return request<{ data: Connection[] }>(
		'/v3/connections',
		{},
		{
			method: 'POST',
			body: { connectable_id: connectableId, connectable_type: type, channel_ids: [channelId] }
		}
	);
}

export function disconnect(connectionId: number) {
	return request<void>(`/v3/connections/${connectionId}`, {}, { method: 'DELETE' });
}

interface PresignResponse {
	files: { upload_url: string; key: string; content_type: string }[];
	expires_in: number;
}

/** Uploads a local file to Are.na's temporary S3 bucket and returns its URL (usable as a block `value`). */
export async function uploadFile(file: File): Promise<string> {
	const contentType = file.type || 'application/octet-stream';
	const presign = await request<PresignResponse>(
		'/v3/uploads/presign',
		{},
		{ method: 'POST', body: { files: [{ filename: file.name || 'file', content_type: contentType }] } }
	);

	const target = presign.files[0];
	if (!target) throw new ArenaError(0, 'Are.na did not return an upload URL.');

	let res: Response;
	try {
		res = await fetch(target.upload_url, {
			method: 'PUT',
			headers: { 'Content-Type': target.content_type },
			body: file
		});
	} catch {
		throw new ArenaError(0, `Could not upload ${file.name}.`);
	}
	if (!res.ok) throw new ArenaError(res.status, `Upload of ${file.name} failed (${res.status}).`);

	return `https://s3.amazonaws.com/arena_images-temp/${target.key}`;
}
