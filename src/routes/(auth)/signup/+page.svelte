<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { FormField, RemoteForm } from '#lib/components/app/index.ts';
	import { signup } from '#lib/functions/auth.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SeoHead
	title="Create your account"
	description="Create a free Toolkien account: one MCP server for every remote MCP server you use."
/>

<AuthHeading title="Create your account">
	Already registered? <a href={resolve('/(auth)/login')}>Sign in</a>
</AuthHeading>
<RemoteForm form={signup} submitLabel="Create account" submit="block">
	<input {...signup.fields.redirectTo.as('hidden', data.redirectTo)} />
	<FormField field={signup.fields.name} type="text" label="Name" autocomplete="name" />
	<FormField field={signup.fields.email} type="email" label="Email" autocomplete="email" />
	<FormField
		field={signup.fields.password}
		type="password"
		label="Password"
		description="At least 12 characters."
		autocomplete="new-password"
	/>
</RemoteForm>
