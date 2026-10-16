import { PRICE_SOURCES } from '../price-sources.js';
import { invalidCnyPerUsd } from './config-draft.js';
import { createPricingTable } from './pricing-table.js';

export function createConfigPage(react, ui, useConfigController, dialogs) {
	const h = react.createElement;
	const { Button, SettingsForm, SettingsValueField, Switch } = ui;
	const PricingTable = createPricingTable(react, ui, dialogs);

	return function CostConfigCard({ t }) {
		const config = useConfigController(t);
		const [model, setModel] = react.useState('');

		if (!config.available)
			return h('div', { className: config.loadError ? 'gdcc_error' : 'gdcc_hint' }, [
				h(
					'span',
					{ key: 'message' },
					config.loadError ? t('configLoadFailed', { message: config.loadError }) : t('configLoading'),
				),
				config.loadError
					? h(Button, { key: 'retry', variant: 'outline', size: 'sm', onClick: config.retry }, t('configRetryLoad'))
					: null,
			]);

		const { draft } = config;
		const submitModel = () => {
			if (config.addModel(model)) setModel('');
		};

		return h('div', { className: 'gdcc_configCard' }, [
			h(
				SettingsForm,
				{
					key: 'form',
					labels: {
						unavailable: t('configLoading'),
						readOnly: '',
						saveFailed: config.error ?? '',
						save: t('configSave'),
						saving: t('configSaving'),
					},
					state: {
						available: true,
						writable: true,
						dirty: config.dirty,
						invalid: config.invalid,
						saving: config.saving,
						failed: config.error !== null,
					},
					onSave: config.save,
					onDiscard: config.discard,
				},
				[
					h('section', { key: 'pricing', className: 'gdcc_section', 'aria-labelledby': 'gdcc-pricing-title' }, [
						h('div', { key: 'head', className: 'gdcc_sectionHead' }, [
							h('div', { key: 'titles', className: 'gdcc_sectionTitleGroup' }, [
								h('h3', { key: 'title', id: 'gdcc-pricing-title', className: 'gdcc_sectionTitle' }, t('configPricing')),
								h('span', { key: 'unit', className: 'gdcc_hint gdcc_sectionHint' }, t('configPricingUnit')),
							]),
							h('div', { key: 'add', className: 'gdcc_addModel' }, [
								h('input', {
									key: 'input',
									className: 'gdcc_input',
									type: 'text',
									value: model,
									placeholder: t('configAddModelPlaceholder'),
									'aria-label': t('configAddModel'),
									...(config.addError ? { 'aria-invalid': 'true' } : {}),
									onChange: (event) => setModel(event.target.value),
									onKeyDown: (event) => {
										if (event.key !== 'Enter') return;
										event.preventDefault();
										submitModel();
									},
								}),
								h(Button, { key: 'button', variant: 'outline', size: 'sm', onClick: submitModel }, t('configAddModel')),
							]),
						]),
						config.addError ? h('p', { key: 'addError', className: 'gdcc_invalid' }, config.addError) : null,
						h('div', { key: 'sync', className: 'gdcc_syncRow' }, [
							h('label', { key: 'label', className: 'gdcc_syncLabel' }, [
								h('span', { key: 'text' }, t('configPriceSource')),
								h(
									'select',
									{
										key: 'select',
										className: 'gdcc_select',
										value: draft.priceSource,
										'aria-label': t('configPriceSource'),
										disabled: config.saving || config.syncing,
										onChange: (event) => config.patch('priceSource', event.target.value),
									},
									PRICE_SOURCES.map((source) => h('option', { key: source, value: source }, source)),
								),
							]),
							h(
								Button,
								{
									key: 'button',
									variant: 'outline',
									size: 'sm',
									disabled: config.invalid || config.saving || config.syncing,
									onClick: config.sync,
								},
								config.syncing ? t('configSyncing') : t('configSync'),
							),
							config.notice
								? h('span', { key: 'notice', className: 'gdcc_syncNotice', role: 'status', 'aria-live': 'polite' }, config.notice)
								: null,
							config.syncError
								? h('span', { key: 'syncError', className: 'gdcc_error', role: 'alert' }, config.syncError)
								: null,
						]),
						config.details.length
							? h(
									'ul',
									{ key: 'report', className: 'gdcc_syncReport' },
									config.details.map((entry, index) =>
										h('li', { key: `${entry.route}:${index}` }, `${entry.route}: ${t(`syncReason_${entry.reason}`)}`),
									),
								)
							: null,
						h(PricingTable, {
							key: 'rows',
							rows: draft.rows,
							rowPatch: config.rowPatch,
							setCurrency: config.setCurrency,
							removeModel: config.removeModel,
							discovered: config.discovered,
							t,
						}),
					]),
					h('section', { key: 'general', className: 'gdcc_section', 'aria-labelledby': 'gdcc-general-title' }, [
						h('h3', { key: 'title', id: 'gdcc-general-title', className: 'gdcc_sectionTitle' }, t('configSectionGeneral')),
						h(SettingsValueField, {
							key: 'rate',
							id: 'gdcc-cny-per-usd',
							label: t('configCnyPerUsd'),
							text: draft.cnyPerUsd,
							numeric: true,
							invalid: invalidCnyPerUsd(draft.cnyPerUsd),
							invalidLabel: t('configInvalidRate'),
							overridden: false,
							overriddenLabel: '',
							resetLabel: '',
							disabled: config.saving,
							onEdit: (value) => config.patch('cnyPerUsd', value),
							onReset: () => {},
						}),
						...[
							['showDockChip', t('configShowDockChip')],
							['showTurnChip', t('configShowTurnChip')],
						].map(([key, label]) =>
							h('div', { key, className: 'gdcc_switchRow' }, [
								h('span', { key: 'label', className: 'gdcc_switchLabel' }, label),
								h(Switch, {
									key: 'switch',
									checked: draft[key] === true,
									label,
									disabled: config.saving,
									onChange: (value) => config.patch(key, value),
								}),
							]),
						),
					]),
				],
			),
		]);
	};
}
