import { RATE_KEYS, zeroRate, parseRouteKey } from '../pricing.js';

export function createPricingTable(react, numberInput) {
	const h = react.createElement;
	return function PricingTable({ rows: modelRows, rowPatch, t }) {
		const groups = new Map();
		modelRows.forEach((row, index) => {
			const { provider, model } = parseRouteKey(row.key);
			if (!groups.has(provider)) groups.set(provider, []);
			groups.get(provider).push({ row, index, model });
		});
		const rows = [...groups].flatMap(([provider, entries]) => [
			h('div', { key: `provider:${provider}`, className: 'gdcc_provider', role: 'heading', 'aria-level': 3 }, provider),
			...entries.map(({ row, index, model }) =>
				h('div', { className: 'gdcc_row', key: row.key }, [
					h('span', { key: 'model', className: 'gdcc_model', title: row.key }, model),
					...RATE_KEYS.map((key) => numberInput(row[key], (value) => rowPatch(index, { [key]: value }), key)),
					h(
						'button',
						{
							key: 'reset',
							type: 'button',
							className: 'gdcc_btn',
							title: t('configReset'),
							onClick: () => rowPatch(index, zeroRate()),
						},
						'↺',
					),
				]),
			),
		]);
		return h(react.Fragment, null, [
			h('div', { key: 'rows', className: 'gdcc_rows' }, [
				h(
					'div',
					{ key: 'head', className: 'gdcc_row' },
					['modelName', 'input', 'output', 'cacheRead', 'cacheWrite', ''].map((key) =>
						h('span', { key, className: 'gdcc_rowHead' }, key ? t(key) : ''),
					),
				),
				...rows,
			]),
			modelRows.length ? null : h('div', { key: 'empty', className: 'gdcc_hint' }, t('configEmpty')),
		]);
	};
}
