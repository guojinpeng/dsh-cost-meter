import { createFormControls } from './form-controls.js';
import { createPricingTable } from './pricing-table.js';
import { PRICE_SOURCES } from '../price-sources.js';

export function createConfigPage(react, useConfigController) {
	const h = react.createElement;
	const { field, numberInput } = createFormControls(react);
	const PricingTable = createPricingTable(react, numberInput);
	return function CostConfigCard({ t }) {
		const {
			draft,
			busy,
			invalid,
			saving,
			error,
			notice,
			syncDetails,
			patch,
			rowPatch,
			currency,
			sync,
			flush,
			retry,
		} = useConfigController(t);
		if (!draft)
			return h('div', { className: error ? 'gdcc_error' : 'gdcc_hint' }, [
				h('span', { key: 'message' }, error || t('configLoading')),
				error
					? h(
							'button',
							{
								key: 'retry',
								className: 'gdcc_expand',
								title: t('configRetryLoad'),
								'aria-label': t('configRetryLoad'),
								onClick: retry,
							},
							'↻',
						)
					: null,
			]);
		return h('fieldset', { className: 'gdcc_form', disabled: busy }, [
			h(
				'div',
				{ key: 'status', className: 'gdcc_saveStatus', role: 'status', 'aria-live': 'polite' },
				error
					? [
							h('span', { key: 'error', className: 'gdcc_error' }, error),
							!invalid
								? h(
										'button',
										{
											key: 'retry',
											type: 'button',
											className: 'gdcc_expand',
											title: t('configRetry'),
											'aria-label': t('configRetry'),
											onClick: retry,
										},
										'↻',
									)
								: null,
						]
					: saving
						? t('configSaving')
						: notice,
			),
			h('details', { key: 'basic', className: 'gdcc_section', open: true }, [
				h('summary', { key: 'title' }, t('configBasic')),
				h('div', { key: 'content', className: 'gdcc_sectionBody' }, [
					h('div', { key: 'toolbar', className: 'gdcc_tableToolbar' }, [
						h('span', { key: 'title', className: 'gdcc_hint' }, `${t('configPricing')} / 1M tokens`),
						h('div', { key: 'source', className: 'gdcc_syncControls' }, [
							h('label', { key: 'label', className: 'gdcc_sourceLabel' }, [
								h('span', { key: 'from' }, t('configFrom')),
								h(
									'select',
									{
										key: 'select',
										className: 'gdcc_input',
										value: draft.priceSource,
										'aria-label': t('configPriceSource'),
										onChange: (event) => patch('priceSource', event.target.value),
									},
									PRICE_SOURCES.map((source) => h('option', { key: source, value: source }, source)),
								),
							]),
							h(
								'button',
								{
									key: 'sync',
									type: 'button',
									className: 'gdcc_btn',
									disabled: busy || !!error,
									onClick: sync,
								},
								busy ? t('configSyncing') : t('configSync'),
							),
						]),
					]),
					syncDetails.length
						? h(
								'ul',
								{ key: 'report', className: 'gdcc_syncReport' },
								syncDetails.map((entry, index) =>
									h(
										'li',
										{ key: `${entry.route}:${index}` },
										`${entry.route}: ${t(`syncReason_${entry.reason}`)}`,
									),
								),
							)
						: null,
					h(PricingTable, { key: 'rows', rows: draft.rows, rowPatch, currency, flush, t }),
				]),
			]),
			h('details', { key: 'advanced', className: 'gdcc_section' }, [
				h('summary', { key: 'title' }, t('configAdvanced')),
				h('div', { key: 'content', className: 'gdcc_sectionBody gdcc_fields' }, [
					field(
						t('configCnyPerUsd'),
						react.cloneElement(
							numberInput(draft.cnyPerUsd, (value) => patch('cnyPerUsd', value)),
							{ 'aria-label': t('configCnyPerUsd'), min: 0, onBlur: flush },
						),
						'exchange',
					),
					...['showDockChip', 'showTurnChip'].map((key) =>
						field(
							t(key === 'showDockChip' ? 'configShowDockChip' : 'configShowTurnChip'),
							h('input', {
								type: 'checkbox',
								role: 'switch',
								className: 'gdcc_input',
								checked: draft[key],
								'aria-label': t(key === 'showDockChip' ? 'configShowDockChip' : 'configShowTurnChip'),
								onChange: (event) => patch(key, event.target.checked),
							}),
							key,
						),
					),
				]),
			]),
		]);
	};
}
