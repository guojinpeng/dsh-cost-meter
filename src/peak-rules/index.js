import { rule as aliyun } from './aliyun.js';
import { rule as deepseek } from './deepseek.js';
import { rule as glm } from './glm.js';

/** Every selectable rule, in display order. Each rule lives in its own file. */
export const PEAK_RULES = [deepseek, aliyun, glm];
export const PEAK_RULE_IDS = PEAK_RULES.map((rule) => rule.id);
export const DEFAULT_PEAK_RULE = deepseek.id;

/** One rule by id. An unknown id falls back to the default rule. */
export function peakRule(id) {
	return PEAK_RULES.find((rule) => rule.id === id) ?? deepseek;
}
