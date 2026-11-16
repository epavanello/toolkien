/**
 * Token estimates from character counts, for the context-savings figures. No tokenizer ships
 * with the app, and each model family tokenizes differently: 4 characters per token is the
 * usual rule of thumb. JSON schemas tokenize denser than prose (closer to 3), so the estimate
 * understates both sides of a comparison alike.
 */
export const CHARS_PER_TOKEN = 4;

export const estimateTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** `≈ 41.2K tokens`, `≈ 640 tokens` */
export const formatTokens = (tokens: number) => `≈ ${compact.format(tokens)} tokens`;

/** Context that a native client loads up front, against what Toolkien loads instead */
export type ContextSavings = {
	/** Estimated tokens of every tool definition loaded natively */
	native: number;
	/** Estimated tokens of Toolkien's six tools and its instructions */
	gateway: number;
	/** `native - gateway`, never below zero */
	saved: number;
	/** Share of the native context saved, 0–100, rounded */
	percent: number;
	/** Tools to add before Toolkien loads less than a native client; 0 once past it */
	toBreakEven: number;
};

/**
 * Compares the native and the Toolkien context. `toBreakEven` uses the average definition of the
 * tools counted so far; with no tools it stays 0 (nothing to compare against yet).
 */
export function contextSavings(input: {
	tools: number;
	nativeChars: number;
	gatewayChars: number;
}): ContextSavings {
	const native = estimateTokens(input.nativeChars);
	const gateway = estimateTokens(input.gatewayChars);
	const saved = Math.max(native - gateway, 0);
	const perTool = input.tools > 0 ? input.nativeChars / input.tools : 0;
	const toBreakEven =
		saved > 0 || perTool === 0
			? 0
			: Math.max(Math.ceil(input.gatewayChars / perTool) - input.tools, 1);
	return {
		native,
		gateway,
		saved,
		percent: native > 0 ? Math.round((saved / native) * 100) : 0,
		toBreakEven
	};
}
