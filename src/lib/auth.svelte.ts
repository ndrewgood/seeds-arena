import { goto } from '$app/navigation';
import { ArenaError, getMe, setToken, setUnauthorizedHandler } from './arena';
import { completeOAuth } from './oauth';
import type { Me } from './types';

const TOKEN_KEY = 'seeds.token';

function messageOf(e: unknown) {
	return e instanceof Error ? e.message : 'Something went wrong.';
}

class Auth {
	status = $state<'loading' | 'signed-out' | 'ready'>('loading');
	user = $state<Me | null>(null);
	error = $state<string | null>(null);
	/** True after an explicit sign-in (not a restored session), so we can offer first-run setup. */
	justSignedIn = $state(false);

	constructor() {
		setUnauthorizedHandler(() => {
			this.signOut();
			this.error = 'Your Are.na session is no longer valid. Please sign in again.';
		});
	}

	async init() {
		if (location.pathname === '/auth/callback') {
			const params = new URLSearchParams(location.search);
			if (params.has('code') || params.has('error')) {
				try {
					await this.signInWithToken(await completeOAuth(params));
				} catch (e) {
					this.error = messageOf(e);
					this.status = 'signed-out';
				}
				await goto('/', { replaceState: true });
				return;
			}
		}

		const stored = localStorage.getItem(TOKEN_KEY);
		if (!stored) {
			this.status = 'signed-out';
			return;
		}

		try {
			this.user = await getMe(stored);
			setToken(stored);
			this.status = 'ready';
		} catch (e) {
			if (e instanceof ArenaError && (e.status === 401 || e.status === 403)) {
				localStorage.removeItem(TOKEN_KEY);
			}
			this.error = messageOf(e);
			this.status = 'signed-out';
		}
	}

	/** Validates a token against /v3/me and persists it. Returns true on success. */
	async signInWithToken(token: string): Promise<boolean> {
		this.error = null;
		try {
			const me = await getMe(token);
			localStorage.setItem(TOKEN_KEY, token);
			setToken(token);
			this.user = me;
			this.justSignedIn = true;
			this.status = 'ready';
			return true;
		} catch (e) {
			this.error =
				e instanceof ArenaError && e.status === 401
					? 'That token was rejected by Are.na. Double-check it and try again.'
					: messageOf(e);
			this.status = 'signed-out';
			return false;
		}
	}

	signOut() {
		localStorage.removeItem(TOKEN_KEY);
		setToken(null);
		this.user = null;
		this.error = null;
		this.justSignedIn = false;
		this.status = 'signed-out';
		void goto('/');
	}
}

export const auth = new Auth();
