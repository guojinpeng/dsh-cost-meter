import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

function weekends(year) {
	const dates = [];
	for (let time = Date.UTC(year, 0, 1); new Date(time).getUTCFullYear() === year; time += 86400000) {
		const date = new Date(time);
		if ([0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
	}
	return dates;
}

function validDate(date) {
	const time =
		typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

export function createHolidayStore(directory, fetcher = (...args) => fetch(...args), onError = () => {}) {
	const calendars = {},
		pending = new Map(),
		attempted = new Set();
	function ensure(year) {
		if (!Number.isInteger(year) || year < 2000 || year > 2100) return Promise.resolve();
		if (calendars[year]) return Promise.resolve();
		if (pending.has(year)) return pending.get(year);
		const path = join(directory, `${year}.json`);
		try {
			const cached = JSON.parse(readFileSync(path, 'utf8'));
			if (
				cached.year === year &&
				cached.complete === true &&
				Array.isArray(cached.dates) &&
				cached.dates.length > 0 &&
				cached.dates.every((date) => validDate(date) && date.startsWith(`${year}-`))
			) {
				calendars[year] = cached.dates;
				return Promise.resolve();
			}
		} catch {}
		if (attempted.has(year)) return Promise.resolve();
		attempted.add(year);
		const request = (async () => {
			const source = `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
			const response = await fetcher(source, { signal: AbortSignal.timeout(15000) });
			if (!response.ok) throw new Error(`holiday-cn HTTP ${response.status}`);
			const data = await response.json();
			if (
				data.year !== year ||
				!Array.isArray(data.days) ||
				!data.days.some((day) => day.isOffDay === true && day.date.startsWith(`${year}-`)) ||
				!data.days.every((day) => validDate(day.date) && typeof day.isOffDay === 'boolean')
			)
				throw new Error(`Incomplete holiday-cn calendar for ${year}`);
			const dates = [
				...new Set([
					...weekends(year),
					...data.days
						.filter((day) => day.isOffDay && day.date.startsWith(`${year}-`))
						.map((day) => day.date),
				]),
			].sort();
			mkdirSync(directory, { recursive: true });
			const temporary = `${path}.tmp-${process.pid}`;
			writeFileSync(
				temporary,
				JSON.stringify({ year, complete: true, source, papers: data.papers, dates }),
				'utf8',
			);
			renameSync(temporary, path);
			calendars[year] = dates;
		})()
			.catch(onError)
			.finally(() => pending.delete(year));
		pending.set(year, request);
		return request;
	}
	return { ensure, snapshot: () => ({ ...calendars }), pending: () => [...pending.keys()] };
}
