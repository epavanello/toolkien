<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ErrorState } from '#lib/components/app/index.ts';

	// Errors of a section render inside the workspace shell (sidebar stays usable). Errors of the
	// workspace layout itself (unknown workspace, no access) fall back to the root error page.
	const home = $derived({
		href: resolve('/w/[workspace]', { workspace: page.params.workspace! }),
		label: 'Workspace home'
	});
</script>

<ErrorState variant="section" status={page.status} error={page.error} {home} />
