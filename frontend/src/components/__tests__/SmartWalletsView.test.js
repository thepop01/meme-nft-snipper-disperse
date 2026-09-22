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

  it('renders all 5 category tables and actions (Smart, Tracked, Whale, Lineage, Snipers & Bundlers)', () => {
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
    expect(html).toMatch(/Snipers &amp; Bundlers/i);
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
    expect(html).toMatch(/<th>ROI<\/th>/);
    expect(html).toMatch(/<th>Capture Ratio<\/th>/);
    expect(html).toMatch(/<th>Round-Trip<\/th>/);
    expect(html).toMatch(/<th>Sold &gt;50% ATH<\/th>/);
    expect(html).toMatch(/<th>(?:&ge;|≥)\$2M Hit Rate<\/th>/);
    expect(html).toMatch(/<th>Watermark<\/th>/);

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
    expect(html).toMatch(/<th>Balance<\/th>/);
    expect(html).toMatch(/<th>PnL<\/th>/);
    expect(html).toMatch(/<th>Win Rate<\/th>/);
    expect(html).toMatch(/<th>Buy\/Win<\/th>/);
    expect(html).toMatch(/<th>Avg Buy Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Sell Mcap<\/th>/);
    expect(html).toMatch(/<th>Avg Holding Time<\/th>/);
    expect(html).toMatch(/<th>ROI<\/th>/);
    expect(html).toMatch(/<th>Capture Ratio<\/th>/);
    expect(html).toMatch(/<th>Round-Trip<\/th>/);
    expect(html).toMatch(/<th>Sold &gt;50% ATH<\/th>/);
    expect(html).toMatch(/<th>(?:&ge;|≥)\$2M Hit Rate<\/th>/);
    expect(html).toMatch(/<th>Watermark<\/th>/);

    // Verify execution metrics and early buyer badge in tracked view
    expect(html).toMatch(/\+\$1\.2k/);
    expect(html).toMatch(/75\.0.*%/);
    expect(html).toMatch(/3.*won/);
    expect(html).toMatch(/\$180\.0k/);
    expect(html).toMatch(/30m/); // 1800s = 30m
    expect(html).toMatch(/Early.*#2.*PEPE2/);
    expect(html).toMatch(/Promote/);
  });

  it('renders advanced execution metrics values and fallbacks (Capture Ratio, Round-Trip, Sold >50% ATH, Hit Rate, Watermark, ROI)', () => {
    const mockWallets = [
      {
        address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        chain: 'solana',
        category: 'smart',
        realizedProfitUsd: 4500,
        roiPct: 185.4,
        winRatePct: 70,
        captureRatioPct: 84.5,
        roundTripRatePct: 11.2,
        soldAbove50AthPct: 62.8,
        tokensTradedGt2m: 4,
        tokensTradedLt2m: 1,
        hitRateGt2mPct: 80,
        lastProcessedTxSignature: '5K3jG1Z9abcd9XzA',
        lastProcessedTimestamp: Date.now() - 3600000, // 1h ago
      },
      {
        address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP',
        chain: 'solana',
        category: 'smart',
        realizedProfitUsd: 1200,
        roiPct: null,
        winRatePct: 50,
        captureRatioPct: null,
        roundTripRatePct: null,
        soldAbove50AthPct: null,
        tokensTradedGt2m: null,
        tokensTradedLt2m: null,
        hitRateGt2mPct: null,
        lastProcessedTxSignature: null,
        lastProcessedTimestamp: null,
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockWallets} />
        </ToastProvider>
      </MemoryRouter>
    );

    // Verify populated metrics for wallet 1
    expect(html).toMatch(/\+185\.4%/); // ROI %
    expect(html).toMatch(/84\.5%/);    // Capture ratio %
    expect(html).toMatch(/11\.2%/);    // Round-trip %
    expect(html).toMatch(/62\.8%/);    // Sold >50% ATH %
    expect(html).toMatch(/4.*\/.*5/);  // Traded tokens ≥$2M ratio
    expect(html).toMatch(/80%/);       // Hit rate %
    expect(html).toMatch(/5K3j.*9XzA/); // Watermark tx signature

    // Verify fallback dashes render for wallet 2 without errors
    expect(html).toMatch(/—/);
  });

  it('renders streamlined action controls and external inspection links (GMGN)', () => {
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

    // Verify streamlined header action buttons
    expect(html).toMatch(/Add Whale Wallet/);
    expect(html).toMatch(/Connect Lineage Wallet/);
    expect(html).not.toMatch(/Scan Solana/);
    expect(html).not.toMatch(/FOMO\.family/);

    // Verify external inspection links
    expect(html).toMatch(/gmgn\.ai\/sol\/address\/5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1/);
    expect(html).not.toMatch(/axiom\.trade/);
    expect(html).not.toMatch(/intel\.arkm\.com/);
    expect(html).not.toMatch(/app\.nansen\.ai/);
  });

  it('renders category-tailored subfilters for tracked wallets (Early Buyers, Top Runners, Snipers, Profitable, KOL)', () => {
    const mockTracked = [
      {
        address: '8ZN71XTdVo8yRovnGLmNgW3Tgniw6A4J3JGLvPD686FP',
        chain: 'solana',
        category: 'tracked',
        earlyBuyerInfo: { rank: 1, symbol: 'PEPE', athMcap: 25000000 },
        realizedProfitUsd: 1500,
        tags: ['early_buyer', 'runner_20m', 'kol'],
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockTracked} initialCategory="tracked" />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toMatch(/🚀 Early Buyers/);
    expect(html).toMatch(/💎 &gt;\$10M Runners/);
    expect(html).toMatch(/⚡ Snipers &amp; Alpha/);
    expect(html).toMatch(/💰 Profitable/);
    expect(html).toMatch(/📢 KOL \/ Callers/);
  });

  it('renders sniper tab with sniper badges and metrics', () => {
    const mockSniperWallets = [
      {
        address: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SEZ2v',
        chain: 'solana',
        category: 'sniper',
        realizedProfitUsd: 15400,
        winRatePct: 82.5,
        profitableTrades: 10,
        totalTrades: 12,
        tokenNum: 12,
        balanceUsd: 6200,
        tags: ['sniper', 'madeonsol_sniper', 'rank_1_buyer', 'alpha_buyer', 'kol'],
        flags: { is_sniper: true },
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockSniperWallets} initialCategory="sniper" />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toMatch(/5\. Snipers &amp; Bundlers/);
    expect(html).toMatch(/⚡ Sniper/);
    expect(html).toMatch(/🎯 Rank 1 Buyer/);
    expect(html).toMatch(/🚀 Alpha Early Buyer/);
    expect(html).toMatch(/📢 KOL Caller/);
    expect(html).toMatch(/\+\$15\.4k/);
    expect(html).toMatch(/82\.5.*%/);
  });

  it('renders Pagination component with item counts and page size selector', () => {
    const mockWallets = Array.from({ length: 80 }, (_, i) => ({
      address: `So1111111111111111111111111111111111111111${i.toString().padStart(2, '0')}`,
      chain: 'solana',
      category: 'smart',
      realizedProfitUsd: 1000 + i * 10,
      winRatePct: 60,
      openTrades: 5,
    }));

    const html = renderToString(
      <MemoryRouter>
        <ToastProvider>
          <SmartWalletsView initialWallets={mockWallets} />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(html).toMatch(/Showing.*1.*50.*of.*80/);
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toMatch(/50.*\/ page/);
  });
});
