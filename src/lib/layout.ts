export interface Placed {
	index: number;
	width: number;
	height: number;
}

export interface Row {
	height: number;
	items: Placed[];
}

/**
 * Justified rows: every row is stretched to exactly fill `containerWidth`
 * while each item keeps its aspect ratio (like Atlas / Google Photos).
 * The final, incomplete row stays at the target height and is left-aligned.
 */
export function justify(
	ratios: number[],
	containerWidth: number,
	targetHeight: number,
	gap: number
): Row[] {
	if (containerWidth <= 0) return [];

	const rows: Row[] = [];
	let batch: number[] = [];
	let ratioSum = 0;

	const commit = (height: number, fill: boolean) => {
		const items: Placed[] = [];
		let used = 0;
		batch.forEach((index, i) => {
			const isLast = i === batch.length - 1;
			let width = Math.floor(ratios[index] * height);
			if (fill && isLast) {
				// Absorb rounding error so the row ends flush with the container.
				width = Math.floor(containerWidth - used - gap * i);
			}
			used += width;
			items.push({ index, width: Math.max(1, width), height });
		});
		rows.push({ height, items });
		batch = [];
		ratioSum = 0;
	};

	for (let i = 0; i < ratios.length; i++) {
		batch.push(i);
		ratioSum += ratios[i];

		const widthAtTarget = ratioSum * targetHeight + gap * (batch.length - 1);
		if (widthAtTarget >= containerWidth) {
			const height = Math.floor((containerWidth - gap * (batch.length - 1)) / ratioSum);
			commit(height, true);
		}
	}

	if (batch.length) commit(targetHeight, false);
	return rows;
}
