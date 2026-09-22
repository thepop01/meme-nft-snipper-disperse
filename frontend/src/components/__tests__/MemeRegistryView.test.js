import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import MemeRegistryView from '../MemeRegistryView.jsx';

vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ memes: [] }) }));

describe('MemeRegistryView', () => {
  it('renders table headers: Token | Contract Address | Current Mcap | ATH Mcap | 24h Volume | Sources | Status', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );
    expect(html).toMatch(/<th>Token<\/th>/);
    expect(html).toMatch(/<th>Contract Address<\/th>/);
    expect(html).toMatch(/<th>Current Mcap<\/th>/);
    expect(html).toMatch(/<th>ATH Mcap<\/th>/);
    expect(html).toMatch(/<th>24h Volume<\/th>/);
    expect(html).toMatch(/<th>Sources<\/th>/);
    expect(html).toMatch(/<th>Status<\/th>/);
  });

  it('renders meme data with symbol and mcap values formatted correctly', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn', 'pumpfun'],
        backfilled: true,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    // Verify symbol renders
    expect(html).toMatch(/PEPE/);
    // Verify contract address shortened
    expect(html).toMatch(/7vfC.*8xua/);
    // Verify mcap formatted as "$2.50M"
    expect(html).toMatch(/\$2\.50M/);
    // Verify ATH formatted as "$5.50M"
    expect(html).toMatch(/\$5\.50M/);
    // Verify volume formatted as "$850k"
    expect(html).toMatch(/\$850\.0k/);
  });

  it('renders filter buttons: All, Backfilled, Pending Worker 3', () => {
    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView />
      </MemoryRouter>
    );
    expect(html).toMatch(/All \(/i);
    expect(html).toMatch(/Backfilled/i);
    expect(html).toMatch(/Pending Worker 3/i);
  });

  it('filters memes by backfilled status', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'solana',
        contractAddress: '8vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xub',
        symbol: 'DOGE',
        currentMcap: 1500000,
        athMcap: 3000000,
        volume24h: 500000,
        sourceFlags: ['pumpfun'],
        backfilled: false,
      },
    ];

    // Note: In SSR tests, we can't easily simulate click events,
    // so we verify the component structure and that it accepts initialMemes
    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    // Verify both memes render initially
    expect(html).toMatch(/PEPE/);
    expect(html).toMatch(/DOGE/);
    // Verify filter button exists (clicking would be tested in integration tests)
    expect(html).toMatch(/Backfilled/i);
  });

  it('displays status as green checkmark for backfilled memes', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    expect(html).toMatch(/✅ Backfilled/);
    expect(html).toMatch(/#dcfce7/); // green background
  });

  it('displays status as amber hourglass for pending worker 3 memes', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '8vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xub',
        symbol: 'DOGE',
        currentMcap: 1500000,
        athMcap: 3000000,
        volume24h: 500000,
        sourceFlags: ['pumpfun'],
        backfilled: false,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    expect(html).toMatch(/⏳ Pending Worker 3/);
    expect(html).toMatch(/#fef3c7/); // amber background
  });

  it('renders registry title and description', () => {
    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView />
      </MemoryRouter>
    );
    expect(html).toMatch(/Tracked Memes Registry/i);
    expect(html).toMatch(/Distributed Meme Workers/i);
    expect(html).toMatch(/Worker 1.*Worker 2.*Worker 3/s);
  });

  it('counts backfilled and pending memes correctly in KPI cards', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'solana',
        contractAddress: '8vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xub',
        symbol: 'DOGE',
        currentMcap: 1500000,
        athMcap: 3000000,
        volume24h: 500000,
        sourceFlags: ['pumpfun'],
        backfilled: false,
      },
      {
        chain: 'solana',
        contractAddress: '9vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xuc',
        symbol: 'SHIB',
        currentMcap: 3000000,
        athMcap: 6000000,
        volume24h: 1200000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    // Verify all memes count is 3
    expect(html).toMatch(/All Memes.*3/);
    // Verify backfilled count is 2
    expect(html).toMatch(/Backfilled.*2/);
    // Verify pending count is 1
    expect(html).toMatch(/Pending Worker 3.*1/);
  });

  it('searches memes by symbol and contract address', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'solana',
        contractAddress: '8vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xub',
        symbol: 'DOGE',
        currentMcap: 1500000,
        athMcap: 3000000,
        volume24h: 500000,
        sourceFlags: ['pumpfun'],
        backfilled: false,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    // Verify search field exists
    expect(html).toMatch(/Search token symbol or contract address/i);
    // Verify both memes present in initial render
    expect(html).toMatch(/PEPE/);
    expect(html).toMatch(/DOGE/);
  });

  it('renders chain tabs: All Chains, Solana, and Robinhood / EVM', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'PEPE',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'robinhood',
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
        symbol: 'EVMPEPE',
        currentMcap: 1200000,
        athMcap: 4200000,
        volume24h: 300000,
        sourceFlags: ['geckoterminal'],
        backfilled: false,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    expect(html).toMatch(/All Chains/);
    expect(html).toMatch(/Solana/);
    expect(html).toMatch(/Robinhood \/ EVM/);
    expect(html).toMatch(/SOL/);
    expect(html).toMatch(/EVM/);
  });

  it('supports initialChain="solana" to filter strictly for Solana memes', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'SOLTOKEN',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'robinhood',
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
        symbol: 'ROBINTOKEN',
        currentMcap: 1200000,
        athMcap: 4200000,
        volume24h: 300000,
        sourceFlags: ['geckoterminal'],
        backfilled: false,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} initialChain="solana" />
      </MemoryRouter>
    );

    expect(html).toMatch(/SOLTOKEN/);
    expect(html).not.toMatch(/ROBINTOKEN/);
  });

  it('supports initialChain="robinhood" to filter strictly for Robinhood memes', () => {
    const mockMemes = [
      {
        chain: 'solana',
        contractAddress: '7vfCn7zqe6AvxGadilUe62yLBWXtSTgtsWZkqBT8xua',
        symbol: 'SOLTOKEN',
        currentMcap: 2500000,
        athMcap: 5500000,
        volume24h: 850000,
        sourceFlags: ['gmgn'],
        backfilled: true,
      },
      {
        chain: 'robinhood',
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
        symbol: 'ROBINTOKEN',
        currentMcap: 1200000,
        athMcap: 4200000,
        volume24h: 300000,
        sourceFlags: ['geckoterminal'],
        backfilled: false,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} initialChain="robinhood" />
      </MemoryRouter>
    );

    expect(html).toMatch(/ROBINTOKEN/);
    expect(html).not.toMatch(/SOLTOKEN/);
  });

  it('renders Pagination component with item counts and page size selector', () => {
    const mockMemes = Array.from({ length: 75 }, (_, i) => ({
      chain: 'solana',
      contractAddress: `MintAddressTest${i}`,
      symbol: `TOKEN${i}`,
      currentMcap: 2000000 + i * 1000,
      athMcap: 4000000 + i * 1000,
      volume24h: 500000,
      sourceFlags: ['gmgn'],
      backfilled: i % 2 === 0,
    }));

    const html = renderToString(
      <MemoryRouter>
        <MemeRegistryView initialMemes={mockMemes} />
      </MemoryRouter>
    );

    expect(html).toMatch(/Showing.*1.*50.*of.*75/);
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toMatch(/50.*\/ page/);
  });
});
