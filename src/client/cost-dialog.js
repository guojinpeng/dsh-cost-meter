export function createCostDialog(react, reactDom) {
	const h = react.createElement;
	// This plugin ships no dependency on a DSH Client package. A separate
	// npm plugin may not runtime-import one: its bundle is built outside the
	// Harness module table, so there is no supplier for such a request. The
	// two hooks and the icon below are therefore copied from
	// `@deepseek-ai/dsh-client-ui-primitives` (v0.2.1-alpha.2,
	// src/useAnchoredPosition.ts, src/useDismissOnOutsidePointer.ts, and
	// src/icons/index.tsx). Inlined copies stay local to this plugin; an
	// upstream primitive change does not reach them.

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
	 * The official gauge glyph (IconGaugeOutline at the regular 1px weight).
	 * @returns the svg element.
	 */
	function IconGaugeOutlineRegular(props) {
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
			},
			h(`path`, {
				d: `M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096`,
				stroke: `currentColor`,
			}),
			h(`path`, { d: `M8 8.49994L11.6114 4.88855`, stroke: `currentColor` }),
			h(`path`, {
				d: `M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z`,
				fill: `currentColor`,
			}),
		);
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
				className: `gdcc_panel`,
				role: `dialog`,
				'aria-label': props.title,
				style: props.pos ?? MEASURE_STYLE,
				children: [
					h(`div`, { className: `gdcc_title`, key: `title` }, [
						h(`span`, { className: `gdcc_titleLabel`, key: `l` }, [
							h(props.icon, { key: `i` }),
							h(`span`, { key: `t` }, props.title),
						]),
						h(`span`, { className: `gdcc_titleValue`, key: `v` }, props.value),
					]),
					h(`div`, { className: `gdcc_titleRule`, key: `rule` }),
					react.Children.toArray(props.children),
				],
			}),
			document.body,
		);
	}

	return { useCostDialog, panel, details, IconGaugeOutlineRegular, IconInfoOutlineRegular };
}