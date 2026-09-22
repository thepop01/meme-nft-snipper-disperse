import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App.jsx';

vi.stubGlobal('fetch', async () => ({
  ok: true,
  json: async () => ({ wallets: [], memes: [], directory: { wallets: [], tags: [] } }),
}));

describe('App Keep-Alive Layout', () => {
  it('renders smart-wallets workspace inside persistent container when navigating to /smart-wallets', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/smart-wallets']}>
        <App />
      </MemoryRouter>
    );

    expect(html).toContain('tab-workspaces');
    expect(html).toMatch(/class="tab-workspace"\s+style="display:block;width:100%"/);
    expect(html).toMatch(/class="umi-nav-link active"\s+href="\/smart-wallets"/);
    expect(html).toMatch(/style="display:none;width:100%"/);
  });

  it('renders tracked-memes workspace inside persistent container when navigating to /tracked-memes', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/tracked-memes']}>
        <App />
      </MemoryRouter>
    );

    expect(html).toContain('tab-workspaces');
    expect(html).toMatch(/class="tab-workspace"\s+style="display:block;width:100%"/);
    expect(html).toMatch(/class="umi-nav-link active"\s+href="\/tracked-memes"/);
    expect(html).toMatch(/style="display:none;width:100%"/);
  });

  it('renders dashboard workspace inside persistent container when navigating to /dashboard', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

    expect(html).toContain('tab-workspaces');
    expect(html).toMatch(/class="tab-workspace"\s+style="display:block;width:100%"/);
    expect(html).toMatch(/class="umi-nav-link active"\s+href="\/dashboard"/);
    expect(html).toMatch(/style="display:none;width:100%"/);
  });

  it('renders auxiliary routes in the standard container when navigating to /activity', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/activity']}>
        <App />
      </MemoryRouter>
    );

    expect(html).toContain('tab-workspaces');
    expect(html).toMatch(/class="umi-nav-link active"\s+href="\/activity"/);
    expect(html).toMatch(/style="display:block;width:100%"/);
  });
});
