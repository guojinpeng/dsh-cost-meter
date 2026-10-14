import { parseRouteKey } from '../pricing.js';
import { isDeepSeekRoute } from '../time-of-use.js';

export function createPricingTable(react, numberInput) {
	const h = react.createElement;
	function ModelRow({ row, rowPatch, currency, flush, t }) {
		const [open, setOpen] = react.useState(false);
		const model = parseRouteKey(row.key).model;
		const input = (field) =>
			react.cloneElement(
				numberInput(row[field], (value) => rowPatch(row.key, field, value), field),
				{ 'aria-label': `${row.key} ${t(field)}`, min: 0, onBlur: flush },
			);
		return h('div', { className: 'gdcc_modelItem' }, [
			h('div', { className: 'gdcc_row', key: 'row' }, [
				h('span', { key: 'model', className: 'gdcc_model', title: row.key }, model),
				h(
					'select',
					{
						key: 'currency',
						className: 'gdcc_input gdcc_currency',
						value: row.currency,
						'aria-label': `${row.key} ${t('configModelCurrency')}`,
						onChange: (event) => currency(row.key, event.target.value),
					},
					['USD', 'CNY'].map((value) => h('option', { key: value, value }, value)),
				),
				...['input', 'output', 'cacheRead'].map(input),
				h(
					'button',
					{
						key: 'advanced',
						type: 'button',
						className: 'gdcc_expand',
						title: t('configAdvanced'),
						'aria-label': `${row.key} ${t('configAdvanced')}`,
						'aria-expanded': open,
						onClick: () => setOpen(!open),
					},
					h('span', { 'aria-hidden': true }, open ? '⌄' : '›'),
				),
			]),
			open
				? h('div', { key: 'advanced', className: 'gdcc_modelOptions' }, [
						h('label', { key: 'cacheWrite', className: 'gdcc_option' }, [
							h('span', { key: 'label' }, `${t('cacheWrite')} (${row.currency} / 1M tokens)`),
							input('cacheWrite'),
						]),
						isDeepSeekRoute(row.key)
							? h('label', { key: 'peak', className: 'gdcc_switch' }, [
									h('span', { key: 'label' }, t('configAutoOffPeak')),
									h('input', {
										key: 'input',
										type: 'checkbox',
										role: 'switch',
										checked: row.autoOffPeak === true,
										'aria-label': `${row.key} ${t('configAutoOffPeak')}`,
										onChange: (event) => rowPatch(row.key, 'autoOffPeak', event.target.checked),
									}),
								])
							: null,
						row.autoOffPeak === undefined && isDeepSeekRoute(row.key)
							? h('span', { key: 'legacy', className: 'gdcc_hint' }, t('configLegacyFixed'))
							: null,
					])
				: null,
		]);
	}
	return function PricingTable({ rows, rowPatch, currency, flush, t }) {
		const groups = new Map();
		for (const row of rows) {
			const { provider } = parseRouteKey(row.key);
			if (!groups.has(provider)) groups.set(provider, []);
			groups.get(provider).push(row);
		}
		return h('div', { className: 'gdcc_rows' }, [
			rows.length
				? h(
						'div',
						{ key: 'head', className: 'gdcc_row gdcc_tableHead' },
						['modelName', 'configModelCurrency', 'input', 'output', 'cacheRead', ''].map((key) =>
							h('span', { key, className: 'gdcc_rowHead' }, key ? t(key) : ''),
						),
					)
				: null,
			...[...groups].flatMap(([provider, entries]) => [
				h(
					'div',
					{ key: `provider:${provider}`, className: 'gdcc_provider', role: 'heading', 'aria-level': 3 },
					provider,
				),
				...entries.map((row) => h(ModelRow, { key: row.key, row, rowPatch, currency, flush, t })),
			]),
			rows.length ? null : h('div', { key: 'empty', className: 'gdcc_hint' }, t('configEmpty')),
		]);
	};
}
