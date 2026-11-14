<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const errorStateVariants = tv({
		slots: {
			root: 'flex flex-1 flex-col items-center justify-center px-4 text-center',
			icon: 'flex size-10 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs',
			status: 'mono text-xs font-medium tracking-wider text-muted-foreground tabular-nums',
			title: 'font-semibold tracking-tight text-balance',
			description: 'max-w-md text-sm text-pretty text-muted-foreground',
			detail: 'max-w-md rounded-md border bg-muted/40 px-3 py-2 text-sm text-pretty',
			actions: 'flex flex-wrap items-center justify-center gap-2',
			reference: 'flex items-center gap-1.5 text-xs text-muted-foreground'
		},
		variants: {
			/**
			 * `screen`: a whole page of its own (root error page, inside `FocusFrame`).
			 * `section`: inside a shell that already has navigation (site header, workspace sidebar).
			 */
			variant: {
				screen: { root: 'gap-5 py-16 sm:py-24', title: 'text-2xl sm:text-3xl' },
				section: { root: 'min-h-[50vh] gap-4 py-12', title: 'text-xl' }
			}
		},
		defaultVariants: { variant: 'screen' }
	});

	export type ErrorStateVariant = VariantProps<typeof errorStateVariants>['variant'];
</script>

<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Ban from '@lucide/svelte/icons/ban';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import House from '@lucide/svelte/icons/house';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import LogIn from '@lucide/svelte/icons/log-in';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import SearchX from '@lucide/svelte/icons/search-x';
	import ServerCrash from '@lucide/svelte/icons/server-crash';
	import Timer from '@lucide/svelte/icons/timer';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import type { Component } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { brand } from '#lib/brand.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { describeError, type ErrorKind } from './error-state.ts';
	import Mono from './mono.svelte';

	/**
	 * Error page body (404, 403, 401, 429, 5xx, offline): status, plain-language copy, the app's
	 * 4xx message when it adds something, a reference id for 5xx (from `handleError`) and ways
	 * out (back, home, docs, sign in, try again). Never shows internal messages of 5xx errors.
	 * Sets the document title and `noindex`.
	 */
	type Props = {
		status: number;
		/** `page.error` (`App.Error`): code, message, optional reference id */
		error?: { code?: string; message?: string; id?: string } | null;
		variant?: ErrorStateVariant;
		/** Where "Home" goes; default `/` (which sends signed-in users to their workspace) */
		home?: { href: string; label: string };
	};

	let { status, error, variant, home }: Props = $props();

	let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

	const info = $derived(
		describeError({ status, code: error?.code, message: error?.message, online })
	);
	const styles = $derived(errorStateVariants({ variant }));

	const ICONS: Record<ErrorKind, Component> = {
		offline: WifiOff,
		not_found: SearchX,
		forbidden: LockKeyhole,
		unauthorized: LogIn,
		suspended: Ban,
		invalid: CircleAlert,
		rate_limited: Timer,
		unavailable: CloudOff,
		server: ServerCrash
	};
	const Icon = $derived(ICONS[info.kind]);
	const homeLink = $derived(home ?? { href: resolve('/(marketing)'), label: 'Home' });
	const signInHref = $derived(
		`${resolve('/(auth)/login')}?redirectTo=${encodeURIComponent(page.url.pathname)}`
	);
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />

<svelte:head>
	<title>{info.title} · {brand.name}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class={styles.root()} data-slot="error-state" data-kind={info.kind}>
	<span class={styles.icon()}><Icon class="size-5" aria-hidden="true" /></span>
	<div class="flex flex-col items-center gap-2">
		{#if info.kind !== 'offline'}<p class={styles.status()}>Error {status}</p>{/if}
		<h1 class={styles.title()}>{info.title}</h1>
		<p class={styles.description()}>{info.description}</p>
	</div>
	{#if info.detail}<p class={styles.detail()}>{info.detail}</p>{/if}
	<div class={styles.actions()}>
		{#if info.retry}
			<Button icon={RotateCw} onclick={() => location.reload()}>Try again</Button>
		{/if}
		{#if info.signIn}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus query -->
			<Button icon={LogIn} href={signInHref}>Sign in</Button>
		{/if}
		<Button
			variant={info.retry || info.signIn ? 'outline' : 'default'}
			icon={House}
			href={homeLink.href}>{homeLink.label}</Button
		>
		<Button variant="outline" icon={ArrowLeft} onclick={() => history.back()}>Go back</Button>
		<Button variant="ghost" icon={BookOpen} href={resolve('/(marketing)/docs')}>Docs</Button>
	</div>
	{#if error?.id && status >= 500}
		<p class={styles.reference()}>Reference <Mono value={error.id} copy /></p>
	{/if}
</div>
