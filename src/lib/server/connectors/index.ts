import { directoryShowcase, getDirectoryEntry, listDirectoryEntries } from './directory.ts';
import * as discovery from './discovery.ts';
import { abandonUpstreamOAuth, clientMetadataDocument, purgeExpiredFlows } from './oauth.ts';
import * as service from './service.ts';
import type { ConnectorsService } from './types.ts';

export type * from './types.ts';
export { toScriptValue } from './upstream.ts';
export { detectAuth, type AuthDetection } from './detect.ts';
/** Callback helpers for `src/routes/connectors/oauth/**` (not part of the service contract) */
export { abandonUpstreamOAuth as abandonOAuth, clientMetadataDocument };
export { handleOAuthCallback, OAuthCallbackError, withOAuthResult } from './callback.ts';
/** Stored favicon of a free-URL connector, for `src/routes/connectors/icon/[id]` */
export { connectorIcons, readConnectorIcon } from './icon.ts';
/** Public directory pages (`/directory`, the landing showcase) */
export { directoryShowcase, getDirectoryEntry };
/** Jobs `connectors.oauth_flows` and `connectors.resync` (registered in `jobs/builtin.ts`) */
export { purgeExpiredFlows };
export { resyncStaleConnectors } from './resync.ts';

export const listDirectory: ConnectorsService['listDirectory'] = listDirectoryEntries;
export const list: ConnectorsService['list'] = service.list;
export const get: ConnectorsService['get'] = service.get;
export const add: ConnectorsService['add'] = service.add;
export const addAndConnect: ConnectorsService['addAndConnect'] = service.addAndConnect;
export const remove: ConnectorsService['remove'] = service.remove;
export const rename: ConnectorsService['rename'] = service.rename;
export const disconnect: ConnectorsService['disconnect'] = service.disconnect;
export const revokeUserCredentials: ConnectorsService['revokeUserCredentials'] =
	service.revokeUserCredentials;
export const startOAuth: ConnectorsService['startOAuth'] = service.startOAuth;
export const completeOAuth: ConnectorsService['completeOAuth'] = service.completeOAuth;
export const setToken: ConnectorsService['setToken'] = service.setToken;
export const syncTools: ConnectorsService['syncTools'] = service.syncTools;
export const acknowledgeChanges: ConnectorsService['acknowledgeChanges'] =
	service.acknowledgeChanges;
export const searchTools: ConnectorsService['searchTools'] = discovery.searchTools;
export const describeTools: ConnectorsService['describeTools'] = discovery.describeTools;
export const declarationsFor: ConnectorsService['declarationsFor'] = discovery.declarationsFor;
export const toolFootprint: ConnectorsService['toolFootprint'] = discovery.toolFootprint;
export const resolveTool: ConnectorsService['resolveTool'] = discovery.resolveTool;
export const callTool: ConnectorsService['callTool'] = service.callTool;
