<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import type { Snippet } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import AuthHint from './auth-hint.svelte';
	import ServiceLogo from './service-logo.svelte';
	import SourceBadge from './source-badge.svelte';

	/**
	 * A service in a grid (directory): logo, name, who runs it, a one-line benefit, its category
	 * and what adding it asks for. The whole card opens the details (`onSelect`, a stretched
	 * button, so keyboard and screen readers get one clear target); `action` (an "Add" button)
	 * sits above it and stays separately clickable.
	 */
	type Props = {
		name: string;
		icon?: string | null;
		/** One line; falls back to `description` */
		tagline?: string;
		description: string;
		publisher: DirectoryEntry['publisher'];
		needsReview?: boolean;
		reviewNote?: string;
		/** Category label ("Project management") */
		category: string;
		authType: DirectoryEntry['authType'];
		/** Already added to the workspace */
		added?: boolean;
		onSelect: () => void;
		action?: Snippet;
	};

	let {
		name,
		icon,
		tagline,
		description,
		publisher,
		needsReview = false,
		reviewNote,
		category,
		authType,
		added = false,
		onSelect,
		action
	}: Props = $props();
</script>

<article
	class="relative flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-foreground/25 hover:bg-muted/30"
	data-slot="service-card"
>
	<div class="flex items-start gap-3">
		<ServiceLogo {name} src={icon} size="lg" />
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<h3 class="text-sm leading-5 font-semibold">
				<button
					type="button"
					class="max-w-full truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl"
					onclick={onSelect}
					aria-haspopup="dialog">{name}</button
				>
			</h3>
			<p class="line-clamp-2 text-sm text-pretty text-muted-foreground">{tagline ?? description}</p>
		</div>
		<span class="relative z-10 shrink-0">
			<SourceBadge {publisher} service={name} {needsReview} {reviewNote} />
		</span>
	</div>
	<div class="mt-auto flex min-w-0 items-center gap-2">
		<Badge variant="secondary" class="rounded-sm">{category}</Badge>
		<AuthHint {authType} service={name} />
		<span class="relative z-10 ml-auto flex shrink-0 items-center gap-2">
			{#if added}
				<span class="inline-flex items-center gap-1 text-xs text-success">
					<CircleCheck class="size-3.5" aria-hidden="true" />Added
				</span>
			{/if}
			{#if action}{@render action()}{/if}
		</span>
	</div>
</article>
