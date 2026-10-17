export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
	id: number;
	text: string;
	kind: ToastKind;
}

class Toasts {
	items = $state<Toast[]>([]);
	private next = 1;
	private timers = new Map<number, ReturnType<typeof setTimeout>>();

	/** Shows a toast. `ttl` of 0 keeps it until updated or dismissed. Returns its id. */
	show(text: string, kind: ToastKind = 'info', ttl = 4000): number {
		const id = this.next++;
		this.items = [...this.items, { id, text, kind }];
		this.schedule(id, ttl);
		return id;
	}

	success(text: string) {
		return this.show(text, 'success');
	}

	error(text: string) {
		return this.show(text, 'error', 7000);
	}

	/** Replaces the text of an existing toast (e.g. "Adding…" -> "Added"). */
	update(id: number, text: string, kind: ToastKind, ttl = 4000) {
		if (!this.items.some((t) => t.id === id)) {
			this.show(text, kind, ttl);
			return;
		}
		this.items = this.items.map((t) => (t.id === id ? { ...t, text, kind } : t));
		this.schedule(id, ttl);
	}

	dismiss(id: number) {
		clearTimeout(this.timers.get(id));
		this.timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}

	private schedule(id: number, ttl: number) {
		clearTimeout(this.timers.get(id));
		if (ttl > 0) this.timers.set(id, setTimeout(() => this.dismiss(id), ttl));
	}
}

export const toast = new Toasts();
