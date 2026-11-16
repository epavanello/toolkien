<script lang="ts" module>
	import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';

	export type ToolDefinitionItem = {
		path: string;
		summary: string;
		/** `.d.ts` declaration (shown in mono) */
		declaration: string;
		annotations: ToolAnnotations | null;
		version: number;
		unverified?: boolean;
		/** The description changed in the latest version (tool-poisoning warning) */
		descriptionChanged?: boolean;
		removed?: boolean;
		/** Reviewer note from the curated directory */
		note?: string | null;
	};
</script>

<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CodeBlock from './code-block.svelte';
	import ToolPath from './tool-path.svelte';

	/**
	 * One upstream tool as an agent sees it. Collapsed: path and one-line summary (the list groups
	 * rows by read/write/destructive, see `ToolGroupList`). Open: full summary, remaining hints,
	 * version, reviewer note and the generated TypeScript signature. Native `<details>`.
	 * `aside` sits at the right of the path (e.g. the permission controls of `ToolPermissionRow`);
	 * clicks in it do not toggle the row.
	 */
	let { tool, aside }: { tool: ToolDefinitionItem; aside?: Snippet } = $props();

	const styles = tv({
		slots: {
			root: 'group border-b last:border-b-0',
			summary:
				'flex cursor-pointer list-none gap-2 px-4 py-2.5 outline-none select-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden',
			chevron:
				'mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90',
			header: 'flex min-w-0 flex-wrap items-center gap-1.5',
			aside: 'ms-auto flex flex-wrap items-center gap-2',
			body: 'flex flex-col gap-2 px-4 pb-3 ps-10',
			text: 'text-sm text-muted-foreground',
			meta: 'text-xs text-muted-foreground',
			warning: 'text-sm text-warning'
		},
		variants: { removed: { true: { root: 'opacity-60' } } }
	});
	const s = $derived(styles({ removed: !!tool.removed }));

	const meta = $derived(
		[
			`Version ${tool.version}`,
			tool.annotations?.idempotentHint === true && 'Idempotent',
			tool.annotations?.openWorldHint === true && 'Talks to external systems (open world)'
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<details class={s.root()} data-slot="tool-definition">
	<summary class={s.summary()}>
		<ChevronRight class={s.chevron()} aria-hidden="true" />
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class={s.header()}>
				<!-- Copying the path must not toggle the row -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<span class="flex min-w-0" onclick={(event) => event.preventDefault()}>
					<ToolPath path={tool.path} unverified={tool.unverified} copy />
				</span>
				{#if tool.removed}<Badge variant="secondary" class="rounded-sm">Removed upstream</Badge
					>{/if}
				{#if aside}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<span class={s.aside()} onclick={(event) => event.preventDefault()}>
						{@render aside()}
					</span>
				{/if}
			</div>
			<p class="{s.text()} line-clamp-1 group-open:line-clamp-none">{tool.summary}</p>
			{#if tool.descriptionChanged}
				<p class={s.warning()} role="status">
					The description changed in the latest version. Review it before trusting this tool.
				</p>
			{/if}
		</div>
	</summary>
	<div class={s.body()}>
		<p class={s.meta()}>{meta}</p>
		{#if tool.note}<p class={s.text()}>Reviewer note: {tool.note}</p>{/if}
		<CodeBlock code={tool.declaration} />
	</div>
</details>
