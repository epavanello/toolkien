import { notImplemented } from '#lib/server/not-implemented.ts';
import type { PermissionsService } from './types.ts';

export * from './types.ts';

export const defaultLevel: PermissionsService['defaultLevel'] = () =>
	notImplemented('permissions.defaultLevel');
export const getEffectiveLevel: PermissionsService['getEffectiveLevel'] = async () =>
	notImplemented('permissions.getEffectiveLevel');
export const getEffectiveLevels: PermissionsService['getEffectiveLevels'] = async () =>
	notImplemented('permissions.getEffectiveLevels');
export const setLevel: PermissionsService['setLevel'] = async () =>
	notImplemented('permissions.setLevel');
