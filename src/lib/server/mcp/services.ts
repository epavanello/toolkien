/** The real implementations behind `McpDeps` (production wiring) */
import { ORIGIN } from '$app/env/private';
import * as audit from '#lib/server/audit/index.ts';
import * as connectors from '#lib/server/connectors/index.ts';
import * as executions from '#lib/server/executions/index.ts';
import * as permissions from '#lib/server/permissions/index.ts';
import * as workspaces from '#lib/server/workspaces/index.ts';
import type { McpDeps } from './deps.ts';

export const services: McpDeps = {
	workspaces,
	connectors,
	permissions,
	executions,
	audit,
	origin: ORIGIN
};
