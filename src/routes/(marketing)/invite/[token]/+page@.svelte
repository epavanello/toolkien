<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Boundary, Callout, FocusFrame, KeyValueList, Page } from '#lib/components/app/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { getInvite, joinWorkspace } from '#lib/functions/workspaces.remote.ts';

	const token = $derived(page.params.token!);
	const here = $derived(`/invite/${token}`);

	const messages: Record<string, string> = {
		invalid: 'This invite link is not valid.',
		expired: 'This invite link has expired. Ask an admin for a new one.',
		revoked: 'This invite link was revoked.',
		used: 'This invite link has already been used.',
		email_mismatch: 'This invite link is meant for a different email address.'
	};

	async function join() {
		let slug = '';
		const ok = await attempt(joinWorkspace(token).then((r) => (slug = r.slug)));
		if (ok) await goto(resolve('/w/[workspace]', { workspace: slug }), { invalidateAll: true });
	}
</script>

<SeoHead
	title="Join a workspace"
	description="Accept an invitation to a Toolkien workspace."
	noindex
/>

<FocusFrame>
	<Page variant="narrow" title="Join a workspace">
		<Boundary>
			{@const { preview, signedIn } = await getInvite(token)}
			{#if preview.status === 'invalid'}
				<Callout tone="danger" title={messages.invalid} />
			{:else}
				<KeyValueList
					items={[
						{ label: 'Workspace', value: preview.workspaceName },
						{ label: 'Role', value: preview.role }
					]}
				/>
				{#if preview.status === 'already_member'}
					<Callout title="You are already a member">
						{#snippet action()}
							<Button
								size="sm"
								href={resolve('/w/[workspace]', { workspace: preview.workspaceSlug })}>Open</Button
							>
						{/snippet}
					</Callout>
				{:else if preview.status !== 'active'}
					<Callout tone="danger" title={messages[preview.status] ?? messages.invalid} />
				{:else if !signedIn}
					<Callout
						title="Sign in to accept"
						description="Use the account you want to join with, or create one."
					>
						{#snippet action()}
							<Button
								size="sm"
								variant="outline"
								href="{resolve('/(auth)/login')}?redirectTo={encodeURIComponent(here)}"
								>Sign in</Button
							>
							<Button
								size="sm"
								href="{resolve('/(auth)/signup')}?redirectTo={encodeURIComponent(here)}"
								>Create account</Button
							>
						{/snippet}
					</Callout>
				{:else}
					{#if preview.role === 'admin'}
						<Callout
							tone="warning"
							title="Admins need a second factor"
							description="Add a passkey in your account settings before joining as an admin."
						/>
					{/if}
					<div><Button onclick={join}>Join {preview.workspaceName}</Button></div>
				{/if}
			{/if}
		</Boundary>
	</Page>
</FocusFrame>
