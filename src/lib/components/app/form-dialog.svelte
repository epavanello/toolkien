<script lang="ts" generics="Output">
	import type { RemoteForm } from '$app/server';
	import type { Snippet } from 'svelte';
	import { Button, type ButtonVariant } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import RemoteFormBody from './remote-form.svelte';

	/**
	 * A remote `form` in a dialog: fields as children, Cancel / submit in the footer; closes and
	 * toasts `success` once the submission succeeds.
	 */
	type Props = {
		open?: boolean;
		title: string;
		description?: string;
		submitLabel: string;
		submitVariant?: ButtonVariant;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any remote form input
		form: RemoteForm<any, Output>;
		success?: string;
		onSuccess?: (result: Output | undefined) => unknown;
		children: Snippet;
	};

	let {
		open = $bindable(false),
		title,
		description,
		submitLabel,
		submitVariant,
		form,
		success,
		onSuccess,
		children
	}: Props = $props();

	const formId = $props.id();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
		</Dialog.Header>
		<RemoteFormBody
			id={formId}
			{form}
			{success}
			reset
			onSuccess={(result) => {
				open = false;
				return onSuccess?.(result);
			}}
		>
			{@render children()}
		</RemoteFormBody>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" form={formId} variant={submitVariant} loading={!!form.pending}>
				{submitLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
