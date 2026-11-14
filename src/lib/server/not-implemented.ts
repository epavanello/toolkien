/** Thrown by contract stubs until the owning vertical implements them */
export class NotImplementedError extends Error {
	constructor(what: string) {
		super(`Not implemented: ${what}`);
		this.name = 'NotImplementedError';
	}
}

export const notImplemented = (what: string): never => {
	throw new NotImplementedError(what);
};
