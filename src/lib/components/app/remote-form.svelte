<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const remoteFormVariants = tv({
		slots: { root: 'flex flex-col gap-4', actions: 'flex' },
		variants: {
			/** `block` spans the form width (auth pages), `end` sits at the right (settings) */
			submit: { block: { actions: '*:w-full' }, end: { actions: 'justify-end' } }
		},
		defaultVariants: { submit: 'end' }
	});

	export type RemoteFormSubmit = VariantProps<typeof remoteFormVariants>['submit'];
</script>

<script lang="ts" generics="Output">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import type { RemoteForm } from '$app/server';
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button, type ButtonVariant } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';

	/**
	 * A remote `form` with its fields, the form-level error and the submit button. Field errors
	 * are shown by each `FormField`.
	 */
	type Props = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any remote form input
		form: RemoteForm<any, Output>;
		submitLabel?: string;
		submit?: RemoteFormSubmit;
		submitVariant?: ButtonVariant;
		/** Lets a button outside the form (dialog footer) submit it */
		id?: string;
		/** Toast shown once the submission succeeds */
		success?: string;
		/** Clears the inputs after a successful submission */
		reset?: boolean;
		onSuccess?: (result: Output | undefined) => unknown;
		children: Snippet;
	};

	let { form, submitLabel, submit, submitVariant, id, success, reset, onSuccess, children }: Props =
		$props();

	const styles = $derived(remoteFormVariants({ submit }));
	const issues = $derived(form.fields.issues() ?? []);
</script>

<form
	{id}
	class={styles.root()}
	{...form.enhance(async (instance) => {
		if (!(await instance.submit())) return;
		if (reset) instance.element.reset();
		if (success) toast.success(success);
		await onSuccess?.(instance.result);
	})}
>
	<Field.Group class="gap-4">{@render children()}</Field.Group>
	{#if issues.length > 0}
		<Alert.Root variant="destructive">
			<CircleAlert />
			<Alert.Title>{issues[0].message}</Alert.Title>
		</Alert.Root>
	{/if}
	{#if submitLabel}
		<div class={styles.actions()}>
			<Button type="submit" variant={submitVariant} loading={!!form.pending}>{submitLabel}</Button>
		</div>
	{/if}
</form>
