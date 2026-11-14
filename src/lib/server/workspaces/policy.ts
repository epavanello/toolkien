import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { workspacePolicy } from '#lib/server/db/schema/index.ts';
import { assertCompanyAdminAction, hasRole } from './core.ts';
import type {
	ConnectorPolicyInput,
	PolicyCheck,
	PolicyInput,
	WorkspaceActor,
	WorkspacePolicy,
	WorkspaceRole,
	WorkspacesService
} from './types.ts';

/** Policy of a workspace without a row (personal workspaces, legacy rows): nothing restricted */
export const DEFAULT_POLICY: PolicyInput = {
	allowedServers: null,
	allowPersonalConnectors: true,
	allowFreeUrls: true,
	permissionFloor: null
};

export const getPolicy: WorkspacesService['getPolicy'] = async (workspaceId) => {
	const [row] = await db
		.select()
		.from(workspacePolicy)
		.where(eq(workspacePolicy.workspaceId, workspaceId))
		.limit(1);
	if (!row) return { workspaceId, ...DEFAULT_POLICY };
	return {
		workspaceId,
		allowedServers: row.allowedServers ?? null,
		allowPersonalConnectors: row.allowPersonalConnectors,
		allowFreeUrls: row.allowFreeUrls,
		permissionFloor: row.permissionFloor ?? null
	};
};

const DIRECTORY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Normalises the allowed-servers list: directory ids (`github`) stay as they are, URLs are
 * reduced to their `https` origin. Throws on anything else. `null` = every server allowed.
 */
export function normalizeAllowedServers(entries: string[] | null): string[] | null {
	if (entries === null) return null;
	const out = new Set<string>();
	for (const raw of entries) {
		const entry = raw.trim();
		if (!entry) continue;
		if (DIRECTORY_ID.test(entry)) {
			out.add(entry);
			continue;
		}
		let url: URL;
		try {
			url = new URL(entry);
		} catch {
			error(400, `"${entry.slice(0, 80)}" is neither a directory id nor a URL.`, {
				code: 'INVALID_INPUT'
			});
		}
		if (url.protocol !== 'https:') {
			error(400, 'Allowed server URLs must use https.', { code: 'INVALID_INPUT' });
		}
		out.add(url.origin);
	}
	return [...out].sort();
}

/** Pure: whether a server (directory id or URL) is in the allowed list */
export function isServerAllowed(
	allowedServers: string[] | null,
	source: ConnectorPolicyInput['source']
): boolean {
	if (allowedServers === null) return true;
	if (source.type === 'directory') return allowedServers.includes(source.directoryId);
	try {
		return allowedServers.includes(new URL(source.url).origin);
	} catch {
		return false;
	}
}

/**
 * Pure policy check for adding a connector (enforced by the connectors module on add):
 * - members may only add connectors for themselves, and only if personal connectors are allowed;
 * - free URLs need `allowFreeUrls`, for everyone (admins change the policy if they need one);
 * - the server must be in `allowedServers` when the list is set, for everyone.
 */
export function checkConnectorPolicy(
	policy: Pick<WorkspacePolicy, 'allowedServers' | 'allowPersonalConnectors' | 'allowFreeUrls'>,
	role: WorkspaceRole,
	input: ConnectorPolicyInput
): PolicyCheck {
	const isAdmin = hasRole(role, 'admin');
	if (!isAdmin && !input.onlyForMe) {
		return { allowed: false, reason: 'Only admins can add connectors for the whole workspace.' };
	}
	if (!isAdmin && !policy.allowPersonalConnectors) {
		return { allowed: false, reason: 'Your admin does not allow personal connectors.' };
	}
	if (input.source.type === 'url' && !policy.allowFreeUrls) {
		return { allowed: false, reason: 'This workspace only allows servers from the directory.' };
	}
	if (!isServerAllowed(policy.allowedServers, input.source)) {
		return { allowed: false, reason: 'This server is not in the list allowed by your admin.' };
	}
	return { allowed: true };
}

/** Admins of company workspaces set the policy; it only ever restricts members */
export async function updatePolicy(actor: WorkspaceActor, input: PolicyInput) {
	await assertCompanyAdminAction(actor);
	const values = {
		allowedServers: normalizeAllowedServers(input.allowedServers),
		allowPersonalConnectors: input.allowPersonalConnectors,
		allowFreeUrls: input.allowFreeUrls,
		permissionFloor: input.permissionFloor,
		updatedBy: actor.userId
	};
	await db
		.insert(workspacePolicy)
		.values({ workspaceId: actor.workspaceId, ...values })
		.onConflictDoUpdate({ target: workspacePolicy.workspaceId, set: values });
	await record({
		type: 'workspace.policy_changed',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: {
			allowedServers: values.allowedServers === null ? null : values.allowedServers.length,
			allowPersonalConnectors: values.allowPersonalConnectors,
			allowFreeUrls: values.allowFreeUrls,
			permissionFloor: values.permissionFloor
		}
	});
	return getPolicy(actor.workspaceId);
}
