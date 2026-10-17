<script lang="ts">
	import { channels } from '$lib/channels.svelte';
	import ChannelView from '$lib/components/ChannelView.svelte';
	import { initializeInbox } from '$lib/operations';
	import { ui } from '$lib/ui.svelte';
</script>

{#if channels.inbox}
	<ChannelView slug={channels.inbox.slug} emptyText="Inbox zero. Drop things here to sort them later." />
{:else}
	<div class="empty">
		{#if channels.loaded}
			<p class="title">No Inbox yet</p>
			<p class="hint">The Inbox collects new blocks until you sort them into folders.</p>
			<button type="button" onclick={() => initializeInbox()} disabled={ui.initializing}>
				{ui.initializing ? 'Creating…' : 'Initialize Inbox'}
			</button>
		{:else}
			<p class="hint">Loading…</p>
		{/if}
	</div>
{/if}

<style>
	.empty {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		color: var(--muted);
	}

	p {
		margin: 0;
	}

	.title {
		color: var(--text);
		font-weight: 600;
	}

	button {
		margin-top: 10px;
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 15px;
		background: var(--text);
		color: #fff;
		font-weight: 500;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
