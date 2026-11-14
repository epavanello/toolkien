<script lang="ts" module>
	import type { RemoteFormField } from '$app/server';

	type Common = {
		label: string;
		description?: string;
		placeholder?: string;
		required?: boolean;
		autocomplete?: HTMLInputElement['autocomplete'];
		/** Hides the label visually (still read by screen readers) */
		hideLabel?: boolean;
	};

	export type FormFieldProps = Common &
		(
			| {
					field: RemoteFormField<string>;
					type: 'text' | 'email' | 'password' | 'url' | 'search';
					value?: string;
			  }
			| { field: RemoteFormField<string>; type: 'textarea'; rows?: number; value?: string }
			| {
					field: RemoteFormField<string>;
					type: 'select';
					options: { value: string; label: string }[];
					value?: string;
			  }
			| { field: RemoteFormField<number>; type: 'number'; min?: number; max?: number }
			| { field: RemoteFormField<boolean>; type: 'checkbox' }
		);
</script>

<script lang="ts">
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';

	/**
	 * One field of a remote `form`: label, control bound with `field.as(...)`, description and
	 * validation issues. Hidden inputs need no wrapper: `<input {...form.fields.x.as('hidden', v)} />`.
	 */
	let props: FormFieldProps = $props();

	const id = $props.id();
	const issues = $derived(props.field.issues() ?? []);
</script>

<Field.Field
	orientation={props.type === 'checkbox' ? 'horizontal' : 'vertical'}
	data-invalid={issues.length > 0 || undefined}
>
	{#if props.type === 'checkbox'}
		<input {id} class="size-4 accent-primary" {...props.field.as('checkbox')} />
	{/if}
	<Field.Label for={id} class={props.hideLabel ? 'sr-only' : ''}>
		{props.label}{#if props.required}<span class="text-destructive" aria-hidden="true">*</span>{/if}
	</Field.Label>
	{#if props.type === 'textarea'}
		<Textarea
			{id}
			rows={props.rows ?? 4}
			placeholder={props.placeholder}
			required={props.required}
			{...props.field.as('text')}
			{...props.value !== undefined ? { value: props.value } : {}}
		/>
	{:else if props.type === 'select'}
		<NativeSelect.Root {id} class="w-full" required={props.required} {...props.field.as('select')}>
			{#each props.options as option (option.value)}
				<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	{:else if props.type === 'number'}
		<Input
			{id}
			min={props.min}
			max={props.max}
			placeholder={props.placeholder}
			required={props.required}
			{...props.field.as('number')}
		/>
	{:else if props.type !== 'checkbox'}
		<Input
			{id}
			placeholder={props.placeholder}
			required={props.required}
			autocomplete={props.autocomplete}
			{...props.field.as(props.type)}
			{...props.value !== undefined ? { value: props.value } : {}}
		/>
	{/if}
	{#if props.description}<Field.Description>{props.description}</Field.Description>{/if}
	<Field.Error errors={issues} />
</Field.Field>
