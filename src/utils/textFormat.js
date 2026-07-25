export function toTitleCase(name) {
    if (!name || typeof name !== 'string') return name;
    return name
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .split(' ')
        .map((word) =>
            word
                .split('-')
                .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
                .join('-')
        )
        .join(' ');
}