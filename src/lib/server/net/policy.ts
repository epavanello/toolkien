import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { UnsafeUrlError } from './types.ts';
import { isAllowedAddress, isLoopbackAddress, type AddressPolicy } from './ip.ts';

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** Resolves every A/AAAA address of a hostname (injectable for tests) */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
	const results = await dnsLookup(hostname, { all: true, verbatim: true });
	return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export type UrlPolicy = AddressPolicy & {
	/** Ports allowed for https (default only 443, the only port the egress proxy tunnels) */
	allowedPorts?: readonly number[];
	resolver?: Resolver;
};

/** Hostnames that never leave the machine; rejected before any DNS query */
const LOCAL_SUFFIXES = ['localhost', 'localhost.', 'local', 'internal', 'home.arpa'];

function isLocalName(hostname: string) {
	const name = hostname.toLowerCase().replace(/\.$/, '');
	return LOCAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

const isLocalhostName = (hostname: string) => /(^|\.)localhost\.?$/i.test(hostname);

/** URL hostname without IPv6 brackets */
export const bareHostname = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, '$1');

/**
 * Synchronous checks: syntax, scheme, credentials, port and IP literals. Hostnames still need
 * `checkAddresses` on what they resolve to.
 */
export function validateUrlShape(input: string | URL, policy: UrlPolicy = {}): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new UnsafeUrlError('invalid_url');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('scheme');
	if (url.username || url.password) throw new UnsafeUrlError('credentials_in_url');

	const host = bareHostname(url);
	if (!host) throw new UnsafeUrlError('invalid_url');
	const literal = isIP(host) !== 0;
	const loopbackTarget = policy.allowLoopback
		? literal
			? isLoopbackAddress(host)
			: isLocalhostName(host)
		: false;

	// Plain http only to loopback, and only when the policy allows loopback (development)
	if (url.protocol === 'http:' && !loopbackTarget) throw new UnsafeUrlError('scheme');

	if (!loopbackTarget) {
		const port = url.port ? Number(url.port) : 443;
		if (!(policy.allowedPorts ?? [443]).includes(port)) throw new UnsafeUrlError('port');
		if (!literal && isLocalName(host)) throw new UnsafeUrlError('blocked_address');
	}
	if (literal && !isAllowedAddress(host, policy)) throw new UnsafeUrlError('blocked_address');
	return url;
}

/** Throws unless every address is allowed (one bad record rejects the whole name) */
export function checkAddresses(addresses: ResolvedAddress[], policy: AddressPolicy = {}) {
	if (addresses.length === 0) throw new UnsafeUrlError('dns_failure');
	for (const { address } of addresses) {
		if (!isAllowedAddress(address, policy)) throw new UnsafeUrlError('blocked_address');
	}
	return addresses;
}

/** Resolves a hostname (or passes an IP literal through) and checks every address */
export async function resolveChecked(
	hostname: string,
	policy: UrlPolicy = {}
): Promise<ResolvedAddress[]> {
	const family = isIP(hostname);
	if (family !== 0) return checkAddresses([{ address: hostname, family: family as 4 | 6 }], policy);
	if (isLocalhostName(hostname) && policy.allowLoopback) {
		return [{ address: '127.0.0.1', family: 4 }];
	}
	let addresses: ResolvedAddress[];
	try {
		addresses = await (policy.resolver ?? systemResolver)(hostname);
	} catch {
		throw new UnsafeUrlError('dns_failure');
	}
	return checkAddresses(addresses, policy);
}

export async function assertSafeUrlWith(input: string | URL, policy: UrlPolicy = {}) {
	const url = validateUrlShape(input, policy);
	await resolveChecked(bareHostname(url), policy);
	return url;
}

type LookupCallback = (
	error: NodeJS.ErrnoException | null,
	address: string | { address: string; family: number }[],
	family?: number
) => void;

/**
 * `lookup` for `net.connect`/`tls.connect`: resolves once, checks every address and hands the
 * socket the checked address. The connection can only go to an address we validated, whatever
 * the DNS answers later (DNS rebinding).
 */
export function createPinnedLookup(policy: UrlPolicy = {}) {
	return (hostname: string, options: { all?: boolean } | number, callback: LookupCallback) => {
		const all = typeof options === 'object' && options?.all === true;
		resolveChecked(hostname, policy).then(
			(addresses) => {
				if (all) callback(null, addresses);
				else callback(null, addresses[0]!.address, addresses[0]!.family);
			},
			(error: Error) => callback(error as NodeJS.ErrnoException, all ? [] : '', 0)
		);
	};
}
