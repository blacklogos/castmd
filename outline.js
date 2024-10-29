document.getElementById('extractBtn').addEventListener('click', extractOutline);
document.getElementById('copyBtn').addEventListener('click', copyOutline);

function extractOutline() {
    const input = document.getElementById('input').value;
    const lines = input.split('\n');
    const headingRegex = /^(#{1,6})\s+(.+)$/;
    const outlineLines = lines.filter(line => headingRegex.test(line));
    const output = outlineLines.join('\n');
    document.getElementById('output').textContent = output;
}

function copyOutline() {
    const output = document.getElementById('output').textContent;
    if (output) {
        navigator.clipboard.writeText(output)
            .then(() => alert('Outline copied to clipboard!'))
            .catch(err => console.error('Failed to copy: ', err));
    } else {
        alert('No outline to copy. Extract an outline first.');
    }
}