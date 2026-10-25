import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the heading', () => {
    expect(renderToString(<App />)).toContain('<h1>Rowing Conditions</h1>');
  });
});
