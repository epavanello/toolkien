/**
 * What Toolkien itself puts in a client's context up front: its six tool definitions (as the
 * model receives them: name, description, input schema) and the server instructions. Read from
 * the same registrations the server uses, so the figure follows every change to a description.
 */
import { z } from 'zod';
import type { McpDeps } from './deps.ts';
import type { McpServerLike, ToolEnvResolver } from './register.ts';
import { INSTRUCTIONS } from './server.ts';
import { registerDiscoveryTools } from './tools/discovery.ts';
import { registerExecutionTools } from './tools/executions.ts';
import { registerWorkspaceTools } from './tools/workspaces.ts';

export type GatewayDefinition = {
	name: string;
	description: string;
	input_schema: unknown;
};

/** The six definitions, without serving anything: handlers are recorded, never called */
export function gatewayDefinitions(deps: McpDeps): GatewayDefinition[] {
	const definitions: GatewayDefinition[] = [];
	const recorder: McpServerLike = {
		registerTool(name, config) {
			definitions.push({
				name,
				description: config.description,
				input_schema: config.inputSchema
					? z.toJSONSchema(config.inputSchema, { io: 'input', unrepresentable: 'any' })
					: { type: 'object' }
			});
		}
	};
	const resolveEnv: ToolEnvResolver = () => {
		throw new Error('Definitions only: tools are not callable here.');
	};
	registerWorkspaceTools(recorder, resolveEnv, deps);
	registerDiscoveryTools(recorder, resolveEnv, deps);
	registerExecutionTools(recorder, resolveEnv, deps);
	return definitions;
}

/** Characters of the six definitions (JSON) plus the instructions */
export const gatewayContextChars = (deps: McpDeps) =>
	JSON.stringify(gatewayDefinitions(deps)).length + INSTRUCTIONS.length;

const unused = (): never => {
	throw new Error('Definitions only: no service is called while registering.');
};

/**
 * Services for registering only: descriptions never read them, handlers are never run. Keeps
 * this module free of the real services (auth, email, …), so a page can import it.
 */
const definitionsOnly: McpDeps = {
	origin: '',
	workspaces: {
		listForUser: unused,
		getById: unused,
		getActiveWorkspace: unused,
		setActiveWorkspace: unused
	},
	connectors: { searchTools: unused, describeTools: unused, resolveTool: unused },
	permissions: { getEffectiveLevels: unused },
	executions: {
		start: unused,
		status: unused,
		answerApproval: unused,
		listPendingApprovals: unused
	},
	audit: { record: unused }
};

let gatewayChars: number | undefined;

/**
 * Characters Toolkien loads into every client up front, for the context-savings estimate. The
 * descriptions are static: computed once per process.
 */
export const gatewayContextSize = () => (gatewayChars ??= gatewayContextChars(definitionsOnly));
