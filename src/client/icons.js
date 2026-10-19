/**
 * The cost glyph for the two chips and their popovers: an outlined price tag
 * on the host 16px grid at the host's regular 1px weight. The host has no
 * money icon, so this one is drawn here. The outline spans 1.5 to 14.5 of the
 * grid, like the host glyphs, so one box size gives the same optical size as
 * the host icons beside it. The hole is a filled dot: at chip size a ring
 * hole smears into a blob, a dot stays crisp. The glyph keeps the host
 * stroke, round joins and the currentColor fill so a theme change reaches it.
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
				d: 'M14.5 9.08L9.08 14.5a1.52 1.52 0 0 1-2.16 0L1.5 9.08V3a1.5 1.5 0 0 1 1.5-1.5h5.58a1.5 1.5 0 0 1 1.06.44l4.42 4.42a1.5 1.5 0 0 1 .44 1.06v1.66Z',
			}),
			h('circle', { key: 'hole', cx: 5, cy: 5, r: 0.95, fill: 'currentColor', stroke: 'none' }),
		);
	}
	return CostIcon;
}
