<script lang="ts">
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import Users from '@lucide/svelte/icons/users';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import UnverifiedBadge from './unverified-badge.svelte';

	/**
	 * Who runs a server: `official` (the service's own vendor), `community` (a third party), or
	 * `null` for a free URL outside the directory (Unverified). `needsReview` adds a small
	 * warning with `reviewNote` as tooltip.
	 */
	type Props = {
		publisher: 'official' | 'community' | null;
		/** Service name for the tooltips ("PostHog") */
		service: string;
		needsReview?: boolean;
		reviewNote?: string;
	};

	let { publisher, service, needsReview = false, reviewNote }: Props = $props();

	const tooltip = $derived(
		publisher === 'official'
			? `Run by ${service} itself, as documented by ${service}.`
			: `Maintained by a third party, not by ${service}.`
	);
</script>

<span class="inline-flex items-center gap-1.5" data-slot="source-badge">
	{#if publisher === null}
		<UnverifiedBadge tooltip="Not in the directory: tool descriptions are treated as untrusted." />
	{:else}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Badge
						variant={publisher === 'official' ? 'success' : 'secondary'}
						class="rounded-sm"
						tabindex={0}
						{...props}
					>
						{#if publisher === 'official'}<BadgeCheck data-icon="inline-start" />{:else}<Users
								data-icon="inline-start"
							/>{/if}
						{publisher === 'official' ? 'Official' : 'Community'}
					</Badge>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{tooltip}</Tooltip.Content>
		</Tooltip.Root>
	{/if}
	{#if needsReview}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Badge variant="warning" class="rounded-sm" tabindex={0} {...props}>Needs review</Badge>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content
				>{reviewNote ?? 'Something about this server is still uncertain.'}</Tooltip.Content
			>
		</Tooltip.Root>
	{/if}
</span>
