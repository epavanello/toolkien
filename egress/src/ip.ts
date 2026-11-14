import { isIP } from 'node:net';

/**
 * Address policy for outbound requests. IPv4 is a blocklist of every non-public range; IPv6 is
 * an allowlist: only global unicast (2000::/3) minus documentation, 6to4, Teredo and the other
 * special-purpose blocks. Everything outside 2000::/3 (loopback, ULA fc00::/7 including the AWS
 * metadata address fd00:ec2::254, link-local, multicast, IPv4-mapped/compatible, NAT64
 * 64:ff9b::/96) is blocked by construction, so an IPv4 address can never sneak in through an
 * IPv6 form.
 */

type Cidr = { bits: bigint; prefix: number; width: 32 | 128 };

/** Non-public IPv4 ranges (RFC 6890 and friends). Docker's default pools are inside RFC 1918. */
export const BLOCKED_IPV4 = [
	'0.0.0.0/8', // "this network"
	'10.0.0.0/8', // RFC 1918 (Docker overlay/custom pools)
	'100.64.0.0/10', // CGNAT (also Alibaba metadata 100.100.100.200)
	'127.0.0.0/8', // loopback
	'169.254.0.0/16', // link-local, cloud metadata 169.254.169.254
	'172.16.0.0/12', // RFC 1918 (Docker default bridge 172.17.0.0/16 and pools)
	'192.0.0.0/24', // IETF protocol assignments (Oracle metadata 192.0.0.192)
	'192.0.2.0/24', // TEST-NET-1
	'192.88.99.0/24', // 6to4 relay anycast
	'192.168.0.0/16', // RFC 1918 (Docker address pools)
	'198.18.0.0/15', // benchmarking
	'198.51.100.0/24', // TEST-NET-2
	'203.0.113.0/24', // TEST-NET-3
	'224.0.0.0/4', // multicast
	'240.0.0.0/4' // reserved + broadcast
] as const;

/** Global unicast IPv6 is allowed except these special-purpose blocks */
export const ALLOWED_IPV6 = '2000::/3';
export const BLOCKED_IPV6 = [
	'2001::/23', // IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID)
	'2001:db8::/32', // documentation
	'2002::/16', // 6to4 (embeds an IPv4 address)
	'3fff::/20' // documentation (RFC 9637)
] as const;

const LOOPBACK = ['127.0.0.0/8', '::1/128'];

export function ipToBigInt(address: string): { value: bigint; width: 32 | 128 } | null {
	const family = isIP(address);
	if (family === 4) {
		const value = address.split('.').reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
		return { value, width: 32 };
	}
	if (family !== 6) return null;
	let text = address.toLowerCase();
	const zone = text.indexOf('%');
	if (zone !== -1) text = text.slice(0, zone);
	// Trailing dotted quad (`::ffff:1.2.3.4`) → two hextets
	const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
	if (dotted) {
		const v4 = ipToBigInt(dotted[2]!);
		if (!v4) return null;
		text = `${dotted[1]}${(v4.value >> 16n).toString(16)}:${(v4.value & 0xffffn).toString(16)}`;
	}
	const [head, tail] = text.split('::') as [string, string | undefined];
	const headParts = head ? head.split(':') : [];
	const tailParts = tail ? tail.split(':') : [];
	const missing = 8 - headParts.length - tailParts.length;
	const parts =
		tail === undefined ? headParts : [...headParts, ...Array(missing).fill('0'), ...tailParts];
	if (parts.length !== 8) return null;
	const value = parts.reduce((acc, part) => (acc << 16n) | BigInt(parseInt(part || '0', 16)), 0n);
	return { value, width: 128 };
}

export function parseCidr(cidr: string): Cidr {
	const [address, prefixText] = cidr.split('/') as [string, string | undefined];
	const parsed = ipToBigInt(address);
	if (!parsed) throw new Error(`Invalid CIDR: ${cidr}`);
	const prefix = prefixText === undefined ? parsed.width : Number(prefixText);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.width) {
		throw new Error(`Invalid CIDR: ${cidr}`);
	}
	return { bits: parsed.value, prefix, width: parsed.width };
}

function inCidr(value: bigint, width: 32 | 128, cidr: Cidr): boolean {
	if (cidr.width !== width) return false;
	const shift = BigInt(width - cidr.prefix);
	return value >> shift === cidr.bits >> shift;
}

const blockedV4 = BLOCKED_IPV4.map(parseCidr);
const allowedV6 = parseCidr(ALLOWED_IPV6);
const blockedV6 = BLOCKED_IPV6.map(parseCidr);
const loopback = LOOPBACK.map(parseCidr);

export type AddressPolicy = {
	/** Development only: allow loopback (local MCP servers, tests) */
	allowLoopback?: boolean;
	/** Extra ranges to block, e.g. a custom Docker subnet outside RFC 1918 */
	extraBlocked?: readonly string[];
};

/** `true` when an outbound connection to this IP literal is allowed */
export function isAllowedAddress(address: string, policy: AddressPolicy = {}): boolean {
	const parsed = ipToBigInt(address);
	if (!parsed) return false;
	const { value, width } = parsed;
	if (policy.allowLoopback && loopback.some((c) => inCidr(value, width, c))) return true;
	if (policy.extraBlocked?.some((c) => inCidr(value, width, parseCidr(c)))) return false;
	if (width === 32) return !blockedV4.some((c) => inCidr(value, width, c));
	if (!inCidr(value, width, allowedV6)) return false;
	return !blockedV6.some((c) => inCidr(value, width, c));
}

export function isLoopbackAddress(address: string): boolean {
	const parsed = ipToBigInt(address);
	return !!parsed && loopback.some((c) => inCidr(parsed.value, parsed.width, c));
}
