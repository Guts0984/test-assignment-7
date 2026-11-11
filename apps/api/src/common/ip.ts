import { isIPv6 } from 'node:net';

/**
 * Rate-limit identity for a client address. IPv4-mapped IPv6 is unwrapped; real IPv6 clients
 * control a whole /64, so they are bucketed by prefix (otherwise rotating the low bits is a free bypass).
 */
export const ipKey = (ip: string | undefined): string => {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::')
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
    : h;
  return `${full
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
};
