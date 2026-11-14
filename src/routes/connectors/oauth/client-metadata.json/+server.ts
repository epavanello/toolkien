import { json } from '@sveltejs/kit';
import { clientMetadataDocument } from '#lib/server/connectors/index.ts';
import type { RequestHandler } from './$types';

/**
 * Client ID Metadata Document of Toolkien as an OAuth client of upstream MCP servers: its URL
 * is the `client_id` when the upstream authorization server supports CIMD (https origins).
 */
export const GET: RequestHandler = () =>
	json(clientMetadataDocument(), { headers: { 'cache-control': 'public, max-age=3600' } });
