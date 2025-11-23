

export function extractFromFrontmatter(frontmatter: Record<string, unknown>, key: string): unknown {
    const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
        const arrayKey = arrayMatch[1];
        const index = parseInt(arrayMatch[2]);
        const arrayValue = frontmatter[arrayKey];
        if (Array.isArray(arrayValue) && index >= 0 && index < arrayValue.length) {
            return arrayValue[index];
        }
        return undefined;
    }

    return frontmatter[key];
}