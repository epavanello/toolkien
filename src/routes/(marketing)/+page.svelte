<script lang="ts">
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import { Button } from '#lib/components/ui/button/index.js';
</script>

<!-- Placeholder landing (owner: org-ops) -->
<main class="mx-auto flex min-h-svh max-w-2xl flex-col items-start justify-center gap-6 px-6">
	<h1 class="text-3xl font-semibold tracking-tight">{brand.name}</h1>
	<p class="text-xl text-muted-foreground">{brand.tagline}</p>
	<div class="flex gap-2">
		<Button href={resolve('/(auth)/signup')}>Get started</Button>
		<Button href={resolve('/(auth)/login')} variant="outline">Sign in</Button>
	</div>
</main>
