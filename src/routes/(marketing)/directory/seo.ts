import type { ItemList, WithContext } from 'schema-dts';
import type { DirectoryEntry } from '#lib/server/connectors/types.ts';

/** JSON-LD of the public directory: an `ItemList` of the servers (name, description, docs) */
export function directoryJsonLd(
	origin: string,
	name: string,
	description: string,
	servers: Pick<DirectoryEntry, 'id' | 'name' | 'description' | 'homepage'>[]
): WithContext<ItemList> {
	return {
		'@context': 'https://schema.org',
		'@type': 'ItemList',
		name,
		description,
		url: `${origin}/directory`,
		numberOfItems: servers.length,
		itemListElement: servers.map((server, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			item: {
				'@type': 'SoftwareApplication',
				name: server.name,
				description: server.description,
				applicationCategory: 'DeveloperApplication',
				url: server.homepage ?? `${origin}/directory`
			}
		}))
	};
}
