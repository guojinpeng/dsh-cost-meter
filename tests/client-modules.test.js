import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zh, en } from '../src/client/locales.js';
import { formatMoney, formatChipMoney, formatExactTokens } from '../src/client/format.js';

test('client dictionaries have matching keys and interpolation parameters', () => {
	assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
	for (const key of Object.keys(zh)) {
		const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
		assert.deepEqual(params(zh[key]), params(en[key]), key);
	}
});

test('money and token formatting preserves display precision and currency conversion', () => {
	assert.equal(formatMoney(null, 'USD', 7.2), '—');
	assert.equal(formatMoney(0, 'USD', 7.2), '$0.00');
	assert.equal(formatMoney(1234, 'USD', 7.2), '$0.0012');
	assert.equal(formatMoney(123400, 'USD', 7.2), '$0.123');
	assert.equal(formatMoney(1234000, 'USD', 7.2), '$1.23');
	assert.equal(formatMoney(1000000, 'CNY', 7.2), '¥7.20');
	assert.equal(formatChipMoney(1234, 'USD', 7.2), '$<0.01');
	assert.equal(formatChipMoney(123400, 'USD', 7.2), '$0.12');
	assert.equal(formatExactTokens(1234567), '1,234,567');
});
