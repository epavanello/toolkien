<script lang="ts">
	import Globe from '@lucide/svelte/icons/globe';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogIn from '@lucide/svelte/icons/log-in';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import { authHint } from './service-directory.ts';

	/**
	 * What adding a server asks of the user, in friendly words with an icon: "Sign in with Linear"
	 * (OAuth), "API key" (pasted token) or "No sign-in" (public).
	 */
	type Props = { authType: DirectoryEntry['authType']; service: string };

	let { authType, service }: Props = $props();

	const Icon = $derived(authType === 'oauth' ? LogIn : authType === 'token' ? KeyRound : Globe);
	const hint = $derived(authHint(authType, service));
</script>

<span
	class="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
	title={hint.description}
	data-slot="auth-hint"
>
	<Icon class="size-3.5 shrink-0" aria-hidden="true" />
	<span class="truncate">{hint.label}</span>
</span>
