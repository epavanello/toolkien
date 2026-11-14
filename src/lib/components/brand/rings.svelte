<script lang="ts">
	import { ringMasks, type RingsGeometry } from './paths.ts';

	/**
	 * The interlocking rings, as SVG children (render inside an `<svg>`): ring A takes `a`, ring B
	 * takes `b` (CSS colours or `currentColor`). Same geometry and masks as `ringsSvg()`.
	 * `draw`: `true` strokes the rings in once (left, then right); `'hold'` keeps them undrawn
	 * until `draw` becomes `true` (start on first view). Static with reduced motion.
	 */
	type Props = { geometry: RingsGeometry; a: string; b: string; draw?: boolean | 'hold' };

	let { geometry, a, b, draw = false }: Props = $props();

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
	class={[draw === true && 'draw', draw === 'hold' && 'hold']}
	pathLength={draw ? 100 : undefined}
	cx={geometry.cxA}
	cy={geometry.cy}
	r={geometry.r}
	fill="none"
	style:stroke={a}
	stroke-width={geometry.w}
/>
<circle
	mask="url(#{id}-b)"
	class={['second', draw === true && 'draw', draw === 'hold' && 'hold']}
	pathLength={draw ? 100 : undefined}
	cx={geometry.cxB}
	cy={geometry.cy}
	r={geometry.r}
	fill="none"
	style:stroke={b}
	stroke-width={geometry.w}
/>

<style>
	.draw,
	.hold {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
	}
	.draw {
		animation: draw 1.1s cubic-bezier(0.65, 0, 0.35, 1) 0.15s forwards;
	}
	.draw.second {
		animation-delay: 0.45s;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.draw,
		.hold {
			animation: none;
			stroke-dashoffset: 0;
		}
	}
</style>
