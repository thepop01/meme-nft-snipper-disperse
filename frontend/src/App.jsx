import React, { lazy, Suspense, useMemo, useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { deriveWalletGroups, emptyDirectory, migrateLegacyGroups, sanitizeDirectory } from './utils/walletDirectory';
import { walletApi } from './utils/walletApi';

const ActivityView = lazy(() => import('./components/ActivityView'));
const BotsView = lazy(() => import('./components/BotsView'));
const DashboardView = lazy(() => import('./components/DashboardView'));
const DisperseView = lazy(() => import('./components/DisperseView'));
const MemeFinderView = lazy(() => import('./components/MemeFinderView'));
const MemeRegistryView = lazy(() => import('./components/MemeRegistryView'));
const SmartWalletsView = lazy(() => import('./components/SmartWalletsView'));
const NFTMintBotView = lazy(() => import('./components/NFTMintBotView'));
const SniperView = lazy(() => import('./components/SniperView'));
const WalletsView = lazy(() => import('./components/WalletsView'));

const VALID_TABS = ['dashboard', 'activity', 'wallets', 'disperse', 'mintbot', 'sol-meme', 'evm-meme', 'smart-wallets', 'tracked-memes', 'sniper', 'bots'];

function PageFallback() {
  return <div className="page-loading" role="status"><span className="spinner" /> Loading workspace…</div>;
}

// "/" redirects to the last visited tab (pre-router sessions stored it in activeTab).
function HomeRedirect() {
  let saved = null;
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored === 'memefinder') saved = 'sol-meme';
    else if (stored && VALID_TABS.includes(stored)) saved = stored;
  } catch {}
  return <Navigate to={`/${saved || 'dashboard'}`} replace />;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Remember the current tab so "/" (and old bookmarks) land where the user left off.
  useEffect(() => {
    const tab = location.pathname.split('/')[1];
    if (VALID_TABS.includes(tab)) {
      try { localStorage.setItem('activeTab', tab); } catch {}
    }
  }, [location.pathname]);

  const [account, setAccount] = useState(null);
  const [walletDirectory, setWalletDirectory] = useState(() => {
    try {
      const savedDirectory = localStorage.getItem('walletDirectory');
      if (savedDirectory) return sanitizeDirectory(JSON.parse(savedDirectory));
      const savedGroups = localStorage.getItem('walletGroups');
      return savedGroups ? migrateLegacyGroups(JSON.parse(savedGroups)) : emptyDirectory();
    } catch {
      return emptyDirectory();
    }
  });
  const [directoryBackendOnline, setDirectoryBackendOnline] = useState(false);
  const directoryHydrated = useRef(false);
  const lastSavedDirectory = useRef('');

  const walletGroups = useMemo(() => deriveWalletGroups(walletDirectory), [walletDirectory]);

  useEffect(() => {
    localStorage.setItem('walletDirectory', JSON.stringify(walletDirectory));
    localStorage.setItem('walletGroups', JSON.stringify(walletGroups));
  }, [walletDirectory, walletGroups]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const { directory: remote } = await walletApi.directory();
        let next = sanitizeDirectory(remote);
        if (next.wallets.length === 0 && next.tags.length === 0
            && (walletDirectory.wallets.length > 0 || walletDirectory.tags.length > 0)) {
          next = sanitizeDirectory((await walletApi.importDirectory(walletDirectory)).directory);
        }
        if (cancelled) return;
        lastSavedDirectory.current = JSON.stringify(next);
        setWalletDirectory(next);
        setDirectoryBackendOnline(true);
      } catch {
        if (!cancelled) setDirectoryBackendOnline(false);
      } finally {
        directoryHydrated.current = true;
      }
    };
    hydrate();
    return () => { cancelled = true; };
  // The initial browser directory is intentionally captured once for migration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!directoryHydrated.current || !directoryBackendOnline) return undefined;
    const serialized = JSON.stringify(walletDirectory);
    if (serialized === lastSavedDirectory.current) return undefined;
    const timer = setTimeout(async () => {
      try {
        const { directory } = await walletApi.replaceDirectory(walletDirectory);
        const sanitized = sanitizeDirectory(directory);
        lastSavedDirectory.current = JSON.stringify(sanitized);
      } catch {
        setDirectoryBackendOnline(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [directoryBackendOnline, walletDirectory]);

  // A tab crash renders an error card instead of white-screening the app;
  // resetKey clears the error when the user navigates away.
  const guard = (label, element) => (
    <ErrorBoundary key={location.pathname} label={label}>{element}</ErrorBoundary>
  );

  return (
    <ToastProvider>
      <div className="app-container">
        <Sidebar account={account} setAccount={setAccount} walletCount={walletDirectory?.wallets?.length ?? 0} />
        <div className="main-content">
          <Suspense fallback={<PageFallback />}><Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={guard('Dashboard', <DashboardView walletGroups={walletGroups} setActiveTab={tab => navigate(`/${tab}`)} />)} />
            <Route path="/activity" element={guard('Activity', <ActivityView />)} />
            <Route path="/wallets" element={guard('Wallets', <WalletsView walletDirectory={walletDirectory} setWalletDirectory={setWalletDirectory} backendOnline={directoryBackendOnline} />)} />
            <Route path="/disperse" element={guard('Disperse', <DisperseView account={account} walletDirectory={walletDirectory} />)} />
            <Route path="/mintbot" element={guard('Mint Bot', <NFTMintBotView walletDirectory={walletDirectory} />)} />
            <Route path="/memefinder/*" element={<Navigate to="/sol-meme" replace />} />
            <Route path="/sol-meme/:feedId?" element={guard('Solana Meme Terminal', <MemeFinderView walletDirectory={walletDirectory} forcedChain="solana" basePath="/sol-meme" />)} />
            <Route path="/evm-meme/:feedId?" element={guard('EVM Meme Terminal', <MemeFinderView walletDirectory={walletDirectory} forcedChain="robinhood" basePath="/evm-meme" />)} />
            <Route path="/smart-wallets" element={guard('Smart Wallets', <SmartWalletsView />)} />
            <Route path="/tracked-memes" element={guard('Tracked Memes', <MemeRegistryView />)} />
            <Route path="/sniper" element={guard('Sniper', <SniperView />)} />
            <Route path="/bots" element={guard('My Bots', <BotsView />)} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes></Suspense>
        </div>
      </div>
    </ToastProvider>
  );
}

export default App;
