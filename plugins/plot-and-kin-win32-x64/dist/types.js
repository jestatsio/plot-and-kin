export class PKError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PKError';
    }
}
export function requireText(value, label, max = 10000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw new PKError('INVALID_INPUT', `${label} must be nonempty text of at most ${max} characters`);
    return value.trim();
}
//# sourceMappingURL=types.js.map