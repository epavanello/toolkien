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
	import { tv } from 'tailwind-variants';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CodeBlock from './code-block.svelte';
	import ToolPath from './tool-path.svelte';

	/**
	 * One upstream tool as an agent sees it: path, annotation hints, one-line summary, reviewer
	 * note, change warnings and the generated TypeScript signature. Rows of a list inside a
	 * `Section variant="flush"`: collapsed to path, hints and summary; the details (full
	 * signature) open on demand. Native `<details>`, keyboard accessible.
	 */
	let { tool }: { tool: ToolDefinitionItem } = $props();

	const styles = tv({
		slots: {
			root: 'group border-b last:border-b-0',
			summary:
				'flex cursor-pointer list-none gap-2 px-4 py-2.5 outline-none select-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden',
			chevron:
				'mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90',
			header: 'flex min-w-0 flex-wrap items-center gap-1.5',
			body: 'flex flex-col gap-2 px-4 pb-3 ps-10',
			text: 'text-sm text-muted-foreground',
			warning: 'text-sm text-warning'
		},
		variants: { removed: { true: { root: 'opacity-60' } } }
	});
	const s = $derived(styles({ removed: !!tool.removed }));

	const hints = $derived(
		[
			tool.annotations?.readOnlyHint === true && {
				label: 'Read only',
				variant: 'success' as const
			},
			tool.annotations?.destructiveHint === true &&
				tool.annotations.readOnlyHint !== true && {
					label: 'Destructive',
					variant: 'destructive' as const
				},
			tool.annotations?.idempotentHint === true && {
				label: 'Idempotent',
				variant: 'outline' as const
			},
			tool.annotations?.openWorldHint === true && {
				label: 'Open world',
				variant: 'outline' as const
			},
			!tool.annotations && {
				label: 'No annotations · treated as write',
				variant: 'outline' as const
			}
		].filter((hint) => !!hint)
	);
</script>

<details class={s.root()} data-slot="tool-definition">
	<summary class={s.summary()}>
		<ChevronRight class={s.chevron()} aria-hidden="true" />
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class={s.header()}>
				<!-- Copying the path must not toggle the row -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<span class="min-w-0" onclick={(event) => event.preventDefault()}>
					<ToolPath path={tool.path} unverified={tool.unverified} copy />
				</span>
				{#each hints as hint (hint.label)}
					<Badge variant={hint.variant} class="rounded-sm">{hint.label}</Badge>
				{/each}
				<Badge variant="outline" class="rounded-sm">v{tool.version}</Badge>
				{#if tool.removed}<Badge variant="secondary" class="rounded-sm">Removed upstream</Badge
					>{/if}
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
		{#if tool.note}<p class={s.text()}>Reviewer note: {tool.note}</p>{/if}
		<CodeBlock code={tool.declaration} />
	</div>
</details>
