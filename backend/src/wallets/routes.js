import { Router } from 'express';
import { ethers } from 'ethers';
import {
  addWallet, archiveTag, archiveWallets, createTag, deleteWallet, deleteWallets, getDirectory, importDirectory,
  listAudit, mergeTags, replaceDirectory, resolveWallets, setWalletTags, updateTag, updateWallet,
} from './repository.js';
import * as vault from './vault.js';
import { getNftChain } from '../nft/chains.js';

export function createWalletRouter() {
  const router = Router();
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res))
    .catch(error => res.status(400).json({ error: error.message }));

  router.get('/directory', (req, res) => res.json({ directory: getDirectory() }));
  router.put('/directory', wrap((req, res) => res.json({ directory: replaceDirectory(req.body) })));
  router.post('/directory/import', wrap((req, res) => res.json({ directory: importDirectory(req.body) })));
  router.get('/audit', (req, res) => res.json({ audit: listAudit() }));

  router.post('/', wrap((req, res) => res.status(201).json({ wallet: addWallet(req.body || {}) })));
  router.patch('/:id', wrap((req, res) => res.json({ wallet: updateWallet(req.params.id, req.body || {}) })));
  router.post('/archive', wrap((req, res) => res.json({ directory: archiveWallets(req.body?.walletIds) })));
  router.delete('/:id', wrap((req, res) => {
    const { directory } = deleteWallet(req.params.id);
    vault.removeWalletKey(req.params.id);
    res.json({ directory });
  }));
  router.post('/delete', wrap((req, res) => {
    const ids = req.body?.walletIds || req.body?.ids;
    const { directory, removedIds } = deleteWallets(ids);
    for (const id of removedIds) vault.removeWalletKey(id);
    res.json({ directory, removedIds });
  }));

  router.post('/tags', wrap((req, res) => res.status(201).json({ tag: createTag(req.body || {}) })));
  router.patch('/tags/:id', wrap((req, res) => res.json({ tag: updateTag(req.params.id, req.body || {}) })));
  router.delete('/tags/:id', wrap((req, res) => res.json({ directory: archiveTag(req.params.id) })));
  router.post('/tags/merge', wrap((req, res) => res.json({
    directory: mergeTags(req.body?.targetTagId, req.body?.sourceTagIds),
  })));
  router.post('/tags/memberships', wrap((req, res) => res.json({
    directory: setWalletTags(req.body?.walletIds, req.body?.tagIds, req.body?.assigned),
  })));
  router.post('/resolve', wrap((req, res) => res.json(resolveWallets(req.body || {}))));

  // --- Signer vault ---
  router.get('/vault/status', (req, res) => res.json({
    initialized: vault.isInitialized(), unlocked: vault.isUnlocked(),
  }));
  router.post('/vault/init', wrap((req, res) => {
    const password = String(req.body?.password || '');
    if (password.length < 8) throw new Error('Vault password must be at least 8 characters');
    res.json(vault.initVault(password));
  }));
  router.post('/vault/unlock', wrap((req, res) =>
    res.json(vault.unlockVault(String(req.body?.password || '')))));
  router.post('/vault/lock', (req, res) => res.json(vault.lockVault()));
  // Store a private key for a wallet (requires unlocked vault). The key is
  // validated against the wallet address, encrypted, and never returned.
  router.post('/:id/key', wrap((req, res) => {
    const privateKey = String(req.body?.privateKey || '').trim();
    if (!privateKey) throw new Error('privateKey is required');
    const result = vault.setWalletKey(req.params.id, privateKey);
    updateWallet(req.params.id, { signerType: 'managed' });
    res.json({ ...result, hasKey: true });
  }));
  router.delete('/:id/key', wrap((req, res) => {
    const removed = vault.removeWalletKey(req.params.id);
    res.json({ removed });
  }));

  // Live native balances for EVM addresses via the chain's RPC.
  router.post('/balances', wrap(async (req, res) => {
    const chainName = String(req.body?.chain || 'ethereum');
    const chain = getNftChain(chainName);
    if (!chain?.rpc) throw new Error(`No RPC configured for ${chainName}`);
    const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
    const addresses = (Array.isArray(req.body?.addresses) ? req.body.addresses : []).slice(0, 100);
    const balances = {};
    await Promise.all(addresses.map(async address => {
      try {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) return;
        balances[String(address).toLowerCase()] = (await provider.getBalance(address)).toString();
      } catch { /* leave missing on RPC failure */ }
    }));
    res.json({ chain: chainName, balances });
  }));

  return router;
}
