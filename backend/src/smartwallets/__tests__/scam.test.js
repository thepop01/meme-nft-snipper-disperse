import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { traceLineage, isDevSellEvent, recordScamMeme, getScamMemes } from '../scam.js';
import { createSmartWalletsRouter } from '../routes.js';
import { listAlerts } from '../../alerts.js';

describe('Scam Meme & Dev Sell System', () => {
  it('traceLineage finds parent and child relationships up to 3 hops', () => {
    const wallets = [
      { address: 'child_1', lineageParent: 'dev_root' },
      { address: 'child_2', lineageParent: 'child_1' },
      { address: 'child_3', lineageParent: 'child_2' },
      { address: 'child_4', lineageParent: 'child_3' }, // hop 4 (exceeds max 3)
      { address: 'unrelated', lineageParent: 'other_wallet' },
    ];

    const lineage = traceLineage('dev_root', wallets, 3);
    expect(lineage.length).toBe(3);
    expect(lineage.map(l => l.address)).toEqual(['child_1', 'child_2', 'child_3']);
    expect(lineage[0].hop).toBe(1);
    expect(lineage[1].hop).toBe(2);
    expect(lineage[2].hop).toBe(3);
  });

  it('isDevSellEvent detects when dev or deployer sells', () => {
    const token = {
      mint: 'meme123',
      devWallet: 'dev_address_xyz',
      deployer: 'deployer_abc',
    };

    expect(isDevSellEvent({ event_type: 'sell', wallet: 'dev_address_xyz' }, token)).toBe(true);
    expect(isDevSellEvent({ event_type: 'sell', wallet: 'deployer_abc' }, token)).toBe(true);
    // Buy by dev is not a dev dump
    expect(isDevSellEvent({ event_type: 'buy', wallet: 'dev_address_xyz' }, token)).toBe(false);
    // Sell by random trader is not dev dump
    expect(isDevSellEvent({ event_type: 'sell', wallet: 'random_trader' }, token)).toBe(false);
  });

  it('recordScamMeme marks coin, alerts, flags dev & lineage, and scores early wallets', async () => {
    let untrackedMint = null;
    let discardedMint = null;

    const dev = 'dev_wallet_111';
    const earlyLoser = 'early_loser_222';
    const earlyWinner = 'early_winner_333';

    const res = await recordScamMeme({
      mint: 'scam_mint_999',
      chain: 'solana',
      symbol: 'RUGCOIN',
      devWallet: dev,
      sellTx: 'tx_dump_123',
      sellAmount: 50000000,
      sellPriceUsd: 12000,
      athMcap: 850000,
      earlyBuys: [
        { address: earlyLoser, isProfitable: false, pnlUsd: -500 },
        { address: earlyWinner, isProfitable: true, pnlUsd: 1500 },
      ],
      untrackFn: m => { untrackedMint = m; },
      discardTokenFn: (m, r) => { discardedMint = m; },
    });

    expect(res.success).toBe(true);
    expect(untrackedMint).toBe('scam_mint_999');
    expect(discardedMint).toBe('scam_mint_999');
    expect(res.devWallet).toBe(dev);
    expect(res.earlyPenalizedCount).toBe(1);
    expect(res.earlySusCount).toBe(1);

    // Verify alert was created
    const alerts = listAlerts();
    const alert = alerts.find(a => a.type === 'scam:dev-sell' && a.title.includes('RUGCOIN'));
    expect(alert).toBeDefined();
    expect(alert.severity).toBe('critical');

    // Verify scam memes retrieval
    const memes = await getScamMemes();
    const meme = memes.find(m => m.mint === 'scam_mint_999');
    expect(meme).toBeDefined();
    expect(meme.symbol).toBe('RUGCOIN');
    expect(meme.devWallet).toBe(dev);
  });
});

describe('Scam API endpoints', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/smart-wallets', createSmartWalletsRouter());
    return a;
  };

  it('POST /api/smart-wallets/scam/detect creates scam meme and assigns points', async () => {
    const res = await request(app())
      .post('/api/smart-wallets/scam/detect')
      .send({
        mint: 'api_scam_mint_1',
        chain: 'solana',
        symbol: 'DUMP',
        devWallet: 'api_dev_wallet_1',
        sellTx: 'dump_tx_99',
        earlyBuys: [
          { address: 'rekt_buyer_1', isProfitable: false },
          { address: 'sus_buyer_1', isProfitable: true },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.earlyPenalizedCount).toBe(1);
    expect(res.body.earlySusCount).toBe(1);
  });

  it('GET /api/smart-wallets/scam/memes returns recorded scam memes', async () => {
    const res = await request(app()).get('/api/smart-wallets/scam/memes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.memes)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/smart-wallets/scam/wallets returns flagged scam and sus wallets', async () => {
    const res = await request(app()).get('/api/smart-wallets/scam/wallets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.wallets)).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.retardPointsTotal).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.susPointsTotal).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/smart-wallets returns qualification rules with 5 open trades and > $100 PnL', async () => {
    const res = await request(app()).get('/api/smart-wallets');
    expect(res.status).toBe(200);
    expect(res.body.qualificationRules).toEqual({
      minOpenTrades: 5,
      minPnlUsd: 100,
      lookbackDays: 120,
    });
  });
});
