function collectFormData(form) {
    const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image']);

    function addValue(obj, key, value) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
            obj[key].push(value);
        } else {
            obj[key] = value;
        }
    }

    function collect(container) {
        const result = {};
        function walk(node) {
            for (const child of node.children) {
                if (child.tagName === 'FIELDSET') {
                    const name = child.getAttribute('name');
                    if (name) {
                        addValue(result, name, collect(child));
                    } else {
                        walk(child);
                    }
                } else if (child.matches('input, textarea, select')) {
                    const name = child.getAttribute('name');
                    if (name && !SKIP_TYPES.has(child.type)) {
                        if ((child.type === 'checkbox' || child.type === 'radio') && !child.checked) continue;
                        if (child.type === 'select-multiple') {
                            for (const opt of child.selectedOptions) addValue(result, name, opt.value);
                        } else {
                            addValue(result, name, child.value);
                        }
                    }
                } else {
                    walk(child);
                }
            }
        }
        walk(container);
        return result;
    }

    const formName = form.getAttribute('name') || form.id || 'form';
    return { [formName]: collect(form) };
}

// Register our collector so the preload uses the fieldset-aware version
//window.altpdf.setGetFormData(function() {
//    return collectFormData(document.querySelector('form'));
//});

// Submit
document.getElementById('submit').addEventListener('click', async function() {
    await window.altpdf.saveFile();
});

// Live range value display
document.querySelectorAll('input[type=range]').forEach(function(input) {
    const output = document.getElementById(input.name + '_val');
    if (output) {
        output.value = input.value;
        input.addEventListener('input', function() { output.value = input.value; });
    }
});