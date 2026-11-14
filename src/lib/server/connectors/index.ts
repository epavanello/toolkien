import { notImplemented } from '#lib/server/not-implemented.ts';
import type { ConnectorsService } from './types.ts';

export type * from './types.ts';

export const listDirectory: ConnectorsService['listDirectory'] = () => [];
export const list: ConnectorsService['list'] = async () => [];
export const add: ConnectorsService['add'] = async () => notImplemented('connectors.add');
export const remove: ConnectorsService['remove'] = async () => notImplemented('connectors.remove');
export const startOAuth: ConnectorsService['startOAuth'] = async () =>
	notImplemented('connectors.startOAuth');
export const completeOAuth: ConnectorsService['completeOAuth'] = async () =>
	notImplemented('connectors.completeOAuth');
export const setToken: ConnectorsService['setToken'] = async () =>
	notImplemented('connectors.setToken');
export const syncTools: ConnectorsService['syncTools'] = async () =>
	notImplemented('connectors.syncTools');
export const searchTools: ConnectorsService['searchTools'] = async () => [];
export const describeTools: ConnectorsService['describeTools'] = async () => [];
export const declarationsFor: ConnectorsService['declarationsFor'] = async () => '';
export const resolveTool: ConnectorsService['resolveTool'] = async () => null;
export const callTool: ConnectorsService['callTool'] = async () =>
	notImplemented('connectors.callTool');
