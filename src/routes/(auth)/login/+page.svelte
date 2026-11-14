<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import { FormField, RemoteForm } from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { login } from '#lib/functions/auth.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function signInWithPasskey() {
		const { error } = await authClient.signIn.passkey();
		if (error) toast.error(error.message ?? 'Passkey sign-in failed.');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- validated same-origin path
		else await goto(data.redirectTo, { invalidateAll: true });
	}
</script>

<AuthHeading title="Sign in">
	No account? <a href={resolve('/(auth)/signup')}>Create one</a>
</AuthHeading>
<RemoteForm form={login} submitLabel="Sign in" submit="block">
	<input {...login.fields.redirectTo.as('hidden', data.redirectTo)} />
	<FormField field={login.fields.email} type="email" label="Email" autocomplete="email webauthn" />
	<FormField
		field={login.fields.password}
		type="password"
		label="Password"
		autocomplete="current-password"
	/>
</RemoteForm>
<Button variant="outline" class="mt-3 w-full" icon={KeyRound} onclick={signInWithPasskey}>
	Sign in with a passkey
</Button>
