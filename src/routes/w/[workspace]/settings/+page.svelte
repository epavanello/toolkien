<script lang="ts">
	import { KeyValueList, Page, Section } from '#lib/components/app/index.ts';
	import type { PageProps } from './$types';

	// Placeholder (owner: org-ops)
	let { data }: PageProps = $props();
</script>

<Page title="Settings" variant="form">
	<Section title="Workspace">
		<KeyValueList
			items={[
				{ label: 'Name', value: data.workspace.name },
				{ label: 'Slug', value: data.workspace.slug, type: 'mono', copy: true },
				{ label: 'Kind', value: data.workspace.kind },
				{ label: 'Your role', value: data.workspace.role }
			]}
		/>
	</Section>
</Page>
