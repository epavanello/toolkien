import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { createPermissionsService } from './service.ts';

export * from './types.ts';
export { defaultLevel, isReadOnly, resolveEffectiveLevel, satisfiesFloor } from './resolve.ts';

const service = createPermissionsService({ db, audit: { record } });

export const getEffectiveLevel = service.getEffectiveLevel;
export const getEffectiveLevels = service.getEffectiveLevels;
export const setLevel = service.setLevel;
export const visibleToolIds = service.visibleToolIds;
export const listToolPermissions = service.listToolPermissions;
