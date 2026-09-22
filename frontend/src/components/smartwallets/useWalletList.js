import { useState, useEffect, useCallback, useMemo } from 'react';
import { queryWallets } from '@wallet-query';
import { getBackendUrl, authHeaders } from '../../utils/sniperApi';
import { useToast } from '../ui/useToast';

export function useWalletList({
  initialWallets = null,
  initialCategory = 'smart',
} = {}) {
  let toast = { success: () => {}, error: () => {}, info: () => {} };
  try { toast = useToast(); } catch {}

  const isClientSide = Boolean(initialWallets);

  const [listCategory, setListCategory] = useState(initialCategory);
  const [chainTab, setChainTab] = useState('solana');
  const [trackedSubfilter, setTrackedSubfilter] = useState('all');
  const [scanSource, setScanSource] = useState('gmgn');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [consistentOnly, setConsistentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce search by 200ms
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  // When initialWallets is provided, run queryWallets
  const clientQuery = useMemo(() => {
    if (!isClientSide) return null;
    return queryWallets(initialWallets, {
      chain: chainTab,
      category: listCategory,
      subfilter: trackedSubfilter,
      search: debouncedSearch.trim().toLowerCase(),
      consistentOnly,
      page,
      pageSize,
    });
  }, [isClientSide, initialWallets, chainTab, listCategory, trackedSubfilter, debouncedSearch, consistentOnly, page, pageSize]);

  const fetchWallets = useCallback(async () => {
    if (isClientSide) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        chain: chainTab,
        category: listCategory,
        subfilter: trackedSubfilter,
        search: debouncedSearch.trim(),
        consistentOnly: String(consistentOnly),
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Backend response ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isClientSide, chainTab, listCategory, trackedSubfilter, debouncedSearch, consistentOnly, page, pageSize]);

  useEffect(() => {
    if (!isClientSide) {
      fetchWallets();
    }
  }, [isClientSide, fetchWallets]);

  const handleScan = async (chain, source = scanSource) => {
    setScanning(true);
    const sourceName = source === 'gmgn' ? 'GMGN' : source === 'fomo' ? 'FOMO' : source === 'kolscan' ? 'Kolscan' : source === 'madeonsol' ? 'MadeOnSol' : 'Nock Scout';
    toast.info(`Scanning 30-day top ${chain === 'solana' ? 'Solana' : 'Robinhood'} meme traders via ${sourceName}...`);
    try {
      const endpoint = source === 'gmgn'
        ? `${getBackendUrl()}/api/smart-wallets/scan`
        : `${getBackendUrl()}/api/smart-wallets/scan/${source}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain, limit: 20 }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Scan failed (${res.status})`);
      }
      const result = await res.json();
      toast.success(`Found and analyzed ${result.count || 0} smart wallets via ${sourceName} on ${chain}!`);
      await fetchWallets();
    } catch (e) {
      toast.error(`Finder scan failed: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (wallet) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/${wallet.chain}/${wallet.address}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success(`Removed wallet ${wallet.address.slice(0, 6)}…`);
      await fetchWallets();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handlePromote = async (wallet) => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/smart-wallets/promote/${wallet.chain}/${wallet.address}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Promotion failed (${res.status})`);
      toast.success(`Promoted wallet ${wallet.address.slice(0, 6)}… to Smart Wallet!`);
      await fetchWallets();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const activeData = isClientSide ? clientQuery : data;

  const wallets = activeData?.wallets || [];
  const totalFilteredCount = activeData?.total ?? wallets.length;
  const totalPages = activeData?.totalPages ?? 1;

  const countsByChain = activeData?.countsByChain;
  const solanaCounts = countsByChain?.solana;
  const robinhoodCounts = countsByChain?.robinhood;

  const totalSmartCount = (solanaCounts?.smart ?? 0) + (robinhoodCounts?.smart ?? 0);
  const totalTrackedCount = (solanaCounts?.tracked ?? 0) + (robinhoodCounts?.tracked ?? 0);
  const totalWhaleCount = (solanaCounts?.whale ?? 0) + (robinhoodCounts?.whale ?? 0);
  const totalLineageCount = (solanaCounts?.lineage ?? 0) + (robinhoodCounts?.lineage ?? 0);
  const totalSniperCount = (solanaCounts?.sniper ?? 0) + (robinhoodCounts?.sniper ?? 0);

  const solanaChainCount = solanaCounts?.[listCategory] ?? 0;
  const robinhoodChainCount = robinhoodCounts?.[listCategory] ?? 0;

  return {
    isClientSide,
    listCategory,
    setListCategory,
    chainTab,
    setChainTab,
    trackedSubfilter,
    setTrackedSubfilter,
    scanSource,
    setScanSource,
    search,
    setSearch,
    consistentOnly,
    setConsistentOnly,
    page,
    setPage,
    pageSize,
    setPageSize,
    loading,
    scanning,
    error,
    wallets,
    totalFilteredCount,
    totalPages,
    totalSmartCount,
    totalTrackedCount,
    totalWhaleCount,
    totalLineageCount,
    totalSniperCount,
    solanaChainCount,
    robinhoodChainCount,
    fetchWallets,
    handleScan,
    handleDelete,
    handlePromote,
  };
}
