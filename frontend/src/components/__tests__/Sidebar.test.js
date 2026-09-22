import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../Sidebar.jsx';

describe('Sidebar', () => {
  it('renders actual wallet count when 0 instead of mock 200', () => {
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={null} setAccount={() => {}} walletCount={0} />
      </MemoryRouter>
    );
    expect(html).toContain('umi-badge">0</span>');
    expect(html).not.toContain('umi-badge">200</span>');
  });

  it('does not render hardcoded mock user Sikdar_11426 or mock address 0x8840d12e698888ad592 when disconnected', () => {
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={null} setAccount={() => {}} walletCount={0} />
      </MemoryRouter>
    );
    expect(html).not.toMatch(/Sikdar_11426/);
    expect(html).not.toMatch(/0x8840d12e698888ad592/);
    expect(html).toMatch(/Not Connected|No Wallet/i);
  });

  it('does not render mock free plan upgrade banner', () => {
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={null} setAccount={() => {}} walletCount={0} />
      </MemoryRouter>
    );
    expect(html).not.toMatch(/free plan/i);
    expect(html).not.toMatch(/upgrade to a paid plan/i);
  });

  it('renders connected account address when account is provided', () => {
    const account = '0x1111222233334444555566667777888899990000';
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={account} setAccount={() => {}} walletCount={5} />
      </MemoryRouter>
    );
    expect(html).toContain('0x11...0000');
    expect(html).toContain('umi-badge">5</span>');
  });

  it('does not render dead mock controls like USD toggle, calculator, or theme switch', () => {
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={null} setAccount={() => {}} walletCount={0} />
      </MemoryRouter>
    );
    expect(html).not.toContain('umi-usd-row');
    expect(html).not.toContain('umi-calc-btn');
    expect(html).not.toContain('umi-theme-row');
  });

  it('renders TradeForge brand title', () => {
    const html = renderToString(
      <MemoryRouter>
        <Sidebar account={null} setAccount={() => {}} walletCount={0} />
      </MemoryRouter>
    );
    expect(html).toContain('TradeForge');
  });
});
