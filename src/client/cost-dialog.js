export function createCostDialog(react, reactDom) {
	const h = react.createElement;
	// This plugin ships no dependency on a DSH Client package. A separate
	// npm plugin may not runtime-import one: its bundle is built outside the
	// Harness module table, so there is no supplier for such a request. The
	// two hooks and the info glyph below are therefore copied from
	// `@deepseek-ai/dsh-client-ui-primitives` (v0.2.1-alpha.2,
	// src/useAnchoredPosition.ts, src/useDismissOnOutsidePointer.ts, and
	// src/icons/index.tsx). Inlined copies stay local to this plugin; an
	// upstream primitive change does not reach them. The cost glyph lives in
	// icons.js because both chips and both panels use it.

	/** Viewport inset an overlay keeps below the desktop frame's top strip. */
	function overlayTopMargin(min) {
		const root = document.documentElement;
		const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue(`--dsh-frame-top-clearance`));
		if (Number.isNaN(clearance)) return min;
		return Math.max(min, (root.hasAttribute(`data-fullscreen`) ? 0 : clearance) + 20);
	}

	/**
	 * Track an anchor and return a fixed-position panel's coordinates.
	 * Measurements stop being valid as soon as anything scrolls or resizes,
	 * so this re-measures on scroll (capture phase, catching nested
	 * scrollers), on resize, and on the panel's own size changes.
	 * @returns `{left, top}`, or null before the first measurement.
	 */
	function useAnchoredPosition(options) {
		const { open, anchorRef, panelRef, side = `bottom`, align = `start`, gap, margin } = options;
		const [position, setPosition] = react.useState(null);
		react.useLayoutEffect(() => {
			if (!open) {
				setPosition(null);
				return undefined;
			}
			const place = () => {
				const rect = anchorRef.current?.getBoundingClientRect();
				if (rect === undefined) return;
				const panel = panelRef.current;
				const width = panel?.offsetWidth ?? 0;
				const height = panel?.offsetHeight ?? 0;
				let left = align === `end` ? rect.right - width : rect.left;
				let top = side === `top` ? rect.top - gap - height : rect.bottom + gap;
				if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
				if (height > 0) top = Math.min(Math.max(top, overlayTopMargin(margin)), window.innerHeight - height - margin);
				setPosition({ left, top });
			};
			// The first run measures the panel in the same commit that opened
			// it, so the clamp uses real dimensions before anything paints.
			place();
			window.addEventListener(`scroll`, place, true);
			window.addEventListener(`resize`, place);
			const panel = panelRef.current;
			let observer = null;
			if (typeof ResizeObserver !== `undefined` && panel !== null) {
				observer = new ResizeObserver(place);
				observer.observe(panel);
			}
			return () => {
				observer?.disconnect();
				window.removeEventListener(`scroll`, place, true);
				window.removeEventListener(`resize`, place);
			};
		}, [open, anchorRef, panelRef, side, align, gap, margin]);
		return position;
	}

	/**
	 * Close an open popover when a pointerdown lands outside its root.
	 * @param root - element containing both the trigger and the open surface.
	 * @param open - whether the surface is showing; false detaches the listener.
	 * @param setOpen - state setter invoked with false on an outside pointerdown.
	 * @param portal - surface portaled outside the root that also counts as inside.
	 */
	function useDismissOnOutsidePointer(root, open, setOpen, portal) {
		react.useEffect(() => {
			if (!open) return undefined;
			const closeOutside = (event) => {
				if (
					event.target instanceof Node &&
					root.current?.contains(event.target) !== true &&
					portal?.current?.contains(event.target) !== true
				) {
					setOpen(false);
				}
			};
			document.addEventListener(`pointerdown`, closeOutside);
			return () => {
				document.removeEventListener(`pointerdown`, closeOutside);
			};
		}, [root, open, setOpen, portal]);
	}

	/**
	 * The information glyph: an outlined circle with a stem and a dot.
	 * @returns the svg element.
	 */
	function IconInfoOutlineRegular(props) {
		const { size = 16, className } = props ?? {};
		return h(
			`svg`,
			{
				width: size,
				height: size,
				className,
				viewBox: `0 0 16 16`,
				fill: `none`,
				xmlns: `http://www.w3.org/2000/svg`,
				'aria-hidden': `true`,
				strokeWidth: 1,
				stroke: `currentColor`,
			},
			h(`circle`, { cx: 8, cy: 8, r: 6.25 }),
			h(`path`, { d: `M8 7.4V11.4`, strokeLinecap: `round` }),
			h(`circle`, { cx: 8, cy: 4.9, r: 0.75, fill: `currentColor`, stroke: `none` }),
		);
	}

	const PANEL_MARGIN = 12;
	const PANEL_GAP = 8;
	const MEASURE_STYLE = { visibility: `hidden`, left: 0, top: 0 };

	/**
	 * Anchored popover state, mirroring the official useStatDialog.
	 * @returns open/setOpen/rootRef/panelRef/pos
	 */
	function useCostDialog() {
		const [open, setOpen] = react.useState(false);
		const rootRef = react.useRef(null);
		const panelRef = react.useRef(null);
		const pos = useAnchoredPosition({
			open,
			anchorRef: rootRef,
			panelRef,
			side: `top`,
			gap: PANEL_GAP,
			margin: PANEL_MARGIN,
		});
		useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
		react.useEffect(() => {
			if (!open) return undefined;
			const onKeyDown = (event) => {
				if (event.key === `Escape`) setOpen(false);
			};
			document.addEventListener(`keydown`, onKeyDown);
			return () => document.removeEventListener(`keydown`, onKeyDown);
		}, [open]);
		return { open, setOpen, rootRef, panelRef, pos };
	}

	/**
	 * Render one detail row, skipping absent values.
	 * @returns dt/dd pair or null.
	 */
	function row(label, value, key) {
		if (value === null || value === undefined || value === false) return null;
		return [h(`dt`, { key: key + `-k` }, label), h(`dd`, { key: key + `-v` }, value)];
	}

	/** Detail list shared by both cards. */
	function details(items, key) {
		const children = [];
		for (const item of items) {
			const cells = row(item[0], item[1], `r${children.length}`);
			if (cells !== null) children.push(cells[0], cells[1]);
		}
		return h(`dl`, { className: `gdcc_details`, key }, children);
	}

	/** The floating card shell. */
	function panel(props) {
		return reactDom.createPortal(
			h(`div`, {
				ref: props.panelRef,
				className: props.className ? `gdcc_panel ` + props.className : `gdcc_panel`,
				role: `dialog`,
				'aria-label': props.title,
				style: props.pos ?? MEASURE_STYLE,
				children: [
					h(`div`, { className: `gdcc_title`, key: `title` }, [
						h(`span`, { className: `gdcc_titleLabel`, key: `l` }, [
							h(props.icon, { key: `i` }),
							h(`span`, { key: `t` }, props.title),
						]),
						props.value === null || props.value === undefined
							? null
							: h(`span`, { className: `gdcc_titleValue`, key: `v` }, props.value),
					]),
					h(`div`, { className: `gdcc_titleRule`, key: `rule` }),
					react.Children.toArray(props.children),
				],
			}),
			document.body,
		);
	}

	/**
	 * Inline information button with a formula popover. Hovering opens the
	 * popover and leaving closes it; a click does not pin it. The popover
	 * ignores pointer events so it never steals the pointer from the surface
	 * that owns it.
	 */
	function Hint(props) {
		const [open, setOpen] = react.useState(false);
		const rootRef = react.useRef(null);
		const panelRef = react.useRef(null);
		const pos = useAnchoredPosition({
			open,
			anchorRef: rootRef,
			panelRef,
			side: `top`,
			gap: 6,
			margin: PANEL_MARGIN,
		});
		return h(
			`span`,
			{
				className: `gdcc_hintRoot`,
				ref: rootRef,
				onMouseEnter: () => setOpen(true),
				onMouseLeave: () => setOpen(false),
			},
			[
				h(
					`button`,
					{
						key: `b`,
						type: `button`,
						className: `gdcc_info`,
						'aria-label': props.label,
						'aria-haspopup': `dialog`,
						'aria-expanded': open,
					},
					h(IconInfoOutlineRegular, { key: `i` }),
				),
				open
					? panel({
							panelRef,
							pos,
							className: `gdcc_hintPanel`,
							icon: IconInfoOutlineRegular,
							title: props.title,
							value: null,
							children: props.children,
						})
					: null,
			],
		);
	}

	return { useCostDialog, panel, details, Hint, IconInfoOutlineRegular };
}