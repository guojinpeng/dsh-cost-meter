import { PACKAGE_ID } from './identity.js';
import { createClientPlugin } from './client/plugin.js';

window.__ModuleLoader__.load({
	id: PACKAGE_ID,
	factory: (load) => createClientPlugin(load('react'), load('react-dom')),
});
