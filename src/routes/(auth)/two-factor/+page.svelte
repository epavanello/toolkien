<script lang="ts">
	import AuthHeading from '#lib/components/app/auth-heading.svelte';
	import { FormField, RemoteForm } from '#lib/components/app/index.ts';
	import { verifyTwoFactor } from '#lib/functions/auth.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AuthHeading title="Two-factor authentication">
	Enter the 6-digit code from your authenticator app.
</AuthHeading>
<RemoteForm form={verifyTwoFactor} submitLabel="Verify" submit="block">
	<input {...verifyTwoFactor.fields.redirectTo.as('hidden', data.redirectTo)} />
	<FormField
		field={verifyTwoFactor.fields.code}
		type="text"
		label="Code"
		autocomplete="one-time-code"
	/>
</RemoteForm>
