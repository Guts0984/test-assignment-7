import { describe, expect, it } from 'vitest';
import {
  EMPTY_QUERY,
  hasActiveFilter,
  nextSort,
  parseQuery,
  queryEquals,
  serializeQuery,
  type TableQuery,
} from './table-query';

const roundTrip = (q: TableQuery) => parseQuery(new URLSearchParams(serializeQuery(q).toString()));

describe('URL <-> query state', () => {
  it('round-trips a full state', () => {
    const q: TableQuery = {
      sort: { field: 'price', dir: 'desc' },
      filter: {
        sku: 'SKU-1',
        name: 'lamp, big',
        category: ['books', 'toys'],
        status: ['active'],
        priceMin: '10.50',
        priceMax: '99',
        stockMin: 0,
        stockMax: 20,
      },
    };
    expect(roundTrip(q)).toEqual(q);
  });
  it('the empty state is an empty URL (clean address bar)', () => {
    expect(serializeQuery(EMPTY_QUERY).toString()).toBe('');
    expect(parseQuery(new URLSearchParams(''))).toEqual(EMPTY_QUERY);
  });
  it('ascending is the default and is not written', () => {
    expect(serializeQuery({ sort: { field: 'name', dir: 'asc' }, filter: {} }).toString()).toBe(
      'sort=name',
    );
    expect(serializeQuery({ sort: { field: 'name', dir: 'desc' }, filter: {} }).toString()).toBe(
      'sort=name&dir=desc',
    );
  });
  it('the same state always gives the same URL regardless of how it was built', () => {
    const a = serializeQuery({ sort: null, filter: { name: 'a', sku: 'b' } }).toString();
    const b = serializeQuery({ sort: null, filter: { sku: 'b', name: 'a' } }).toString();
    expect(a).toBe(b);
  });
  it('special characters in text survive (&, =, #, unicode, plus)', () => {
    const q: TableQuery = { sort: null, filter: { name: 'A&B=C #1 + «лампа»' } };
    expect(roundTrip(q)).toEqual(q);
  });
});

describe('a hostile or stale URL never breaks the page', () => {
  const p = (s: string) => parseQuery(new URLSearchParams(s));
  it.each([
    ['sort=__proto__', null],
    ['sort=password', null],
    ['sort=', null],
    ['sort[]=name', null],
  ])('%s -> no sort', (qs, sort) => expect(p(qs).sort).toBe(sort));
  it('drops unknown categories/statuses but keeps valid ones', () => {
    expect(p('category=books,evil,toys&status=active,hacked').filter).toEqual({
      category: ['books', 'toys'],
      status: ['active'],
    });
  });
  it('drops malformed numbers (no NaN, no injection)', () => {
    const f = p('priceMin=5&priceMax=1e3&stockMin=-5&stockMax=1.5&priceMin=abc').filter;
    expect(f).toEqual({ priceMin: '5' });
    expect(p('stockMin=1;drop table x').filter).toEqual({});
    expect(p('stockMax=99999999999999999999').filter).toEqual({});
  });
  it('truncates absurdly long text instead of exploding', () => {
    expect(p('name=' + 'x'.repeat(5000)).filter.name).toHaveLength(200);
  });
  it('unknown keys are ignored', () => {
    expect(p('foo=bar&dir=desc').sort).toBeNull();
  });
});

describe('header click cycle and helpers', () => {
  it('none -> asc -> desc -> none, and a different column restarts at asc', () => {
    let s = nextSort(null, 'price');
    expect(s).toEqual({ field: 'price', dir: 'asc' });
    s = nextSort(s, 'price');
    expect(s).toEqual({ field: 'price', dir: 'desc' });
    expect(nextSort(s, 'price')).toBeNull();
    expect(nextSort({ field: 'price', dir: 'desc' }, 'name')).toEqual({
      field: 'name',
      dir: 'asc',
    });
  });
  it('queryEquals / hasActiveFilter', () => {
    expect(queryEquals(EMPTY_QUERY, { sort: null, filter: {} })).toBe(true);
    expect(queryEquals(EMPTY_QUERY, { sort: null, filter: { name: 'a' } })).toBe(false);
    expect(hasActiveFilter({})).toBe(false);
    expect(hasActiveFilter({ stockMin: 0 })).toBe(true); // 0 is a real filter, not "empty"
  });
});
