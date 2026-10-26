import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaceResults, type PlaceResultsState } from './PlaceSearch.tsx';

const render = (state: PlaceResultsState) =>
  renderToStaticMarkup(<PlaceResults state={state} onPick={() => {}} />);

const turnersFalls = {
  name: 'Turners Falls',
  displayName: 'Turners Falls, Montague, Franklin County, Massachusetts, 01376, United States',
  lat: 42.6083091,
  lon: -72.5567883,
};

describe('PlaceResults', () => {
  it('shows nothing before a search', () => {
    expect(render({ status: 'idle' })).toBe('');
  });

  it('shows a loading state', () => {
    expect(render({ status: 'loading' })).toContain('Searching');
  });

  it('shows an error, distinct from no results', () => {
    const html = render({ status: 'error', message: 'Place search is turned off.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Place search is turned off.');
    expect(html).not.toContain('No places found');
  });

  it('says when nothing matched', () => {
    expect(render({ status: 'ready', query: 'qqzz', places: [] })).toContain(
      'No places found for “qqzz”',
    );
  });

  it('lists places as buttons with their full names', () => {
    const html = render({ status: 'ready', query: 'Turners Falls', places: [turnersFalls] });
    expect(html).toMatch(/<button type="button">.*Turners Falls<\/span>/);
    expect(html).toContain('Franklin County, Massachusetts');
  });

  it('credits OpenStreetMap with the results', () => {
    const html = render({ status: 'ready', query: 'x', places: [] });
    expect(html).toMatch(/Data © <a [^>]*>OpenStreetMap contributors<\/a>/);
    expect(html).toContain('https://www.openstreetmap.org/copyright');
  });
});
