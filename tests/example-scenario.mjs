import { buildOverview } from '../src/server/overview.js';
import { createCostUsageProjection } from '../src/server/projection.js';

// A fully invented scenario for the documentation screenshots: fictional
// providers, models, sessions and usage. Nothing here comes from a real
// machine, so the images show shape and behaviour, not someone's data.

export const examplePricing = {"nebula-labs/nebula-4-max":{"currency":"CNY","input":108,"output":540,"cacheRead":10.8,"cacheWrite":135},"nebula-labs/nebula-4-lite":{"currency":"CNY","input":21.6,"output":108,"cacheRead":2.16,"cacheWrite":27},"helios-ai/helios-3-pro":{"currency":"CNY","input":21.6,"output":108,"cacheRead":2.16,"cacheWrite":0},"helios-ai/helios-3-flash":{"currency":"CNY","input":4,"output":16,"cacheRead":0.8,"cacheWrite":4},"polaris/polaris-2.5":{"currency":"CNY","input":14.4,"output":43.2,"cacheRead":1.8,"cacheWrite":18},"polaris/polaris-2.5-mini":{"currency":"CNY","input":2,"output":8,"cacheRead":0.4,"cacheWrite":0},"kestrel/kestrel-5":{"currency":"CNY","input":9,"output":72,"cacheRead":0.9,"cacheWrite":0},"kestrel/kestrel-5-mini":{"currency":"CNY","input":2,"output":8,"cacheRead":0.2,"cacheWrite":0},"vertex-ai/vertex-3":{"currency":"CNY","input":9,"output":72,"cacheRead":2.3,"cacheWrite":0},"sunrise/sunrise-1":{"currency":"CNY","input":2,"output":8,"cacheRead":0.2,"cacheWrite":0},"sunset-labs/sunset-1":{"currency":"CNY","input":60,"output":240,"cacheRead":6,"cacheWrite":0},"moonlight/moonlight-2":{"currency":"CNY","input":4,"output":16,"cacheRead":0.8,"cacheWrite":4}};
const config = { currency: 'CNY', cnyPerUsd: 7.2, showDockChip: true, showTurnChip: true, pricing: examplePricing };
const routes = Object.keys(examplePricing);
// Three routes stay unused, so the scatter image keeps the model names apart.

const projection = createCostUsageProjection(() => config, {
	ensure: () => {},
	snapshot: () => ({ 2026: ['2026-10-01'] }),
});
const sessions = [
	{ id: 'session-1a', title: '整理季度采购合同的付款条款', days: [2, 3, 4, 6, 9], models: [1, 5, 10] },
	{ id: 'session-2b', title: '生成八月运营周报的数据摘要', days: [6, 7, 8, 10], models: [0, 2, 11] },
	{ id: 'session-3c', title: '排查订单中心告警的根因', days: [4, 5, 9, 11], models: [2, 6, 9] },
	{ id: 'session-4d', title: '把接口文档改写为英文版本', days: [1, 3, 8], models: [1, 7, 11] },
	{ id: 'session-5e', title: '对比三种缓存策略的压测结果', days: [2, 7, 10, 12], models: [2, 1, 6] },
	{ id: 'session-6f', title: '输出客服知识库的补全计划', days: [5, 8], models: [0, 1, 5] },
	{ id: 'session-7g', title: '复核财务报表中的汇率口径', days: [9, 11], models: [1, 7, 11] },
	{ id: 'session-8h', title: '梳理新人培训的课程大纲', days: [1, 4, 6, 12], models: [2, 9, 10] },
];
const startDay = Date.parse('2026-10-09T00:00:00+08:00');
const pad = (value) => String(value).padStart(2, '0');
const entries = [];
for (const [sessionIndex, session] of sessions.entries()) {
	let state = projection.init();
	let turn = 0;
	for (const [dayIndex, day] of session.days.entries()) {
		const hour = 9 + ((sessionIndex * 3 + dayIndex * 2) % 10);
		const time = Date.parse('2026-10-' + pad(day + 8) + 'T' + pad(hour) + ':24:00+08:00');
		turn += 1;
		const events = [
			{ type: 'turn/start', time, data: { turn } },
			{ type: 'step/start', time, data: { turn, step: 1 } },
		];
		for (const [modelIndex, routeIndex] of session.models.entries()) {
			const parts = routes[routeIndex].split('/');
			// A route weight separates the models vertically, so the scatter stays readable.
			const scale = (1 + ((sessionIndex + dayIndex + modelIndex) % 5) * 0.6) * (0.6 + ((routeIndex * 41) % 100) / 93);
			const usage = {
				inputTokens: Math.round((12000 + ((dayIndex * 7919 + modelIndex * 104729) % 60000)) * scale),
				outputTokens: Math.round((1400 + ((dayIndex * 3571 + modelIndex * 7) % 6000)) * scale),
				cacheReadTokens: Math.round((90000 + ((dayIndex * 15485863 + modelIndex * 31) % 700000)) * scale),
				cacheWriteTokens: Math.round((6000 + ((dayIndex * 131 + modelIndex * 17) % 30000)) * scale),
			};
			usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
			events.push({
				type: 'assistant/message',
				time: time + 4000,
				data: { turn, step: 1 + modelIndex, usage, message: { source: { provider: parts[0], model: parts[1] } } },
			});
			events.push({ type: 'step/end', time: time + 5000, data: { turn, step: 1 + modelIndex } });
		}
		events.push({ type: 'turn/end', time: time + 8000, data: { turn } });
		for (const event of events) state = projection.apply(state, event);
	}
	const firstDay = Math.min(...session.days) + 8;
	const createdAt = Date.parse('2026-10-' + pad(firstDay) + 'T08:30:00+08:00');
	entries.push({ header: { id: session.id, createdAt, parentSession: null }, state });
}
const titles = new Map(sessions.map((session) => [session.id, session.title]));
export const exampleOverviewPayload = buildOverview({
	entries,
	config,
	range: '30',
	start: null,
	end: null,
	now: Date.parse('2026-10-22T17:10:00+08:00'),
	titles,
	calendars: { 2026: ['2026-10-01'] },
});
