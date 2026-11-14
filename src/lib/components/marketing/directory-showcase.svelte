<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Plus from '@lucide/svelte/icons/plus';
	import { resolve } from '$app/paths';
	import ServiceLogo from '#lib/components/app/service-logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import MarketingSection from './marketing-section.svelte';

	/**
	 * Landing band inviting visitors to add a tool from the directory: the popular servers as
	 * logo tiles (each goes to "Add to Toolkien": sign in, then the server is added and its
	 * sign-in starts) and a link to the whole directory. Data from `directoryShowcase()`
	 * (`#lib/server/connectors/index.ts`).
	 */
	type Props = {
		servers: { id: string; name: string; icon?: string; tagline?: string }[];
		/** Number of servers in the directory */
		total: number;
		title?: string;
		description?: string;
	};

	let {
		servers,
		total,
		title = 'Pick a tool to connect',
		description = `${total} popular remote MCP servers, checked and preconfigured. Pick one, sign in, and every AI agent you use can work with it through Toolkien.`
	}: Props = $props();
</script>

<MarketingSection id="directory" eyebrow="Directory" {title} {description}>
	<ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Popular tools">
		{#each servers as server (server.id)}
			<li class="min-w-0">
				<a
					href={resolve('/(marketing)/directory/[id]/add', { id: server.id })}
					class="group flex h-full items-center gap-3 rounded-xl border bg-card p-3 transition-colors outline-none hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
					aria-label={`Add ${server.name} to Toolkien`}
				>
					<ServiceLogo name={server.name} src={server.icon} size="lg" />
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="truncate text-sm font-semibold">{server.name}</span>
						{#if server.tagline}
							<span class="hidden truncate text-xs text-muted-foreground sm:block"
								>{server.tagline}</span
							>
						{/if}
					</span>
					<Plus
						class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
						aria-hidden="true"
					/>
				</a>
			</li>
		{/each}
	</ul>
	<div class="flex flex-wrap items-center gap-3">
		<Button href={resolve('/(marketing)/directory')} icon={ArrowRight} iconAtEnd
			>Browse all {total} tools</Button
		>
		<p class="text-sm text-muted-foreground">You sign in to each tool with your own account.</p>
	</div>
</MarketingSection>
