<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import {
		EmptyState,
		FormField,
		KeyValueList,
		RemoteForm,
		UnverifiedBadge
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { authorizeClient, decideSwitch, rejectClient } from './consent.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** OAuth redirects leave the app: a full navigation, never a form post (CSP form-action) */
	const leave = (result: { url: string } | undefined) => result && location.assign(result.url);

	const deny = (oauthQuery: string) => attempt(rejectClient(oauthQuery).then(leave));
	const answerSwitch = (requestId: string, confirm: boolean) =>
		attempt(decideSwitch({ requestId, confirm }).then(() => invalidateAll()));
</script>

{#if data.mode === 'oauth'}
	<AuthHeading title="Connect {data.client.name}">
		This MCP client asks to use your tools. Allow it only if you started this connection.
	</AuthHeading>
	<KeyValueList
		items={[
			{ label: 'Client', snippet: clientName },
			{
				label: data.client.verifiedDomain ? 'Verified domain' : 'Client ID',
				value: data.client.verifiedDomain ?? data.client.clientId,
				type: 'mono'
			},
			{ label: 'Returns to', value: data.returnsTo, type: 'mono' },
			{ label: 'Access', value: data.access, type: 'list' }
		]}
	/>
	<RemoteForm form={authorizeClient} submitLabel="Allow access" submit="block" onSuccess={leave}>
		<input {...authorizeClient.fields.oauthQuery.as('hidden', data.oauthQuery)} />
		<FormField
			field={authorizeClient.fields.label}
			type="text"
			label="Name this connection"
			description="Shown in Activity and Connected clients, so you can tell your clients apart (e.g. “Claude Code — work laptop”)."
			value={data.client.label ?? data.client.name}
			placeholder={data.client.name}
			autocomplete="off"
		/>
		<FormField
			field={authorizeClient.fields.workspaceId}
			type="select"
			label="Start in workspace"
			description="Its connectors and permissions apply. Switching later needs your confirmation."
			options={data.workspaces}
		/>
	</RemoteForm>
	<Button variant="ghost" class="mt-2 w-full" onclick={() => deny(data.oauthQuery)}>Deny</Button>
{:else if data.request?.status === 'pending'}
	{@const request = data.request}
	<AuthHeading title="Switch workspace?">
		{request.clientName ?? 'An MCP client'} asks to switch the workspace it works in.
	</AuthHeading>
	<KeyValueList
		items={[
			{ label: 'From', value: request.from },
			{ label: 'To', value: request.to },
			{ label: 'Expires', value: request.expiresAt, type: 'datetime' }
		]}
	/>
	<Button class="mt-5 w-full" onclick={() => answerSwitch(request.id, true)}>
		Switch to {request.to}
	</Button>
	<Button variant="ghost" class="mt-2 w-full" onclick={() => answerSwitch(request.id, false)}>
		Keep {request.from}
	</Button>
{:else if data.request}
	<EmptyState
		title={data.request.status === 'confirmed'
			? `Switched to ${data.request.to}`
			: `Stayed in ${data.request.from}`}
		description="You can go back to your MCP client."
	/>
{:else}
	<EmptyState
		title="Request not found"
		description="It expired or belongs to another account. Ask your MCP client to try again."
	/>
{/if}

{#snippet clientName()}
	{#if data.mode === 'oauth'}
		{data.client.name}
		{#if data.client.unverified}
			<UnverifiedBadge
				tooltip="The client registered itself: its name is not verified. Check that you started this connection."
			/>
		{/if}
	{/if}
{/snippet}
