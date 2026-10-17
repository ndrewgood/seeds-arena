<script lang="ts">
	import { initializeInbox } from '$lib/operations';
	import { ui } from '$lib/ui.svelte';

	function close() {
		if (!ui.initializing) ui.initPrompt = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="init-title">
		<div class="mark">
			<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
				<path d="M16 7c4 3.2 6 6.2 6 9.2A6 6 0 0 1 16 22a6 6 0 0 1-6-5.8C10 13.2 12 10.2 16 7Z" fill="currentColor" />
			</svg>
		</div>
		<h2 id="init-title">Set up Seeds</h2>
		<p>
			Seeds keeps new blocks in an <strong>📨 Inbox</strong> channel on your Are.na account until you
			sort them into folders. Folders are ordinary channels named <strong>🌱 Folder</strong>.
		</p>
		<p class="fine">
			This creates one private channel, “📨 Inbox”. It needs a token with read <em>and</em> write
			access.
		</p>
		<div class="buttons">
			<button class="ghost" type="button" onclick={close} disabled={ui.initializing}>Not now</button>
			<button class="primary" type="button" onclick={() => initializeInbox()} disabled={ui.initializing}>
				{ui.initializing ? 'Creating…' : 'Create Inbox'}
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgba(255, 255, 255, 0.6);
		backdrop-filter: blur(6px);
	}

	.dialog {
		width: 100%;
		max-width: 380px;
		padding: 26px 26px 20px;
		border-radius: 14px;
		background: var(--panel);
		box-shadow:
			0 0 0 1px var(--line),
			0 16px 48px rgba(0, 0, 0, 0.12);
	}

	.mark {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		margin-bottom: 14px;
		border-radius: 10px;
		background: var(--hover);
	}

	h2 {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 600;
	}

	p {
		margin: 0 0 10px;
		line-height: 1.5;
	}

	.fine {
		color: var(--muted);
		font-size: 12px;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 18px;
	}

	button {
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 15px;
		font-weight: 500;
	}

	.ghost {
		background: var(--hover);
	}

	.ghost:hover:not(:disabled) {
		background: var(--active);
	}

	.primary {
		background: var(--text);
		color: #fff;
	}

	.primary:hover:not(:disabled) {
		background: #000;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
