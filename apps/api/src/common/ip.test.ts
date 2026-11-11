import { describe, expect, it } from 'vitest';
import { ipKey } from './ip';

describe('ipKey', () => {
  it('unwraps IPv4-mapped IPv6 so ::ffff:1.2.3.4 and 1.2.3.4 share a bucket', () => {
    expect(ipKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('1.2.3.4')).toBe('1.2.3.4');
  });
  it('buckets IPv6 by /64 so rotating the host bits does not evade limits', () => {
    const a = ipKey('2001:db8:aaaa:bbbb::1');
    expect(ipKey('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff')).toBe(a);
    expect(ipKey('2001:0db8:aaaa:bbbb:0:0:0:2')).toBe(a);
    expect(ipKey('2001:db8:aaaa:cccc::1')).not.toBe(a);
  });
  it('handles odd input without throwing', () => {
    expect(ipKey(undefined)).toBe('unknown');
    expect(ipKey('')).toBe('unknown');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
  });
});
