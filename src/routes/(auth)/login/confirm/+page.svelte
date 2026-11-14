<script lang="ts">
	import LogIn from '@lucide/svelte/icons/log-in';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import { Callout } from '#lib/components/app/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { confirmSignIn } from '#lib/functions/auth.remote.ts';

	// Opening this page never signs in: link scanners prefetch emailed links. The button does.
	const token = $derived(page.url.searchParams.get('token') ?? '');
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');

	async function signIn() {
		let next = '/';
		const ok = await attempt(
			confirmSignIn({ token, redirectTo }).then((r) => (next = r.redirectTo))
		);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- validated same-origin path
		if (ok) await goto(next, { invalidateAll: true });
	}
</script>

<SeoHead title="Confirm sign-in" description="Finish signing in to Toolkien." noindex />

<AuthHeading title="Confirm sign-in"
	>Press the button to finish signing in on this device.</AuthHeading
>
{#if token}
	<Button class="w-full" icon={LogIn} onclick={signIn}>Sign in</Button>
{:else}
	<Callout tone="warning" title="This link is incomplete">
		Copy the whole link from the email, or <a href={resolve('/(auth)/login')}>request a new one</a>.
	</Callout>
{/if}
