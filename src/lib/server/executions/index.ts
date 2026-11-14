import { notImplemented } from '#lib/server/not-implemented.ts';
import type { ExecutionsService } from './types.ts';

export * from './types.ts';

export const start: ExecutionsService['start'] = async () => notImplemented('executions.start');
export const status: ExecutionsService['status'] = async () => notImplemented('executions.status');
export const cancel: ExecutionsService['cancel'] = async () => notImplemented('executions.cancel');
export const listPendingApprovals: ExecutionsService['listPendingApprovals'] = async () => [];
export const decideApproval: ExecutionsService['decideApproval'] = async () =>
	notImplemented('executions.decideApproval');
export const expireStale: ExecutionsService['expireStale'] = async () => ({
	approvals: 0,
	executions: 0
});
