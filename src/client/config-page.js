import { createFormControls } from './form-controls.js';
import { createPricingTable } from './pricing-table.js';

export function createConfigPage(react, useConfigController) {
	const h = react.createElement;
	const { field, numberInput } = createFormControls(react);
	const PricingTable = createPricingTable(react, numberInput);
	/**
	 * The bundle-page configuration card (plugins.bundle.config).
	 *
	 * Self-managed persistence: the draft is loaded from and saved to the
	 * host half's loopback config route, which owns
	 * `<DSH_HOME>/guojinpeng/dsh-cost-meter/config.json`. No settings namespace and no
	 * form controller are involved.
	 */
	function CostConfigCard(props) {
		const t = props.t;
		const { draft, dirty, busy, error, notice, patch, rowPatch, run, reload } = useConfigController(t);
		if (!draft) return h('div', { className: error ? 'gdcc_error' : 'gdcc_hint' }, error || t('configLoading'));

		return h('fieldset', { className: 'gdcc_form', disabled: busy }, [
			field(
				t('configCurrency'),
				h(
					'select',
					{ className: 'gdcc_input', value: draft.currency, onChange: (e) => patch('currency', e.target.value) },
					['USD', 'CNY'].map((value) => h('option', { key: value, value }, value)),
				),
				'currency',
			),
			field(
				t('configCnyPerUsd'),
				numberInput(draft.cnyPerUsd, (value) => patch('cnyPerUsd', value)),
				'exchange',
			),
			...['showDockChip', 'showTurnChip'].map((key) =>
				field(
					t(key === 'showDockChip' ? 'configShowDockChip' : 'configShowTurnChip'),
					h('input', {
						className: 'gdcc_input',
						type: 'checkbox',
						checked: draft[key],
						onChange: (e) => patch(key, e.target.checked),
					}),
					key,
				),
			),
			h('div', { key: 'pricing', className: 'gdcc_sub' }, t('configPricing') + ' (USD / 1M tokens)'),
			h('div', { key: 'source', className: 'gdcc_actions' }, [
				h('span', { key: 'from' }, t('configFrom')),
				h(
					'select',
					{
						key: 'select',
						className: 'gdcc_input',
						style: { width: 'auto' },
						'aria-label': t('configPriceSource'),
					},
					h('option', { value: 'models.dev' }, 'models.dev'),
				),
				h(
					'button',
					{ key: 'sync', type: 'button', className: 'gdcc_btn', disabled: dirty || busy, onClick: () => run(true) },
					t('configSync'),
				),
			]),
			dirty ? h('div', { key: 'dirty', className: 'gdcc_hint' }, t('configDirty')) : null,
			h(PricingTable, { key: 'rows', rows: draft.rows, rowPatch, t }),
			h('div', { key: 'actions', className: 'gdcc_actions' }, [
				error ? h('span', { key: 'error', className: 'gdcc_error' }, error) : null,
				notice ? h('span', { key: 'notice', className: 'gdcc_ok' }, notice) : null,
				h(
					'button',
					{
						key: 'reload',
						type: 'button',
						className: 'gdcc_btn',
						onClick: reload,
					},
					t('configReload'),
				),
				h(
					'button',
					{ key: 'save', type: 'button', className: 'gdcc_btn gdcc_btnPrimary', onClick: () => run(false) },
					busy ? t('configSaving') : t('configSave'),
				),
			]),
		]);
	}

	return CostConfigCard;
}
