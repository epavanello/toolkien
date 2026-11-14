<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MessageSquareText from '@lucide/svelte/icons/message-square-text';
	import type { Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import AuthHint from './auth-hint.svelte';
	import Callout from './callout.svelte';
	import Disclosure from './disclosure.svelte';
	import KeyValueList from './key-value-list.svelte';
	import Section from './section.svelte';
	import { authHint, categoryLabel } from './service-directory.ts';

	/**
	 * Everything a person needs to decide to add a directory server, in reading order: what it
	 * does, the primary `action` (Add), example prompts, what it asks for, the docs link. The
	 * technical facts (endpoint, namespace, verification, tool notes) are folded away.
	 */
	type Props = { entry: DirectoryEntry; action?: Snippet };

	let { entry, action }: Props = $props();

	const needs = $derived(authHint(entry.authType, entry.name));
	const checks = {
		tested: 'Tested (tools inspected)',
		documented: "Matches the vendor's docs",
		'needs-review': 'Needs review'
	} as const;
	const toolNames = $derived(Object.keys({ ...entry.annotations, ...entry.toolNotes }));
</script>

<div class="flex flex-col gap-5" data-slot="service-details">
	<p class="text-sm text-pretty">{entry.description}</p>

	{#if !entry.supported}
		<Callout
			tone="warning"
			title="Not available yet"
			description={`${entry.name}'s sign-in only accepts apps registered in advance, which Toolkien cannot do yet. We are working on it.`}
		/>
	{:else if action}
		<div class="flex flex-col gap-2">{@render action()}</div>
	{/if}

	{#if entry.examples.length > 0}
		<Section variant="plain" title="Try asking">
			<ul class="flex flex-col gap-2">
				{#each entry.examples as example (example)}
					<li class="flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
						<MessageSquareText
							class="mt-0.5 size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span>{example}</span>
					</li>
				{/each}
			</ul>
		</Section>
	{/if}

	<Section variant="plain" title="What it needs">
		<div class="flex flex-col gap-1.5 text-sm">
			<AuthHint authType={entry.authType} service={entry.name} />
			<p class="text-muted-foreground">{needs.description}</p>
			{#if entry.tokenHelp}<p class="text-muted-foreground">{entry.tokenHelp}</p>{/if}
		</div>
		{#if entry.homepage}
			<div>
				<Button
					size="sm"
					variant="outline"
					icon={ExternalLink}
					href={entry.homepage}
					target="_blank"
					rel="noopener noreferrer">{entry.name} documentation</Button
				>
			</div>
		{/if}
	</Section>

	<Disclosure title="Technical details" description="Endpoint, namespace, verification">
		<KeyValueList
			items={[
				{ label: 'Server URL', value: entry.url, type: 'mono', copy: true },
				{ label: 'Namespace', value: entry.namespace, type: 'mono' },
				{ label: 'Category', value: categoryLabel(entry.category) },
				{
					label: 'Publisher',
					value:
						entry.publisher === 'official'
							? `Official (run by ${entry.name})`
							: `Community (not maintained by ${entry.name})`
				},
				{ label: 'Checked', value: checks[entry.verification.status] },
				{ label: 'Checked on', value: entry.verification.on, type: 'datetime' },
				{ label: 'Checked by', value: entry.verification.by },
				{ label: 'Scopes', value: entry.scopes?.join(' ') ?? null, type: 'mono' },
				{ label: 'Tags', value: entry.tags.join(', ') || null }
			]}
		/>
		{#if entry.verification.notes}
			<Callout
				tone={entry.verification.status === 'needs-review' ? 'warning' : 'info'}
				title="Reviewer notes"
				description={entry.verification.notes}
			/>
		{/if}
		{#if toolNames.length > 0}
			<Section variant="plain" title="Verified tools">
				<KeyValueList
					items={toolNames.map((name) => ({
						label: name,
						value:
							[
								entry.annotations?.[name]?.readOnlyHint ? 'Read only' : null,
								entry.annotations?.[name]?.destructiveHint ? 'Destructive' : null,
								entry.toolNotes[name] ?? null
							]
								.filter(Boolean)
								.join(' · ') || null
					}))}
				/>
			</Section>
		{/if}
	</Disclosure>
</div>
