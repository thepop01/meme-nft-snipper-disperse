import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import SmartWalletsView from '../SmartWalletsView.jsx';
import { ToastProvider } from '../ui/Toast.jsx';

vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ wallets: [] }) }));

describe('SmartWalletsView', () => {
  it('renders tier rules and both-chain copy', () => {
    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(html).toMatch(/Classification Rules/i);
    expect(html).toMatch(/Solana/i);
    expect(html).toMatch(/Robinhood/i);
  });

  it('renders all 4 category tables and actions (Smart, Tracked, Whale, Lineage)', () => {
    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(html).toMatch(/Smart Wallets/i);
    expect(html).toMatch(/Tracked Wallets/i);
    expect(html).toMatch(/Whale Wallets/i);
    expect(html).toMatch(/Lineage Wallets/i);
    expect(html).toMatch(/Add Whale Wallet/i);
    expect(html).toMatch(/Connect Lineage Wallet/i);
  });

  it('renders streamlined 7-column headers in smart wallets table (no ATH bracket columns)', () => {
    const mockWallets = [
      {
        address: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        category: 'smart',
        openTrades: 6,
        realizedProfitUsd: 500,
        winRatePct: 65,
        profitableTrades: 4,
        totalTrades: 6,
        tokenNum: 6,
        avgBuyPrice: 0.00045,
        avgBuyMcap: 220000,
        avgSellPrice: 0.0012,
        avgHoldingTimeSec: 3600,
        methods: ['buying_mcap', 'first_n_buyers'],
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockWallets} />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(html).toMatch(/<th>Wallet Address<\/th>/);
    expect(html).toMatch(/<th>PnL<\/th>/);
    expect(html).toMatch(/<th>Win Rate<\/th>/);
    expect(html).toMatch(/<th>Buy\/Win<\/th>/);
    expect(html).toMatch(/<th>Avg Buy Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Sell Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Holding Time<\/th>/);

    // Verify old Ath bracket columns are removed
    expect(html).not.toMatch(/Ath - 500k/);
    expect(html).not.toMatch(/Ath - 1M/);
    expect(html).not.toMatch(/Ath - 5M/);
    expect(html).not.toMatch(/Ath - 10M/);
    expect(html).not.toMatch(/Ath - &gt;50M/);

    // Verify execution metric values render
    expect(html).toMatch(/\$220\.0k/);
    expect(html).toMatch(/1\.0h/); // 3600s = 1.0h
    expect(html).toMatch(/Mcap ≤25% \+ First N/); // Dual method badge
  });

  it('renders streamlined 7-column layout and execution metrics for tracked wallets', () => {
    const mockTrackedWallets = [
      {
        address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP',
        chain: 'solana',
        category: 'tracked',
        realizedProfitUsd: 1200,
        winRatePct: 75,
        profitableTrades: 3,
        totalTrades: 4,
        tokenNum: 4,
        avgBuyPrice: 0.00035,
        avgBuyMcap: 180000,
        avgSellPrice: 0.00095,
        avgHoldingTimeSec: 1800,
        methods: ['buying_mcap'],
        earlyBuyerInfo: { rank: 2, symbol: 'PEPE2', athMcap: 1500000 },
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockTrackedWallets} initialCategory="tracked" />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toMatch(/<th>Wallet Address<\/th>/);
    expect(html).toMatch(/<th>PnL<\/th>/);
    expect(html).toMatch(/<th>Win Rate<\/th>/);
    expect(html).toMatch(/<th>Buy\/Win<\/th>/);
    expect(html).toMatch(/<th>Avg Buy Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Sell Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Holding Time<\/th>/);

    // Verify execution metrics and early buyer badge in tracked view
    expect(html).toMatch(/\+\$1\.2k/);
    expect(html).toMatch(/75\.0.*%/);
    expect(html).toMatch(/3.*won/);
    expect(html).toMatch(/\$180\.0k/);
    expect(html).toMatch(/30m/); // 1800s = 30m
    expect(html).toMatch(/Early.*#2.*PEPE2/);
    expect(html).toMatch(/Promote/);
  });

  it('renders multi-source scan selector and external inspection links (GMGN)', () => {
    const mockWallets = [
      {
        address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        chain: 'solana',
        category: 'smart',
        realizedProfitUsd: 2500,
        winRatePct: 80,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockWallets} />
        </ToastProvider>
      </MemoryRouter>
    );

    // Verify source selector options
    expect(html).toMatch(/GMGN \(Multi-chain\)/);
    expect(html).toMatch(/FOMO\.family \(Solana\)/);
    expect(html).toMatch(/Kolscan \(Solana\)/);
    expect(html).toMatch(/Nock Scout \(Solana\)/);

    // Verify external inspection links
    expect(html).toMatch(/gmgn\.ai\/sol\/address\/5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1/);
    expect(html).not.toMatch(/axiom\.trade/);
    expect(html).not.toMatch(/intel\.arkm\.com/);
    expect(html).not.toMatch(/app\.nansen\.ai/);
  });
});
