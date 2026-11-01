import type { SortKey } from './types';

const KEY = 'seeds.prefs';
const SORTS: SortKey[] = ['position_desc', 'created_at_desc', 'created_at_asc'];
export type ViewMode = 'grid' | 'list';

export const ROW_HEIGHT_MIN = 90;
export const ROW_HEIGHT_MAX = 420;
export const MOBILE_ROW_HEIGHT_DEFAULT = 260;

class Prefs {
	#rowHeight = $state(220);
	#mobileRowHeight = $state<number | null>(null);
	#sort = $state<SortKey>('position_desc');
	#viewMode = $state<ViewMode>('grid');

	constructor() {
		if (typeof localStorage === 'undefined') return;
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (typeof saved.rowHeight === 'number') {
				this.#rowHeight = Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, saved.rowHeight));
			}
			if (typeof saved.mobileRowHeight === 'number' && Number.isFinite(saved.mobileRowHeight)) {
				this.#mobileRowHeight = Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, saved.mobileRowHeight));
			}
			if (SORTS.includes(saved.sort)) this.#sort = saved.sort;
			if (saved.viewMode === 'grid' || saved.viewMode === 'list') this.#viewMode = saved.viewMode;
		} catch {
			// ignore corrupt prefs
		}
	}

	get rowHeight() {
		return this.#rowHeight;
	}
	set rowHeight(value: number) {
		this.#rowHeight = value;
		this.save();
	}

	get mobileRowHeight() {
		return this.#mobileRowHeight ?? MOBILE_ROW_HEIGHT_DEFAULT;
	}
	set mobileRowHeight(value: number) {
		this.#mobileRowHeight = value;
		this.save();
	}

	get sort() {
		return this.#sort;
	}
	set sort(value: SortKey) {
		this.#sort = value;
		this.save();
	}

	get viewMode() {
		return this.#viewMode;
	}
	set viewMode(value: ViewMode) {
		this.#viewMode = value;
		this.save();
	}

	private save() {
		localStorage.setItem(KEY, JSON.stringify({
			rowHeight: this.#rowHeight,
			...(this.#mobileRowHeight === null ? {} : { mobileRowHeight: this.#mobileRowHeight }),
			sort: this.#sort,
			viewMode: this.#viewMode
		}));
	}
}

export const prefs = new Prefs();
