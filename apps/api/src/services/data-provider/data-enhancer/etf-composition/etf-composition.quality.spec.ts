import {
  compositionQuality,
  improvesComposition,
  needsComposition
} from './etf-composition.quality';

describe('independent composition quality', () => {
  const partial = [{ name: 'Energy', weight: 0.4 }];
  const complete = [{ name: 'Technology', weight: 1 }];
  it('replaces incomplete sectors with better coverage', () => {
    expect(improvesComposition(partial, complete, 'sectors')).toBe(true);
  });
  it('preserves complete data irrespective of category count', () => {
    expect(improvesComposition(complete, partial, 'sectors')).toBe(false);
    expect(needsComposition(complete, 'sectors')).toBe(false);
  });
  it('does not count Other as classified coverage', () => {
    expect(needsComposition([{ name: 'Other', weight: 1 }], 'sectors')).toBe(
      true
    );
    expect(
      improvesComposition(partial, [{ name: 'Other', weight: 1 }], 'sectors')
    ).toBe(false);
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid weight %s', (weight) => {
    expect(
      compositionQuality([{ code: 'US', weight }], 'countries').valid
    ).toBe(false);
  });
  it('rejects duplicate categories and unsupported codes', () => {
    expect(
      compositionQuality(
        [
          { code: 'US', weight: 0.4 },
          { code: 'US', weight: 0.4 }
        ],
        'countries'
      ).valid
    ).toBe(false);
    expect(
      compositionQuality([{ code: 'XX', weight: 1 }], 'countries').valid
    ).toBe(false);
  });
  it('can improve countries while preserving complete sectors', () => {
    expect(
      improvesComposition(
        [{ code: 'US', weight: 0.5 }],
        [{ code: 'US', weight: 0.9 }],
        'countries'
      )
    ).toBe(true);
    expect(improvesComposition(complete, partial, 'sectors')).toBe(false);
  });
});
