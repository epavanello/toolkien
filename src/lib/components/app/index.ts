/**
 * The app component library. Pages compose these; presentation (spacing, colors, typography,
 * states) lives here as variants, never as classes in pages. See docs/conventions.md → UI.
 */
export { default as ActionsMenu, type ActionItem } from './actions-menu.svelte';
export { default as AuthHint } from './auth-hint.svelte';
export { default as AuthFrame } from './auth-frame.svelte';
export { default as Boundary } from './boundary.svelte';
export { default as BulkLevelMenu } from './bulk-level-menu.svelte';
export { default as Callout } from './callout.svelte';
export { default as CategoryFilter, type CategoryOption } from './category-filter.svelte';
export { default as Checklist, type ChecklistItem } from './checklist.svelte';
export { default as ChoiceGrid, type ChoiceGroup, type ChoiceItem } from './choice-grid.svelte';
export { CLIENT_ICONS } from './client-icons.ts';
export { default as ClientSetup } from './client-setup.svelte';
export { default as CommandField } from './command-field.svelte';
export { default as CodeBlock } from './code-block.svelte';
export { default as ConfirmDialog } from './confirm-dialog.svelte';
export { default as ConnectedClients } from './connected-clients.svelte';
export { default as CopyButton } from './copy-button.svelte';
export { default as DataTable } from './data-table.svelte';
export { default as DirectoryBrowser } from './directory-browser.svelte';
export { default as Disclosure } from './disclosure.svelte';
export type { Column, InlineAction, SecondaryTime, TableFilter, TableGroup } from './data-table.ts';
export { default as EmptyState } from './empty-state.svelte';
export { default as ErrorState } from './error-state.svelte';
export { describeError, type ErrorDescription, type ErrorKind } from './error-state.ts';
export { default as FilterBar, type FilterDefinition } from './filter-bar.svelte';
export { default as EmailSignIn } from './email-sign-in.svelte';
export { default as FocusFrame } from './focus-frame.svelte';
export { default as FormDialog } from './form-dialog.svelte';
export { default as FormField } from './form-field.svelte';
export { default as InlineText } from './inline-text.svelte';
export { default as KeyValueList, type KeyValueItem } from './key-value-list.svelte';
export { default as Mono } from './mono.svelte';
export { default as Page } from './page.svelte';
export { default as PermissionBadge } from './permission-badge.svelte';
export { default as RevealDialog } from './reveal-dialog.svelte';
export { default as PermissionSelect } from './permission-select.svelte';
export { default as RelativeTime } from './relative-time.svelte';
export { default as RemoteForm } from './remote-form.svelte';
export { default as Section } from './section.svelte';
export { default as ServiceCard } from './service-card.svelte';
export { default as ServiceDetails } from './service-details.svelte';
export {
	addLabel,
	authHint,
	categoryLabel,
	directoryFilters,
	filterDirectory,
	POPULAR,
	type DirectoryItem
} from './service-directory.ts';
export { default as ServiceLogo, type ServiceLogoSize } from './service-logo.svelte';
export { default as SidePanel } from './side-panel.svelte';
export { default as SourceBadge } from './source-badge.svelte';
export { default as ContextSavings, type HeaviestConnector } from './context-savings.svelte';
export { default as Stats, type StatItem } from './stats.svelte';
export { default as StatusBadge } from './status-badge.svelte';
export { default as Steps, type StepItem, type StepStatus } from './steps.svelte';
export { humanize, toneFor, type Tone } from './status.ts';
export { default as Timeline, type TimelineItem } from './timeline.svelte';
export { default as ToolDefinition, type ToolDefinitionItem } from './tool-definition.svelte';
export { default as ToolGroupList } from './tool-group-list.svelte';
export {
	groupTools,
	toolGroup,
	toolGroups,
	type ToolGroup,
	type ToolGroupKey
} from './tool-groups.ts';
export { default as ToolPermissionRow } from './tool-permission-row.svelte';
export {
	bulkConfirmation,
	bulkItemLabel,
	bulkPlan,
	filterPermissions,
	groupDefault,
	LEVEL_FILTER_OPTIONS,
	LEVEL_LABELS,
	matchesLevel,
	permissionSummary,
	type BulkPlan,
	type BulkScope
} from './tool-permission.ts';
export { default as Toolbar } from './toolbar.svelte';
export { default as ToolPath } from './tool-path.svelte';
export { default as UnverifiedBadge } from './unverified-badge.svelte';
export { default as WelcomeChecklist } from './welcome-checklist.svelte';
