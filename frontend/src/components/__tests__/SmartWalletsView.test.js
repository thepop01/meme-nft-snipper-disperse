import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import SmartWalletsView from '../SmartWalletsView.jsx';
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ wallets: [] }) }));
describe('SmartWalletsView', () => {
  it('renders tier rules and both-chain copy', () => {
    const html = renderToString(<SmartWalletsView />);
    expect(html).toMatch(/Early-buyer tiers/);
    expect(html).toMatch(/Solana \+ Robinhood/);
  });
});
