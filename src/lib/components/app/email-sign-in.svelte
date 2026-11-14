<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { requestSignIn, verifySignInCode } from '#lib/functions/auth.remote.ts';
	import Callout from './callout.svelte';
	import FormField from './form-field.svelte';
	import RemoteForm from './remote-form.svelte';

	/**
	 * Passwordless sign-in and sign-up: email → "check your email" with the 6-digit code (same
	 * tab, so `redirectTo` — e.g. the MCP consent page — survives), or the emailed link. Passkeys
	 * as the alternative.
	 */
	type Props = { redirectTo: string; submitLabel: string; passkey?: boolean };

	let { redirectTo, submitLabel, passkey = true }: Props = $props();

	let sentTo = $state<string | null>(null);

	async function signInWithPasskey() {
		const { error } = await authClient.signIn.passkey();
		if (error) toast.error(error.message ?? 'Passkey sign-in failed.');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- validated same-origin path
		else await goto(redirectTo, { invalidateAll: true });
	}
</script>

{#if sentTo}
	<div class="flex flex-col gap-4">
		<Callout
			title="Check your email"
			description="We sent a 6-digit code and a sign-in link to {sentTo}. They expire in 10 minutes."
		/>
		<RemoteForm form={verifySignInCode} submitLabel="Sign in" submit="block">
			<input {...verifySignInCode.fields.email.as('hidden', sentTo)} />
			<input {...verifySignInCode.fields.redirectTo.as('hidden', redirectTo)} />
			<FormField
				field={verifySignInCode.fields.code}
				type="text"
				label="Code"
				autocomplete="one-time-code"
				placeholder="123456"
			/>
		</RemoteForm>
		<Button variant="ghost" size="sm" onclick={() => (sentTo = null)}>Use another email</Button>
	</div>
{:else}
	<RemoteForm
		form={requestSignIn}
		{submitLabel}
		submit="block"
		onSuccess={(result) => (sentTo = result?.email ?? null)}
	>
		<input {...requestSignIn.fields.redirectTo.as('hidden', redirectTo)} />
		<FormField
			field={requestSignIn.fields.email}
			type="email"
			label="Email"
			autocomplete="email webauthn"
		/>
	</RemoteForm>
	{#if passkey}
		<Button variant="outline" class="mt-3 w-full" icon={KeyRound} onclick={signInWithPasskey}>
			Sign in with a passkey
		</Button>
	{/if}
{/if}
