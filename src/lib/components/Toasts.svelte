<script lang="ts">
	import { toast } from '$lib/toast.svelte';
</script>

<div class="stack" aria-live="polite">
	{#each toast.items as t (t.id)}
		<div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
			{#if t.kind === 'info'}
				<span class="spinner" aria-hidden="true"></span>
			{/if}
			<span class="text">{t.text}</span>
			<button type="button" aria-label="Dismiss" onclick={() => toast.dismiss(t.id)}>
				<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
			</button>
		</div>
	{/each}
</div>

<style>
	.stack {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 100;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 380px;
		padding: 9px 8px 9px 14px;
		border-radius: 10px;
		background: var(--text);
		color: #fff;
		font-size: 12.5px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
		pointer-events: auto;
		animation: rise 0.14s ease-out;
	}

	.toast.error {
		background: #b3372b;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.text {
		overflow-wrap: anywhere;
	}

	button {
		flex: none;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: none;
		color: rgba(255, 255, 255, 0.7);
	}

	button:hover {
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
	}

	.spinner {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1.5px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
