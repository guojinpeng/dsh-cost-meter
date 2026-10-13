export function createFormControls(react) {
	const h = react.createElement;
	/** One labelled row. */
	function field(label, control, key) {
		// `control` is always an element; give it a key of its own so React
		// does not warn about the keyless child of this two-item array.
		const value = control === null || control === undefined ? null : react.cloneElement(control, { key: `v` });
		return h(`div`, { className: `gdcc_field`, key }, [
			h(`span`, { className: `gdcc_fieldLabel`, key: `l` }, label),
			value,
		]);
	}

	/** A number input bound to the draft. */
	function numberInput(value, onChange, key) {
		return h(`input`, {
			key,
			className: `gdcc_input`,
			type: `number`,
			step: `any`,
			value: String(value ?? ``),
			onChange: (event) => onChange(event.target.value),
		});
	}

	return { field, numberInput };
}
