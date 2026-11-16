import type { ConnectorSummary } from '#lib/server/connectors/types.ts';
import type { ToolPermission } from '#lib/server/permissions/types.ts';

export type ConnectorInfo = Pick<
	ConnectorSummary,
	'id' | 'name' | 'displayName' | 'namespace' | 'icon' | 'unverified'
>;

/** The tools of one connector on the permissions page */
export type ConnectorSection = ConnectorInfo & { tools: ToolPermission[] };

/**
 * Tools grouped by connector, connectors in name order, tools in their given order. A tool whose
 * connector is missing from `connectors` (listed between two loads) gets a section from its
 * own row, so no tool is ever hidden.
 */
export function connectorSections(
	tools: ToolPermission[],
	connectors: ConnectorInfo[]
): ConnectorSection[] {
	const known = new Map(connectors.map((connector) => [connector.id, connector]));
	const sections = new Map<string, ConnectorSection>();
	for (const tool of tools) {
		let section = sections.get(tool.connectorId);
		if (!section) {
			const info = known.get(tool.connectorId) ?? {
				id: tool.connectorId,
				name: tool.connectorName,
				displayName: tool.connectorName,
				namespace: tool.path.split('.')[0],
				icon: null,
				unverified: tool.unverified
			};
			section = { ...info, tools: [] };
			sections.set(tool.connectorId, section);
		}
		section.tools.push(tool);
	}
	return [...sections.values()].sort(
		(a, b) => a.displayName.localeCompare(b.displayName) || a.namespace.localeCompare(b.namespace)
	);
}

/** Connector sections start open when there are few tools; a search or filter opens them all */
export const OPEN_BY_DEFAULT_MAX_TOOLS = 40;
