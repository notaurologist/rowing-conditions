import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Intro } from './Intro.tsx';

const render = (firstUse = true) =>
  renderToStaticMarkup(<Intro firstUse={firstUse} onContinue={() => {}} />);

// The visible text, with tags removed and apostrophes decoded.
const text = () =>
  render()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('Intro', () => {
  it('says what the app does and does not do, and gives the disclaimer', () => {
    const visible = text();
    expect(visible).toContain('What it does');
    expect(visible).toContain("What it doesn't do");
    expect(visible).toContain('Disclaimer');
    expect(visible).toContain('without warranty');
  });

  it('describes hours as within, outside, or unknown, and never as safe', () => {
    const visible = text();
    expect(visible).toContain('within your limits, outside them, or unknown');
    // "safe" appears only in the sentence that says the app doesn't judge it.
    const safe = visible.match(/[^.]*\bsafe\b[^.]*\./g) ?? [];
    expect(safe).toEqual([expect.stringContaining("doesn't say whether conditions are safe")]);
    expect(visible).not.toMatch(/\bunsafe\b|good to go|recommended/i);
  });

  it('labels the button Continue on first use and Close afterwards', () => {
    expect(render(true)).toContain('>Continue</button>');
    expect(render(false)).toContain('>Close</button>');
  });
});
