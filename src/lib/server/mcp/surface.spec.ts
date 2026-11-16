import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './server.ts';
import { gatewayContextChars, gatewayContextSize, gatewayDefinitions } from './surface.ts';
import { fakeDeps } from './testing.ts';
import { MCP_TOOL_NAMES } from './types.ts';

describe('gateway context size', () => {
	it('reads the six definitions the server registers, with JSON input schemas', () => {
		const definitions = gatewayDefinitions(fakeDeps());
		expect(definitions.map((d) => d.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
		const execute = definitions.find((d) => d.name === 'execute')!;
		expect(execute.description).toContain('sandbox');
		expect(execute.input_schema).toMatchObject({
			type: 'object',
			properties: { code: { type: 'string' } }
		});
	});

	it('counts the definitions and the instructions', () => {
		const deps = fakeDeps();
		expect(gatewayContextChars(deps)).toBe(
			JSON.stringify(gatewayDefinitions(deps)).length + INSTRUCTIONS.length
		);
	});

	it('sizes the gateway without any real service', () => {
		expect(gatewayContextSize()).toBe(gatewayContextChars(fakeDeps()));
	});
});
