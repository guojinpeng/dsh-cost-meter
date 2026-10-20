import { PACKAGE_ID, PLUGIN_ID, LOCALE_NAMESPACE } from '../identity.js';
import { createConfigStore } from './config-store.js';
import { zh, en } from './locales.js';
import { installStyles } from './styles.js';
import { createUseCostView } from './cost-view.js';
import { createCostDialog } from './cost-dialog.js';
import { createCostChips } from './cost-chips.js';
import { createUseConfigController } from './config-controller.js';
import { createConfigPage } from './config-page.js';
import { createCostOverviewPage } from './cost-overview.js';
import { createOverviewPrefetcher } from './overview-prefetch.js';

// React comes from the DSH module loader so every component uses the host runtime.
export function createClientPlugin(react, reactDom, ui) {
	const store = createConfigStore();
	const useCostView = createUseCostView(react, store);
	const dialogs = createCostDialog(react, reactDom);
	const { CostDockChip, CostTurnAction } = createCostChips(react, useCostView, dialogs);
	const CostConfigCard = createConfigPage(react, ui, createUseConfigController(react, store), dialogs);
	const CostOverviewPage = createCostOverviewPage(react, store);
	const NS = LOCALE_NAMESPACE;
	const ENTRY_ID = PACKAGE_ID;
	const PANEL_ID = `${PLUGIN_ID}/cost`;
	installStyles();

	const inject = [`slots`, `locale`, `uiWorkspace`];

	/** Call either disposable shape the slot registry may return. */
	function dispose(handle) {
		if (typeof handle === `function`) handle();
		else if (handle && typeof handle.dispose === `function`) handle.dispose();
	}

	/** The cost glyph: three ascending bars, the width of the other sidebar icons. */
	function CostPanelIcon({ size = 16 }) {
		return react.createElement(
			`svg`,
			{
				width: size,
				height: size,
				viewBox: `0 0 16 16`,
				fill: `none`,
				stroke: `currentColor`,
				strokeWidth: 1.2,
				strokeLinecap: `round`,
				'aria-hidden': true,
			},
			react.createElement(`path`, { d: `M2.5 13.25h11` }),
			react.createElement(`path`, { d: `M4.5 13.25V9.5` }),
			react.createElement(`path`, { d: `M8 13.25V6` }),
			react.createElement(`path`, { d: `M11.5 13.25V3.25` }),
		);
	}

	/**
	 * Register the locale dictionaries, the two cost chips, the bundle-page
	 * configuration card with the sidebar visibility switch, the cost statistics
	 * main page, and its sidebar entry.
	 * @param ctx - client plugin context.
	 */
	function apply(ctx) {
		const t = ctx.locale.bind(NS);
		// Switch to a conversation; unknown or archived ids are reported only.
		function openSession(id) {
			try {
				ctx.uiWorkspace.openSession(id);
			} catch (error) {
				console.warn(`guojinpeng/dsh-cost-meter: cannot open session ${id}`, error);
			}
		}
		// The plugin manager owns the bundle page, so the service is optional.
		function openSettings() {
			try {
				ctx.get('pluginNavigation')?.openBundle(PACKAGE_ID);
			} catch (error) {
				console.warn('guojinpeng/dsh-cost-meter: cannot open the plugin settings', error);
			}
		}
		ctx.effect(() => ctx.locale.register(NS, { zh, en }), `guojinpeng/dsh-cost-meter: dictionaries`);
		// Warm the preset-range caches while the client runs, so the cost page
		// reads the server cache instead of folding every session on open.
		ctx.effect(
			() => {
				const prefetcher = createOverviewPrefetcher(store);
				return () => prefetcher.dispose();
			},
			`guojinpeng/dsh-cost-meter: cost overview prefetch`,
		);
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

		/* Always register the page: a retained panel id must never name a missing
		   main entry, so only the sidebar entry follows the configuration. */
		ctx.effect(
			() =>
				ctx.slots.inject(`main`, () =>
					ctx.slots.register(
						{
							name: `main`,
							key: PANEL_ID,
							locale: NS,
							// Opening a ranked session also clears the panel so the
							// conversation replaces this page.
							inject: () => ({
								openSession: (id) => openSession(id),
								openSettings: () => openSettings(),
							}),
						},
						CostOverviewPage,
					),
				),
			`guojinpeng/dsh-cost-meter: cost overview page`,
		);

		/* The page stays registered while the sidebar entry can come and go: the
		   layout throws only when a sidebar entry has no matching main page, so
		   hiding the entry leaves the retained page harmless. */
		ctx.effect(
			() =>
				ctx.slots.inject(`sidebar.panellist`, () => {
					let handle = null;
					const visible = () => store.getSnapshot()?.config?.showSidebarCost !== false;
					const sync = () => {
						if (visible() && handle === null)
							handle = ctx.slots.register(
								{
									name: `sidebar.panellist`,
									id: PANEL_ID,
									order: 10,
									label: () => t(`costPanelTitle`),
									locale: NS,
								},
								CostPanelIcon,
							);
						else if (!visible() && handle !== null) {
							dispose(handle);
							handle = null;
						}
					};
					const unsubscribe = store.subscribe(sync);
					store.load().catch(() => {});
					sync();
					return () => {
						unsubscribe();
						if (handle !== null) dispose(handle);
						handle = null;
					};
				}),
			`guojinpeng/dsh-cost-meter: sidebar entry`,
		);
	}

	const exports = { apply, inject };
	Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
	return exports;
}