import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import MemeRegistryView from '../MemeRegistryView.jsx';

vi.mock('../../utils/sniperApi', () => ({
  getBackendUrl: () => 'http://localhost:3001',
}));

describe('MemeRegistryView', () => {
  it('renders tracked memes table headers and rows', () => {
    const mockMemes = [
      {
        ca: 'MintX11111111111111111111111111111111111111',
        name: 'AlphaToken',
        symbol: 'ALPHA',
        currentMcap: 2500000,
        athMcap: 5000000,
        volume24hUsd: 800000,
        sourceFlags: ['current_gt_2m', 'ath_gt_4m'],
        backfilled: true,
      },
    ];

    const html = renderToString(<MemeRegistryView initialMemes={mockMemes} />);
    expect(html).toMatch(/Tracked Memes Registry/);
    expect(html).toMatch(/ALPHA/);
    expect(html).toMatch(/\$2\.50M/);
    expect(html).toMatch(/\$5\.00M/);
  });

  it('displays filter buttons', () => {
    const mockMemes = [
      {
        ca: 'Mint1',
        name: 'Token1',
        symbol: 'T1',
        currentMcap: 2000000,
        athMcap: 4000000,
        volume24hUsd: 500000,
        sourceFlags: [],
        backfilled: true,
      },
      {
        ca: 'Mint2',
        name: 'Token2',
        symbol: 'T2',
        currentMcap: 3000000,
        athMcap: 6000000,
        volume24hUsd: 600000,
        sourceFlags: [],
        backfilled: false,
      },
    ];

    const html = renderToString(<MemeRegistryView initialMemes={mockMemes} />);
    expect(html).toMatch(/All/);
    expect(html).toMatch(/Backfilled/);
    expect(html).toMatch(/Pending Worker 3/);
  });

  it('shows status badge for backfilled tokens', () => {
    const mockMemes = [
      {
        ca: 'Mint1',
        name: 'Token1',
        symbol: 'T1',
        currentMcap: 2000000,
        athMcap: 4000000,
        volume24hUsd: 500000,
        sourceFlags: [],
        backfilled: true,
      },
    ];

    const html = renderToString(<MemeRegistryView initialMemes={mockMemes} />);
    expect(html).toMatch(/Backfilled/);
  });

  it('shows status badge for pending tokens', () => {
    const mockMemes = [
      {
        ca: 'Mint1',
        name: 'Token1',
        symbol: 'T1',
        currentMcap: 2000000,
        athMcap: 4000000,
        volume24hUsd: 500000,
        sourceFlags: [],
        backfilled: false,
      },
    ];

    const html = renderToString(<MemeRegistryView initialMemes={mockMemes} />);
    expect(html).toMatch(/Pending/);
  });

  it('displays source flags', () => {
    const mockMemes = [
      {
        ca: 'Mint1',
        name: 'Token1',
        symbol: 'T1',
        currentMcap: 2000000,
        athMcap: 4000000,
        volume24hUsd: 500000,
        sourceFlags: ['current_gt_2m', 'ath_gt_4m'],
        backfilled: true,
      },
    ];

    const html = renderToString(<MemeRegistryView initialMemes={mockMemes} />);
    expect(html).toMatch(/current_gt_2m/);
    expect(html).toMatch(/ath_gt_4m/);
  });

  it('handles empty meme list', () => {
    const html = renderToString(<MemeRegistryView initialMemes={[]} />);
    expect(html).toMatch(/No memes found/);
  });
});
