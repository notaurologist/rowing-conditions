import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UnitToggle } from './UnitToggle.tsx';

describe('UnitToggle', () => {
  it('marks the current system with aria-pressed and a check mark', () => {
    const html = renderToStaticMarkup(<UnitToggle units="metric" onChange={() => {}} />);
    expect(html).toMatch(/aria-pressed="false"[^>]*>US</);
    expect(html).toMatch(/aria-pressed="true"[^>]*><span aria-hidden="true">✓ <\/span>Metric/);
  });
});
