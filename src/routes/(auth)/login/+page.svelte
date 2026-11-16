<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import { EmailSignIn } from '#lib/components/app/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Switching between sign-in and sign-up keeps where the user was going (OAuth consent, add a server) */
	const withRedirect = (path: string) =>
		data.redirectTo && data.redirectTo !== '/'
			? `${path}?redirectTo=${encodeURIComponent(data.redirectTo)}`
			: path;
</script>

<SeoHead
	title="Sign in"
	description="Sign in to Toolkien, the gateway MCP server for all your remote MCP servers."
/>

<AuthHeading title="Sign in">
	No account? <a href={withRedirect(resolve('/(auth)/signup'))}>Create one</a>
</AuthHeading>
<EmailSignIn
	redirectTo={data.redirectTo}
	submitLabel="Email me a sign-in code"
	google={data.googleSignIn}
	googleFailed={data.signInError !== null}
/>
