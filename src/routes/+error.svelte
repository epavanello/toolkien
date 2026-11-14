<script lang="ts">
	import { page } from '$app/state';
	import { ErrorState, FocusFrame } from '#lib/components/app/index.ts';
</script>

<!-- Unknown routes and errors outside the site/workspace shells (auth, approve, admin) -->
<FocusFrame>
	<ErrorState status={page.status} error={page.error} />
</FocusFrame>
