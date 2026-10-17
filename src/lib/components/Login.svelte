<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { beginOAuth, oauthEnabled } from '$lib/oauth';

	let token = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = token.trim();
		if (!value || busy) return;
		busy = true;
		await auth.signInWithToken(value);
		busy = false;
	}
</script>

<div class="screen">
	<div class="card">
		<div class="mark">
			<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
				<path
					d="M16 7c4 3.2 6 6.2 6 9.2A6 6 0 0 1 16 22a6 6 0 0 1-6-5.8C10 13.2 12 10.2 16 7Z"
					fill="currentColor"
				/>
			</svg>
		</div>

		<h1>Seeds</h1>
		<p class="lede">A quiet, visual way to browse your Are.na channels.</p>

		{#if oauthEnabled}
			<button class="primary" type="button" onclick={() => beginOAuth()}>
				Continue with Are.na
			</button>
			<div class="or"><span>or use a token</span></div>
		{/if}

		<form onsubmit={submit}>
			<label for="token">Personal access token</label>
			<input
				id="token"
				type="password"
				placeholder="Paste your token"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				bind:value={token}
			/>
			<button class="primary" class:secondary={oauthEnabled} type="submit" disabled={!token.trim() || busy}>
				{busy ? 'Connecting…' : 'Connect'}
			</button>
		</form>

		{#if auth.error}
			<p class="error" role="alert">{auth.error}</p>
		{/if}

		<p class="help">
			Create a token at
			<a href="https://www.are.na/settings/personal-access-tokens" target="_blank" rel="noreferrer">
				are.na/settings/personal-access-tokens
			</a>
			with the <strong>write</strong> scope (read and write access). It's stored only in this browser and sent only to Are.na.
		</p>
	</div>
</div>

<style>
	.screen {
		height: 100vh;
		display: grid;
		place-items: center;
		padding: 24px;
	}

	.card {
		width: 100%;
		max-width: 360px;
		background: var(--panel);
		border-radius: 18px;
		padding: 32px 28px 24px;
		box-shadow:
			0 0 0 1px var(--line),
			0 12px 40px rgba(0, 0, 0, 0.06);
		display: flex;
		flex-direction: column;
	}

	.mark {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: var(--text);
		color: #fff;
		display: grid;
		place-items: center;
		margin-bottom: 18px;
	}

	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.lede {
		margin: 4px 0 22px;
		color: var(--muted);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	label {
		font-size: 12px;
		color: var(--muted);
	}

	input {
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--bg);
		outline: none;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	input:focus {
		background: #fff;
		border-color: rgba(0, 0, 0, 0.28);
	}

	.primary {
		height: 36px;
		border: 0;
		border-radius: 9px;
		background: var(--text);
		color: #fff;
		font-weight: 500;
		transition: opacity 0.15s;
	}

	.primary:hover:not(:disabled) {
		opacity: 0.86;
	}

	.primary:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.primary.secondary {
		background: var(--hover);
		color: var(--text);
	}

	.or {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 16px 0;
		color: var(--faint);
		font-size: 11.5px;
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.error {
		margin: 12px 0 0;
		color: #c0392b;
		font-size: 12.5px;
	}

	.help {
		margin: 20px 0 0;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.5;
	}

	.help a {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--faint);
		text-underline-offset: 2px;
	}
</style>
