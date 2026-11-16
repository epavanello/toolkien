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
	title="Create your account"
	description="Create a free Toolkien account: one MCP server for every remote MCP server you use."
/>

<AuthHeading title="Create your account">
	No password needed: we email you a code. Already registered? <a
		href={withRedirect(resolve('/(auth)/login'))}>Sign in</a
	>
</AuthHeading>
<EmailSignIn
	redirectTo={data.redirectTo}
	submitLabel="Email me a code"
	passkey={false}
	google={data.googleSignIn}
	googleFailed={data.signInError !== null}
/>
