/**
 * The cost glyph for the two chips and their popovers: an outlined price tag
 * on the host 16px grid at the host's regular 1px weight. The host has no
 * money icon, so this one is drawn here. It keeps the host stroke, round
 * joins and the currentColor fill so a theme change reaches it.
 * @returns a React component that renders the svg element.
 */
export function createCostIcon(react) {
	const h = react.createElement;
	function CostIcon(props) {
		const { size = 16, className } = props ?? {};
		return h(
			'svg',
			{
				width: size,
				height: size,
				className,
				viewBox: '0 0 16 16',
				fill: 'none',
				xmlns: 'http://www.w3.org/2000/svg',
				'aria-hidden': 'true',
				strokeWidth: 1,
				stroke: 'currentColor',
				strokeLinejoin: 'round',
				strokeLinecap: 'round',
			},
			h('path', {
				key: 'body',
				d: 'M14 9l-5 5a1.4 1.4 0 0 1-2 0L2 9V2h7l5 5a1.4 1.4 0 0 1 0 2Z',
			}),
			h('circle', { key: 'hole', cx: 5.3, cy: 5.3, r: 1.05 }),
		);
	}
	return CostIcon;
}
