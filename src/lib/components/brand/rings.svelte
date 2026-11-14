<script lang="ts">
	import { ringMasks, type RingsGeometry } from './paths.ts';

	/**
	 * The interlocking rings, as SVG children (render inside an `<svg>`): ring A takes `a`, ring B
	 * takes `b` (CSS colours or `currentColor`). Same geometry and masks as `ringsSvg()`.
	 */
	let { geometry, a, b }: { geometry: RingsGeometry; a: string; b: string } = $props();

	const id = $props.id();
	const m = $derived(ringMasks(geometry));
</script>

{#snippet rect(box: { x: number; y: number; width: number; height: number }, fill: string)}
	<rect x={box.x} y={box.y} width={box.width} height={box.height} {fill} />
{/snippet}

<defs>
	<mask id="{id}-a" maskUnits="userSpaceOnUse" {...m.region}>
		{@render rect(m.region, 'white')}
		<circle
			cx={geometry.cxB}
			cy={geometry.cy}
			r={geometry.r}
			fill="none"
			stroke="black"
			stroke-width={m.cut}
		/>
		{@render rect(m.upper, 'white')}
	</mask>
	<mask id="{id}-b" maskUnits="userSpaceOnUse" {...m.region}>
		{@render rect(m.region, 'white')}
		<circle
			cx={geometry.cxA}
			cy={geometry.cy}
			r={geometry.r}
			fill="none"
			stroke="black"
			stroke-width={m.cut}
		/>
		{@render rect(m.lower, 'white')}
	</mask>
</defs>
<circle
	mask="url(#{id}-a)"
	cx={geometry.cxA}
	cy={geometry.cy}
	r={geometry.r}
	fill="none"
	style:stroke={a}
	stroke-width={geometry.w}
/>
<circle
	mask="url(#{id}-b)"
	cx={geometry.cxB}
	cy={geometry.cy}
	r={geometry.r}
	fill="none"
	style:stroke={b}
	stroke-width={geometry.w}
/>
