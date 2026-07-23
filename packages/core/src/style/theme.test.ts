import { beforeAll, describe, expect, it } from 'vitest';
import { applyTheme, toCssVar } from './theme.js';
import { DARK_PARAMS, LIGHT_PARAMS } from './themes.js';

// jsdom gap shim: in browsers CSSStyleDeclaration is a WebIDL value iterator
// (indexed getter + length), so `[...el.style]` — used by applyTheme — works.
// jsdom's cssstyle implements length/item() but not Symbol.iterator, so we
// provide the spec behavior here for the tests.
beforeAll(() => {
  const proto = CSSStyleDeclaration.prototype as unknown as Record<symbol, unknown>;
  if (!proto[Symbol.iterator]) {
    proto[Symbol.iterator] = function* (this: CSSStyleDeclaration) {
      for (let i = 0; i < this.length; i++) yield this.item(i);
    };
  }
});

describe('toCssVar', () => {
  it('converts camelCase params to --au- kebab-case', () => {
    expect(toCssVar('accentColor')).toBe('--au-accent-color');
    expect(toCssVar('rowHeight')).toBe('--au-row-height');
    expect(toCssVar('selectedRowBackgroundColor')).toBe('--au-selected-row-background-color');
  });

  it('handles single words and digits', () => {
    expect(toCssVar('spacing')).toBe('--au-spacing');
    expect(toCssVar('level2Color')).toBe('--au-level2-color');
  });
});

describe('applyTheme', () => {
  it('applies light base params as inline --au-* variables by default', () => {
    const el = document.createElement('div');
    applyTheme(el, undefined);
    expect(el.style.getPropertyValue('--au-background-color')).toBe(LIGHT_PARAMS.backgroundColor);
    expect(el.style.getPropertyValue('--au-accent-color')).toBe(LIGHT_PARAMS.accentColor);
    expect(el.hasAttribute('data-au-color-scheme')).toBe(false);
  });

  it('user params override the base set', () => {
    const el = document.createElement('div');
    applyTheme(el, { params: { accentColor: '#123456', myCustomThing: '9px' } });
    expect(el.style.getPropertyValue('--au-accent-color')).toBe('#123456');
    expect(el.style.getPropertyValue('--au-my-custom-thing')).toBe('9px');
    expect(el.style.getPropertyValue('--au-background-color')).toBe(LIGHT_PARAMS.backgroundColor);
  });

  it('dark scheme sets the attribute and dark base params', () => {
    const el = document.createElement('div');
    applyTheme(el, { colorScheme: 'dark' });
    expect(el.getAttribute('data-au-color-scheme')).toBe('dark');
    expect(el.style.getPropertyValue('--au-background-color')).toBe(DARK_PARAMS.backgroundColor);
    expect(el.style.getPropertyValue('--au-foreground-color')).toBe(DARK_PARAMS.foregroundColor);
  });

  it('auto scheme sets the attribute but keeps light base params inline', () => {
    const el = document.createElement('div');
    applyTheme(el, { colorScheme: 'auto' });
    expect(el.getAttribute('data-au-color-scheme')).toBe('auto');
    expect(el.style.getPropertyValue('--au-background-color')).toBe(LIGHT_PARAMS.backgroundColor);
  });

  it('density scales the sizing variables', () => {
    const el = document.createElement('div');
    applyTheme(el, { density: 'compact' });
    expect(el.style.getPropertyValue('--au-row-height')).toBe('26px'); // round(32 * 0.8)
    expect(el.style.getPropertyValue('--au-header-height')).toBe('29px'); // round(36 * 0.8)
    expect(el.style.getPropertyValue('--au-cell-horizontal-padding')).toBe('10px');

    applyTheme(el, { density: 'comfortable' });
    expect(el.style.getPropertyValue('--au-row-height')).toBe('40px'); // round(32 * 1.25)

    applyTheme(el, { density: 'normal' });
    expect(el.style.getPropertyValue('--au-row-height')).toBe('');
  });

  it('explicit rowHeight param wins over density defaults', () => {
    const el = document.createElement('div');
    applyTheme(el, { density: 'compact', params: { rowHeight: '99px' } });
    expect(el.style.getPropertyValue('--au-row-height')).toBe('99px');
  });

  it('re-applying clears previous inline vars and scheme attribute', () => {
    const el = document.createElement('div');
    applyTheme(el, { colorScheme: 'dark', params: { myVar: '1px' } });
    expect(el.style.getPropertyValue('--au-my-var')).toBe('1px');
    applyTheme(el, { colorScheme: 'light' });
    expect(el.style.getPropertyValue('--au-my-var')).toBe('');
    expect(el.hasAttribute('data-au-color-scheme')).toBe(false);
    expect(el.style.getPropertyValue('--au-background-color')).toBe(LIGHT_PARAMS.backgroundColor);
    // non-theme inline styles survive
    const el2 = document.createElement('div');
    el2.style.setProperty('width', '10px');
    applyTheme(el2, undefined);
    expect(el2.style.getPropertyValue('width')).toBe('10px');
  });
});
