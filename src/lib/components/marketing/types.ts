import type { Component } from 'svelte';

export type SiteLink = { label: string; href: string; external?: boolean };
export type SiteLinkGroup = { title: string; links: SiteLink[] };
export type Feature = { icon: Component; title: string; description: string };
