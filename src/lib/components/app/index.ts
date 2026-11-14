/**
 * The app component library. Pages compose these; presentation (spacing, colors, typography,
 * states) lives here as variants, never as classes in pages. See docs/conventions.md → UI.
 */
export { default as ActionsMenu, type ActionItem } from './actions-menu.svelte';
export { default as Boundary } from './boundary.svelte';
export { default as Callout } from './callout.svelte';
export { default as CodeBlock } from './code-block.svelte';
export { default as ConfirmDialog } from './confirm-dialog.svelte';
export { default as CopyButton } from './copy-button.svelte';
export { default as DataTable } from './data-table.svelte';
export type { Column, TableFilter } from './data-table.ts';
export { default as EmptyState } from './empty-state.svelte';
export { default as FilterBar, type FilterDefinition } from './filter-bar.svelte';
export { default as FocusFrame } from './focus-frame.svelte';
export { default as FormDialog } from './form-dialog.svelte';
export { default as FormField } from './form-field.svelte';
export { default as KeyValueList, type KeyValueItem } from './key-value-list.svelte';
export { default as Mono } from './mono.svelte';
export { default as Page } from './page.svelte';
export { default as PermissionBadge } from './permission-badge.svelte';
export { default as RevealDialog } from './reveal-dialog.svelte';
export { default as PermissionSelect } from './permission-select.svelte';
export { default as RemoteForm } from './remote-form.svelte';
export { default as Section } from './section.svelte';
export { default as SidePanel } from './side-panel.svelte';
export { default as Stats, type StatItem } from './stats.svelte';
export { default as StatusBadge } from './status-badge.svelte';
export { humanize, toneFor, type Tone } from './status.ts';
export { default as Timeline, type TimelineItem } from './timeline.svelte';
export { default as ToolDefinition, type ToolDefinitionItem } from './tool-definition.svelte';
export { default as Toolbar } from './toolbar.svelte';
export { default as ToolPath } from './tool-path.svelte';
export { default as UnverifiedBadge } from './unverified-badge.svelte';
