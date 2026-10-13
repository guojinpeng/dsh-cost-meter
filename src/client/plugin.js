import { PACKAGE_ID, PLUGIN_ID, LOCALE_NAMESPACE } from '../identity.js';
import { createConfigStore } from './config-store.js';
import { zh, en } from './locales.js';
import { installStyles } from './styles.js';
import { createUseCostView } from './cost-view.js';
import { createCostDialog } from './cost-dialog.js';
import { createCostChips } from './cost-chips.js';
import { createUseConfigController } from './config-controller.js';
import { createConfigPage } from './config-page.js';

// React comes from the DSH module loader so every component uses the host runtime.
export function createClientPlugin(react, reactDom) {
	const store = createConfigStore();
	const useCostView = createUseCostView(react, store);
	const dialogs = createCostDialog(react, reactDom);
	const { CostDockChip, CostTurnAction } = createCostChips(react, useCostView, dialogs);
	const CostConfigCard = createConfigPage(react, createUseConfigController(react, store));
	const NS = LOCALE_NAMESPACE;
	const ENTRY_ID = PACKAGE_ID;
	installStyles();

	const inject = [`slots`, `locale`];

	/**
	 * Register the locale dictionaries, the two cost chips, and the
	 * bundle-page configuration card that edits the model price table.
	 * @param ctx - client plugin context.
	 */
	function apply(ctx) {
		ctx.effect(() => ctx.locale.register(NS, { zh, en }), `guojinpeng/dsh-cost-meter: dictionaries`);
		ctx.slots.inject(`conversation.composer.dock`, () =>
			ctx.slots.register(
				{
					name: `conversation.composer.dock`,
					id: `${PLUGIN_ID}/dock`,
					order: 10,
					locale: NS,
				},
				CostDockChip,
			),
		);
		ctx.slots.inject(`conversation.chat.assistant-actions`, () =>
			ctx.slots.register(
				{
					name: `conversation.chat.assistant-actions`,
					id: `${PLUGIN_ID}/turn`,
					order: 10,
					locale: NS,
				},
				CostTurnAction,
			),
		);

		ctx.effect(
			() =>
				ctx.slots.inject(`plugins.bundle.config`, () =>
					ctx.slots.register(
						{
							name: `plugins.bundle.config`,
							key: ENTRY_ID,
							locale: NS,
							inject: () => ({}),
						},
						CostConfigCard,
					),
				),
			`guojinpeng/dsh-cost-meter: bundle config page`,
		);
	}

	const exports = { apply, inject };
	Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
	return exports;
}
