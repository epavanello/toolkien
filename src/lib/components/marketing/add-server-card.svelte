<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import ServiceLogo from '#lib/components/app/service-logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';

	/**
	 * "Add <service> to Toolkien": a focused, centered step between the public directory and
	 * the app (logo, the page's `h1`, one line, what it asks for, then the form).
	 */
	type Props = {
		name: string;
		icon?: string;
		tagline?: string;
		/** What adding asks of the user (an `AuthHint`) */
		hint?: Snippet;
		children: Snippet;
	};

	let { name, icon, tagline, hint, children }: Props = $props();
</script>

<div class="flex flex-1 items-start justify-center bg-forge-grid px-4 py-12 sm:py-20">
	<div class="flex w-full max-w-md flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
		<div class="flex flex-col items-center gap-3 text-center">
			<ServiceLogo {name} src={icon} size="lg" />
			<h1 class="font-display text-2xl font-semibold tracking-tight text-balance">
				Add {name} to Toolkien
			</h1>
			{#if tagline}<p class="text-sm text-muted-foreground">{tagline}</p>{/if}
			{#if hint}{@render hint()}{/if}
		</div>
		{@render children()}
		<Button variant="ghost" size="sm" icon={ArrowLeft} href={resolve('/(marketing)/directory')}
			>Back to the directory</Button
		>
	</div>
</div>
