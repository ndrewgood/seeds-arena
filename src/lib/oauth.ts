import { API_BASE } from './arena';

/**
 * Optional OAuth2 (authorization code + PKCE) sign-in.
 * Enabled only when VITE_ARENA_CLIENT_ID is set (see README).
 */
const CLIENT_ID = import.meta.env.VITE_ARENA_CLIENT_ID as string | undefined;
const STORAGE_KEY = 'seeds.oauth';

export const oauthEnabled = Boolean(CLIENT_ID);

function redirectUri() {
	return `${location.origin}/auth/callback`;
}

function base64url(bytes: Uint8Array) {
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomString(byteLength: number) {
	return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function beginOAuth() {
	if (!CLIENT_ID) throw new Error('OAuth is not configured.');

	const verifier = randomString(48);
	const state = randomString(16);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ verifier, state }));

	const url = new URL('https://www.are.na/oauth/authorize');
	url.search = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: redirectUri(),
		response_type: 'code',
		// Folders, the Inbox and drag-and-drop all write to Are.na; "write" includes read.
		scope: 'write',
		state,
		code_challenge: base64url(new Uint8Array(digest)),
		code_challenge_method: 'S256'
	}).toString();

	location.href = url.toString();
}

/** Exchanges the `?code=` from the redirect for an access token. */
export async function completeOAuth(params: URLSearchParams): Promise<string> {
	const error = params.get('error');
	if (error) throw new Error(params.get('error_description') ?? error);

	const saved = sessionStorage.getItem(STORAGE_KEY);
	sessionStorage.removeItem(STORAGE_KEY);
	if (!saved || !CLIENT_ID) throw new Error('Sign-in session expired. Please try again.');

	const { verifier, state } = JSON.parse(saved) as { verifier: string; state: string };
	const code = params.get('code');
	if (!code || params.get('state') !== state) throw new Error('Sign-in could not be verified.');

	const res = await fetch(`${API_BASE}/v3/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code,
			redirect_uri: redirectUri(),
			code_verifier: verifier
		})
	});

	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		throw new Error(body.error_description ?? 'Are.na rejected the sign-in.');
	}
	return body.access_token as string;
}
