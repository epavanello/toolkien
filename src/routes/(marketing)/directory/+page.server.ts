import { listDirectory } from '#lib/server/connectors/index.ts';
import type { PageServerLoad } from './$types';

/** The public directory: the same entries as the in-app page (all public data from `directory/`) */
export const load: PageServerLoad = () => ({ servers: listDirectory() });
