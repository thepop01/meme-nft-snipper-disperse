import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Wallet, Zap, LogOut, LayoutDashboard,
  Radar, Crosshair, Bot, Activity
} from 'lucide-react';
import { shortAddr } from '../utils/format';

export function UmiLogo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 4C13.5 4 11.5 6 11.5 8.5C11.5 9.8 12.1 11 13 11.8C10.5 12.3 8.5 14.5 8.5 17.2C8.5 20.2 11 22.7 14 22.7C14.7 22.7 15.4 22.5 16 22.2C16.6 22.5 17.3 22.7 18 22.7C21 22.7 23.5 20.2 23.5 17.2C23.5 14.5 21.5 12.3 19 11.8C19.9 11 20.5 9.8 20.5 8.5C20.5 6 18.5 4 16 4Z" fill="#5046E5" />
      <circle cx="16" cy="15" r="3" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}

export function DisperseNavIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6" />
      <circle cx="12" cy="3" r="1.5" />
      <path d="M4.2 19.5l5.2-3" />
      <circle cx="3.5" cy="20" r="1.5" />
      <path d="M19.8 19.5l-5.2-3" />
      <circle cx="20.5" cy="20" r="1.5" />
    </svg>
  );
}

export function LeafNavIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

const Sidebar = ({ account, setAccount, walletCount = 0 }) => {
  const navigate = useNavigate();
  const [availableWallets, setAvailableWallets] = useState([]);
  const [connectedWallet, setConnectedWallet] = useState(null);

  useEffect(() => {
    detectWallets();
    return () => {
      window.removeEventListener('eip6963:announceProvider', handleProviderAnnounce);
    };
  }, []);

  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      setAccount(null);
      setConnectedWallet(null);
    } else {
      setAccount(accounts[0]);
    }
  };

  const handleProviderAnnounce = (event) => {
    const { info, provider } = event.detail;
    const id = info.rdns;
    const knownWallets = {
      'io.metamask': { name: 'MetaMask', icon: '🦊', id: 'metamask' },
      'com.rabby': { name: 'Rabby', icon: '🐰', id: 'rabby' },
      'com.coinbase.wallet': { name: 'Coinbase Wallet', icon: '🔵', id: 'coinbase' },
      'io.phantom': { name: 'Phantom', icon: '👻', id: 'phantom' },
      'com.okex.wallet': { name: 'OKX Wallet', icon: '⭕', id: 'okx' },
      'com.trustwallet': { name: 'Trust Wallet', icon: '⚡', id: 'trust' },
    };
    const known = knownWallets[id];
    const walletName = known?.name || info.name;
    const walletIcon = known?.icon || '💼';
    const walletId = known?.id || id;

    setAvailableWallets(prev => {
      if (prev.find(w => w.id === walletId)) return prev;
      return [...prev, { name: walletName, icon: walletIcon, provider, id: walletId }];
    });
  };

  const detectWallets = () => {
    window.addEventListener('eip6963:announceProvider', handleProviderAnnounce);
    window.dispatchEvent(new CustomEvent('eip6963:requestProviders'));

    const directWallets = [];
    if (window.rabby) directWallets.push({ name: 'Rabby', icon: '🐰', provider: window.rabby, id: 'rabby' });
    if (window.ethereum?.isMetaMask && !directWallets.find(w => w.id === 'metamask')) {
      directWallets.push({ name: 'MetaMask', icon: '🦊', provider: window.ethereum, id: 'metamask' });
    }
    if (window.ethereum?.isTrust && !directWallets.find(w => w.id === 'trust')) {
      directWallets.push({ name: 'Trust Wallet', icon: '⚡', provider: window.ethereum, id: 'trust' });
    }
    if ((window.ethereum?.isCoinbaseWallet || window.coinbaseWalletExtension) && !directWallets.find(w => w.id === 'coinbase')) {
      directWallets.push({ name: 'Coinbase Wallet', icon: '🔵', provider: window.coinbaseWalletExtension || window.ethereum, id: 'coinbase' });
    }
    if (window.phantom?.ethereum && !directWallets.find(w => w.id === 'phantom')) {
      directWallets.push({ name: 'Phantom', icon: '👻', provider: window.phantom.ethereum, id: 'phantom' });
    }
    if (window.okxwallet && !directWallets.find(w => w.id === 'okx')) {
      directWallets.push({ name: 'OKX Wallet', icon: '⭕', provider: window.okxwallet, id: 'okx' });
    }

    if (directWallets.length > 0) {
      setAvailableWallets(prev => {
        const merged = [...prev];
        for (const w of directWallets) {
          if (!merged.find(m => m.id === w.id)) merged.push(w);
        }
        return merged;
      });
    }

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('eip6963:requestProviders'));
    }, 500);

    setTimeout(() => {
      setAvailableWallets(prev => {
        if (prev.length === 0 && window.ethereum) {
          return [{ name: 'Web3 Wallet', icon: '💼', provider: window.ethereum, id: 'generic' }];
        }
        return prev;
      });
    }, 1000);
  };

  const connectWallet = async (walletInfo) => {
    try {
      const provider = walletInfo.provider;
      if (connectedWallet && account) {
        try {
          await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        } catch (permErr) {
          if (permErr.code === 4200 || permErr.message?.includes('not supported')) {
            await provider.request({ method: 'eth_requestAccounts' });
          } else throw permErr;
        }
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (accounts.length > 0) setAccount(accounts[0]);
        setConnectedWallet(walletInfo);
        return;
      }

      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      setConnectedWallet(walletInfo);

      if (provider.on) {
        provider.on('accountsChanged', (accs) => {
          if (accs.length === 0) disconnectWallet();
          else setAccount(accs[0]);
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setConnectedWallet(null);
  };

  const displayAddress = account ? shortAddr(account) : 'No Wallet';
  const displayName = account ? (connectedWallet?.name || 'My Wallet') : 'Not Connected';

  return (
    <aside className="umi-sidebar">
      {/* Brand Header */}
      <div className="umi-brand" onClick={() => navigate('/dashboard')}>
        <UmiLogo size={26} />
        <span className="umi-brand-title">TradeForge</span>
      </div>

      {/* EVM & Core Tools Navigation Card */}
      <div className="umi-nav-card">
        <div className="umi-card-header-label">EVM Tools</div>

        <NavLink
          to="/mintbot"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <LeafNavIcon size={17} />
          <span>Mints</span>
        </NavLink>

        <NavLink
          to="/wallets"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Wallet size={17} />
          <span>Wallets</span>
          <span className="umi-badge">{walletCount}</span>
        </NavLink>

        <NavLink
          to="/disperse"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <DisperseNavIcon size={17} />
          <span>Disperse</span>
        </NavLink>
      </div>

      {/* Meme Trading & Sniper Navigation Card */}
      <div className="umi-nav-card">
        <div className="umi-card-header-label">Meme &amp; Sniper</div>

        <NavLink 
          to="/sol-meme" 
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Radar size={17} />
          <span>Solana Meme</span>
        </NavLink>

        <NavLink 
          to="/evm-meme" 
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Radar size={17} />
          <span>EVM Meme</span>
        </NavLink>

        <NavLink
          to="/smart-wallets"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Wallet size={17} />
          <span>Wallets</span>
        </NavLink>

        <NavLink
          to="/tracked-memes"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Radar size={17} />
          <span>Tracked Memes</span>
        </NavLink>

        <NavLink
          to="/sniper"
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Crosshair size={17} />
          <span>Sniper</span>
        </NavLink>

        <NavLink 
          to="/bots" 
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Bot size={17} />
          <span>My Bots</span>
        </NavLink>
      </div>

      {/* Overview Navigation Card */}
      <div className="umi-nav-card">
        <div className="umi-card-header-label">Overview</div>

        <NavLink 
          to="/dashboard" 
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <LayoutDashboard size={17} />
          <span>Dashboard</span>
        </NavLink>

        <NavLink 
          to="/activity" 
          className={({ isActive }) => `umi-nav-link ${isActive ? 'active' : ''}`}
        >
          <Activity size={17} />
          <span>Activity</span>
        </NavLink>
      </div>

      {/* Profile & Wallet Card */}
      <div className="umi-nav-card umi-profile-bottom-card">
        <div className="umi-profile-row">
          <div className="umi-avatar">
            {account ? (displayName[0]?.toUpperCase() || 'W') : <Wallet size={16} />}
          </div>
          <div className="umi-profile-details">
            <span className="umi-profile-name">{displayName}</span>
            <span className="umi-profile-addr">{displayAddress}</span>
          </div>
          {account ? (
            <button
              type="button"
              className="umi-profile-action"
              onClick={disconnectWallet}
              title="Disconnect"
            >
              <LogOut size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="umi-profile-action"
              onClick={() => {
                if (availableWallets.length > 0) connectWallet(availableWallets[0]);
                else if (window.ethereum) connectWallet({ name: 'MetaMask', provider: window.ethereum });
              }}
              title="Connect Wallet"
            >
              <Zap size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
