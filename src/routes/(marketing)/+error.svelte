<script lang="ts">
	import { page } from '$app/state';
	import { ErrorState } from '#lib/components/app/index.ts';
</script>

<!-- Missing legal documents and other site errors keep the site header and footer -->
<ErrorState variant="section" status={page.status} error={page.error} />
