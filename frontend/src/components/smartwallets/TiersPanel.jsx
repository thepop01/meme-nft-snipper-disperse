import React from 'react';
import { Crown, GitFork, Award, Target } from 'lucide-react';

export function TiersPanel() {
  return (
    <div className="panel" style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111827' }}>
        Database Architecture &amp; 4-Category System Rules
      </h3>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.25rem' }}>
        How wallets are categorized in PostgreSQL and the JSON store, and the exact rules for Smart, Tracked, Whale, and Lineage classification.
      </p>

      {/* Section 1: Whale Wallet Criteria */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#854d0e', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Crown size={15} color="#eab308" /> 1. Whale Wallet Threshold
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#713f12', marginBottom: '0.6rem' }}>
          Wallets qualify as <strong>Whales</strong> if they satisfy either condition on Solana or Robinhood:
        </p>
        <ul style={{ fontSize: '0.82rem', color: '#854d0e', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li><strong>Meme Coin Holdings:</strong> Holds meme tokens valued at <strong>&gt; $5,000 USD</strong>.</li>
          <li><strong>Native / Total Balance:</strong> Has a wallet balance of <strong>&gt; $5,000 USD</strong>.</li>
        </ul>
      </div>

      {/* Section 2: Lineage Hierarchy */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '6px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#5b21b6', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <GitFork size={15} color="#8b5cf6" /> 2. Lineage Wallet Hierarchy
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#4c1d95', marginBottom: '0.6rem' }}>
          Sub-wallets funded by Whales or Smart Wallets to mask snipes and volume:
        </p>
        <ul style={{ fontSize: '0.82rem', color: '#5b21b6', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li>When a known Whale or Smart Wallet transfers funds, the recipient is categorized as a <strong>Lineage Wallet</strong>.</li>
          <li>Preserves parent link, transferred amount, and on-chain funding transaction.</li>
          <li>Can be promoted to Smart Wallet upon achieving independent track records.</li>
        </ul>
      </div>

      {/* Section 3: Smart Wallet Rules */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#eef2ff', border: '1px solid #e0e7ff', borderRadius: '6px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#3730a3', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Award size={15} color="#6366f1" /> 3. Smart Wallet Qualification Standard
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#312e81', marginBottom: '0.6rem' }}>
          To qualify as a verified <strong>Smart Wallet</strong>, an address must fulfill:
        </p>
        <ul style={{ fontSize: '0.82rem', color: '#3730a3', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li><strong>Open Trades:</strong> At least <strong>5 open trades</strong>.</li>
          <li><strong>30-Day Realized PnL:</strong> Greater than <strong>+$100 USD</strong>.</li>
        </ul>
      </div>

      {/* Section 4: ATH Quota Formula */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Target size={15} color="#0284c7" /> 4. ATH Early-Buyer Position Ingestion (Tracked Wallets)
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.6rem' }}>
          When a runner coin establishes an All-Time High (ATH ≥ $1,000,000), the bot captures early position-opening wallets into <strong>Tracked Wallets</strong> using two simultaneous methods:
        </p>
        <ul style={{ fontSize: '0.82rem', color: '#334155', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li><strong>ATH &lt; $1,000,000 ($1M):</strong> 0 wallets (minimum runner threshold is $1 Million; changed from $500k to $1M).</li>
          <li><strong>Trade Profitability Verification:</strong> Wallets are <em>only added if their trade was profitable</em> (<code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '3px' }}>profitUsd &gt; 0</code>, sold above buy price, or won). Losing trades are excluded.</li>
          <li><strong>Method 1 (Buying Mcap):</strong> Captures wallets that bought at or below <strong>25% of runner ATH</strong> (e.g. entry &le; $250k for $1M ATH).</li>
          <li><strong>Method 2 (First N Buyers):</strong> Captures the first <strong>100 wallets</strong> for ATH &ge; $1M, plus <strong>+20 wallets</strong> per additional $1M in ATH (<code style={{ background: '#e2e8f0', padding: '2px 5px', borderRadius: '3px' }}>100 + floor((ATH-1M)/1M)*20</code>).</li>
          <li><strong>Dual Qualification:</strong> If an address qualifies under both methods, both qualification origins and badges are preserved.</li>
        </ul>
      </div>

      {/* Section 5: 25% ATH Early-Buyer Tiers */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#166534', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Award size={15} color="#16a34a" /> 5. 25% ATH Early-Buyer Qualification Tiers
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#15803d', marginBottom: '0.6rem' }}>
          To qualify an early buy under Method 1, the entry purchase market cap must be at or below <strong>25% of the runner All-Time High (ATH)</strong> for coins with ATH &ge; $1,000,000, and the trade must be profitable:
        </p>
        <ul style={{ fontSize: '0.82rem', color: '#166534', paddingLeft: '1.25rem', lineHeight: '1.6' }}>
          <li><strong>Ath ~1M:</strong> Early buy entry <strong>&le; $250k</strong> (<span className="mono">&le; 25%</span> of 1M ATH).</li>
          <li><strong>Ath ~5M:</strong> Early buy entry <strong>&le; $1.25M</strong> (<span className="mono">&le; 25%</span> of 5M ATH).</li>
          <li><strong>Ath ~10M:</strong> Early buy entry <strong>&le; $2.5M</strong> (<span className="mono">&le; 25%</span> of 10M ATH).</li>
          <li><strong>Ath &ge; 50M:</strong> Early buy entry <strong>&le; $12.5M</strong> (<span className="mono">&le; 25%</span> of 50M ATH).</li>
        </ul>
      </div>
    </div>
  );
}
