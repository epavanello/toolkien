import { record } from '#lib/server/audit/index.ts';
import { callTool, describeTools, resolveTool } from '#lib/server/connectors/index.ts';
import { decryptJsonForWorkspace, encryptJsonForWorkspace } from '#lib/server/crypto/index.ts';
import { db } from '#lib/server/db/index.ts';
import { assertNotSuspended, getLimits } from '#lib/server/limits/index.ts';
import { getEffectiveLevel } from '#lib/server/permissions/index.ts';
import { createBridge } from './service.ts';
import type { HandleToolCall } from './types.ts';

export type * from './types.ts';
export { argumentsPreview, hashArgs, stableStringify } from './content.ts';

export const handleToolCall: HandleToolCall = createBridge({
	db,
	connectors: { resolveTool, callTool, describeTools },
	permissions: { getEffectiveLevel },
	crypto: { encryptJsonForWorkspace, decryptJsonForWorkspace },
	audit: { record },
	limits: { getLimits, assertNotSuspended }
});
