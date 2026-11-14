/**
 * The services the MCP tools call, only through their contracts. Tool modules receive these as
 * arguments (never import implementations), so unit tests pass fakes; `services.ts` wires the
 * real modules.
 */
import type { AuditService } from '#lib/server/audit/types.ts';
import type { ConnectorsService } from '#lib/server/connectors/types.ts';
import type { ExecutionsService } from '#lib/server/executions/types.ts';
import type { PermissionsService } from '#lib/server/permissions/types.ts';
import type { WorkspacesService } from '#lib/server/workspaces/types.ts';

export type McpDeps = {
	workspaces: Pick<
		WorkspacesService,
		'listForUser' | 'getById' | 'getActiveWorkspace' | 'setActiveWorkspace'
	>;
	connectors: Pick<ConnectorsService, 'searchTools' | 'describeTools' | 'resolveTool'>;
	permissions: Pick<PermissionsService, 'getEffectiveLevels'>;
	executions: Pick<ExecutionsService, 'start' | 'status' | 'answerApproval'>;
	audit: Pick<AuditService, 'record'>;
	/** Public origin, for the confirmation links (`${origin}/consent?switch=…`) */
	origin: string;
};
