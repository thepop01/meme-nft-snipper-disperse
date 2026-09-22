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
const PERSISTENT_TABS = ['dashboard', 'smart-wallets', 'tracked-memes', 'sol-meme', 'evm-meme'];

function PageFallback() {
  return <div className="page-loading" role="status"><span className="spinner" /> Loading workspace…</div>;
}

// "/" redirects to the focused tab (Tracked Wallets / Tracked Memes).
function HomeRedirect() {
  let saved = null;
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored === 'memefinder' || stored === 'sol-meme' || stored === 'evm-meme') saved = 'smart-wallets';
    else if (stored && VALID_TABS.includes(stored)) saved = stored;
  } catch {}
  return <Navigate to={`/${saved || 'smart-wallets'}`} replace />;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = location.pathname.split('/')[1] || '';

  // Track visited persistent workspaces to mount them on-demand and keep them alive
  const [visitedTabs, setVisitedTabs] = useState(() => {
    const initial = location.pathname.split('/')[1] || '';
    return new Set(PERSISTENT_TABS.includes(initial) ? [initial] : []);
  });

  // Remember the current tab so "/" (and old bookmarks) land where the user left off.
  useEffect(() => {
    const tab = location.pathname.split('/')[1] || '';
    if (VALID_TABS.includes(tab)) {
      try { localStorage.setItem('activeTab', tab); } catch {}
    }
    if (PERSISTENT_TABS.includes(tab)) {
      setVisitedTabs(prev => {
        if (prev.has(tab)) return prev;
        const next = new Set(prev);
        next.add(tab);
        return next;
      });
    }
  }, [location.pathname]);

  // Synchronously ensure current tab is in visitedTabs for immediate rendering
  if (PERSISTENT_TABS.includes(currentTab) && !visitedTabs.has(currentTab)) {
    setVisitedTabs(prev => new Set([...prev, currentTab]));
  }

  const [lastSolPath, setLastSolPath] = useState(() => (location.pathname.startsWith('/sol-meme') ? location.pathname : '/sol-meme'));
  const [lastEvmPath, setLastEvmPath] = useState(() => (location.pathname.startsWith('/evm-meme') ? location.pathname : '/evm-meme'));

  useEffect(() => {
    if (location.pathname.startsWith('/sol-meme')) {
      setLastSolPath(location.pathname);
    } else if (location.pathname.startsWith('/evm-meme')) {
      setLastEvmPath(location.pathname);
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
          {/* Persistent keep-alive workspaces: preserved in DOM with 0ms switching latency */}
          <div className="tab-workspaces" style={{ width: '100%' }}>
            {visitedTabs.has('dashboard') && (
              <div
                className="tab-workspace"
                style={{ display: currentTab === 'dashboard' ? 'block' : 'none', width: '100%' }}
              >
                <ErrorBoundary label="Dashboard">
                  <Suspense fallback={<PageFallback />}>
                    <DashboardView walletGroups={walletGroups} setActiveTab={tab => navigate(`/${tab}`)} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {visitedTabs.has('smart-wallets') && (
              <div
                className="tab-workspace"
                style={{ display: currentTab === 'smart-wallets' ? 'block' : 'none', width: '100%' }}
              >
                <ErrorBoundary label="Smart Wallets">
                  <Suspense fallback={<PageFallback />}>
                    <SmartWalletsView />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {visitedTabs.has('tracked-memes') && (
              <div
                className="tab-workspace"
                style={{ display: currentTab === 'tracked-memes' ? 'block' : 'none', width: '100%' }}
              >
                <ErrorBoundary label="Tracked Memes">
                  <Suspense fallback={<PageFallback />}>
                    <MemeRegistryView />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {visitedTabs.has('sol-meme') && (
              <div
                className="tab-workspace"
                style={{ display: currentTab === 'sol-meme' ? 'block' : 'none', width: '100%' }}
              >
                <ErrorBoundary label="Solana Meme Terminal">
                  <Suspense fallback={<PageFallback />}>
                    <Routes location={{ pathname: currentTab === 'sol-meme' ? location.pathname : lastSolPath }}>
                      <Route path="/sol-meme/:feedId?" element={<MemeFinderView walletDirectory={walletDirectory} forcedChain="solana" basePath="/sol-meme" />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {visitedTabs.has('evm-meme') && (
              <div
                className="tab-workspace"
                style={{ display: currentTab === 'evm-meme' ? 'block' : 'none', width: '100%' }}
              >
                <ErrorBoundary label="EVM Meme Terminal">
                  <Suspense fallback={<PageFallback />}>
                    <Routes location={{ pathname: currentTab === 'evm-meme' ? location.pathname : lastEvmPath }}>
                      <Route path="/evm-meme/:feedId?" element={<MemeFinderView walletDirectory={walletDirectory} forcedChain="robinhood" basePath="/evm-meme" />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
          </div>

          {/* Standard React Router for auxiliary views and fallback routes */}
          <div style={{ display: PERSISTENT_TABS.includes(currentTab) ? 'none' : 'block', width: '100%' }}>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<HomeRedirect />} />
                {/* Persistent tab routes recognized by React Router (rendered above in keep-alive divs) */}
                <Route path="/dashboard" element={<div />} />
                <Route path="/smart-wallets" element={<div />} />
                <Route path="/tracked-memes" element={<div />} />
                <Route path="/sol-meme/*" element={<div />} />
                <Route path="/evm-meme/*" element={<div />} />
                {/* Auxiliary routes */}
                <Route path="/activity" element={guard('Activity', <ActivityView />)} />
                <Route path="/wallets" element={guard('Wallets', <WalletsView walletDirectory={walletDirectory} setWalletDirectory={setWalletDirectory} backendOnline={directoryBackendOnline} />)} />
                <Route path="/disperse" element={guard('Disperse', <DisperseView account={account} walletDirectory={walletDirectory} />)} />
                <Route path="/mintbot" element={guard('Mint Bot', <NFTMintBotView walletDirectory={walletDirectory} />)} />
                <Route path="/memefinder/*" element={<Navigate to="/sol-meme" replace />} />
                <Route path="/sniper" element={guard('Sniper', <SniperView />)} />
                <Route path="/bots" element={guard('My Bots', <BotsView />)} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

export default App;
