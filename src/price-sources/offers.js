export function priceNumber(value) {
	if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Keep namespaces authoritative; only bare model IDs use a unique suffix match. */
export function matchModel(model, entries) {
	const exact = entries.filter((entry) => entry.id === model);
	const folded = model.toLowerCase();
	const candidates = exact.length ? exact : entries.filter((entry) => entry.id.toLowerCase() === folded);
	const matches =
		candidates.length || model.includes('/')
			? candidates
			: entries.filter((entry) => {
					const slash = entry.id.indexOf('/');
					return entry.id.slice(slash + 1).toLowerCase() === folded;
				});
	return matches.length === 1
		? { entry: matches[0] }
		: { status: matches.length ? 'ambiguous' : 'unmatched' };
}
