import { parseRouteKey, RATE_KEYS } from '../pricing.js';
import { DEFAULT_PEAK_RULE, PEAK_RULES } from '../time-of-use.js';
import { invalidPrice } from './config-draft.js';

export function createPricingTable(react, ui, dialogs) {
	const h = react.createElement;
	const { Button, Switch, Tag } = ui;
	const { useCostDialog, panel, IconInfoOutlineRegular } = dialogs;

	/**
	 * The peak rule of one model: the rule list and an info button that
	 * opens the clock-window explanation of the selected rule.
	 */
	function PeakRuleField({ routeKey, rowPatch, value, t }) {
		const dialog = useCostDialog();
		const rule = PEAK_RULES.find((entry) => entry.id === value) ?? PEAK_RULES[0];
		const hint = t(rule.hint);
		return h('span', { className: 'gdcc_ruleField', ref: dialog.rootRef }, [
			h('span', { key: 'label', className: 'gdcc_hint' }, t('configPeakRule')),
			h(
				'select',
				{
					key: 'select',
					className: 'gdcc_select gdcc_ruleSelect',
					value: rule.id,
					'aria-label': `${routeKey} ${t('configPeakRule')}`,
					onChange: (event) => rowPatch(routeKey, 'peakRule', event.target.value),
				},
				PEAK_RULES.map((entry) => h('option', { key: entry.id, value: entry.id }, t(entry.label))),
			),
			h(
				'button',
				{
					key: 'info',
					type: 'button',
					className: 'gdcc_info',
					title: hint,
					'aria-label': `${routeKey} ${t('configRuleInfo')}`,
					'aria-haspopup': 'dialog',
					'aria-expanded': dialog.open,
					onClick: () => dialog.setOpen(!dialog.open),
				},
				h(IconInfoOutlineRegular, null),
			),
			dialog.open
				? panel({
						panelRef: dialog.panelRef,
						pos: dialog.pos,
						title: t('configPeakRule'),
						value: t(rule.label),
						icon: IconInfoOutlineRegular,
						children: h('div', { className: 'gdcc_note' }, hint),
					})
				: null,
		]);
	}

	function ModelRow({ row, rowPatch, setCurrency, removeModel, removable, t }) {
		const [open, setOpen] = react.useState(false);
		const model = parseRouteKey(row.key).model;
		const cell = (field) =>
			h('input', {
				key: field,
				className: 'gdcc_cell',
				type: 'text',
				inputMode: 'decimal',
				value: row[field],
				'aria-label': `${row.key} ${t(field)}`,
				...(invalidPrice(row[field]) ? { 'aria-invalid': 'true', 'aria-describedby': 'gdcc-price-error' } : {}),
				onChange: (event) => rowPatch(row.key, field, event.target.value),
			});
		return h('div', { className: 'gdcc_modelItem' }, [
			h('div', { key: 'row', className: 'gdcc_row' }, [
				h('span', { key: 'model', className: 'gdcc_model', title: row.key }, model),
				h(
					'select',
					{
						key: 'currency',
						className: 'gdcc_select',
						value: row.currency,
						'aria-label': `${row.key} ${t('configModelCurrency')}`,
						onChange: (event) => setCurrency(row.key, event.target.value),
					},
					['USD', 'CNY'].map((value) => h('option', { key: value, value }, value)),
				),
				...['input', 'output', 'cacheRead'].map(cell),
				h(
					Button,
					{
						key: 'more',
						variant: 'ghost',
						size: 'sm',
						className: 'gdcc_rowToggle',
						title: `${row.key} ${t('configRowMore')}`,
						'aria-label': `${row.key} ${t('configRowMore')}`,
						'aria-expanded': open,
						onClick: () => setOpen(!open),
					},
					h('span', { 'aria-hidden': true }, open ? '⌄' : '›'),
				),
			]),
			open
				? h('div', { key: 'more', className: 'gdcc_modelOptions' }, [
						h('label', { key: 'cacheWrite', className: 'gdcc_option' }, [
							h('span', { key: 'label' }, `${t('cacheWrite')} (${row.currency} / 1M tokens)`),
							cell('cacheWrite'),
						]),
						h('span', { key: 'peak', className: 'gdcc_option' }, [
							h('span', { key: 'label' }, t('configAutoOffPeak')),
							h(Switch, {
								key: 'switch',
								checked: row.autoOffPeak === true,
								label: `${row.key} ${t('configAutoOffPeak')}`,
								onChange: (value) => rowPatch(row.key, 'autoOffPeak', value),
							}),
						]),
						row.autoOffPeak === true
							? h(PeakRuleField, {
									key: 'rule',
									routeKey: row.key,
									rowPatch,
									value: row.peakRule ?? DEFAULT_PEAK_RULE,
									t,
								})
							: null,
						row.source === 'manual' ? h(Tag, { key: 'manual', tone: 'neutral' }, t('configManualPrice')) : null,
						removable
							? h(
									Button,
									{ key: 'remove', variant: 'ghost', size: 'sm', className: 'gdcc_remove', onClick: () => removeModel(row.key) },
									t('configRemoveModel'),
								)
							: null,
					])
				: null,
		]);
	}

	return function PricingTable({ rows, rowPatch, setCurrency, removeModel, discovered, t }) {
		const badPrice = rows.some((row) => RATE_KEYS.some((field) => invalidPrice(row[field])));
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
						['modelName', 'configModelCurrency', 'input', 'output', 'cacheRead', ''].map((key, index) =>
							h(
								'span',
								{ key: key || 'more', className: index > 1 && index < 5 ? 'gdcc_rowHead gdcc_num' : 'gdcc_rowHead' },
								key ? t(key) : '',
							),
						),
					)
				: null,
			...[...groups].flatMap(([provider, entries]) => [
				h(
					'div',
					{ key: `provider:${provider}`, className: 'gdcc_provider', role: 'heading', 'aria-level': 3 },
					provider,
				),
				...entries.map((row) =>
					h(ModelRow, {
						key: row.key,
						row,
						rowPatch,
						setCurrency,
						removeModel,
						removable: !discovered.includes(row.key),
						t,
					}),
				),
			]),
			rows.length ? null : h('div', { key: 'empty', className: 'gdcc_hint' }, t('configEmpty')),
			badPrice
				? h('p', { key: 'error', id: 'gdcc-price-error', className: 'gdcc_invalid' }, t('configInvalidPrice'))
				: null,
		]);
	};
}