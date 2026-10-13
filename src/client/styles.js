import { PACKAGE_ID, PLUGIN_ID } from '../identity.js';
import CSS from './styles.css';

export function installStyles() {
	const CSS_TAG = `${PLUGIN_ID}/cost-chip.module.css`;
	if (
		typeof document !== `undefined` &&
		document.querySelector(`style[data-plugin-css=` + JSON.stringify(CSS_TAG) + `]`) === null
	) {
		const tag = document.createElement(`style`);
		tag.dataset.plugin = PACKAGE_ID;
		tag.dataset.pluginCss = CSS_TAG;
		tag.textContent = CSS;
		document.head.appendChild(tag);
	}
}
