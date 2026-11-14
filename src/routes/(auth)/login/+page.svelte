<script lang="ts">
	import { resolve } from '$app/paths';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import { EmailSignIn } from '#lib/components/app/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SeoHead
	title="Sign in"
	description="Sign in to Toolkien, the gateway MCP server for all your remote MCP servers."
/>

<AuthHeading title="Sign in">
	No account? <a href={resolve('/(auth)/signup')}>Create one</a>
</AuthHeading>
<EmailSignIn redirectTo={data.redirectTo} submitLabel="Email me a sign-in code" />
