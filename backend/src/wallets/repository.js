import crypto from 'node:crypto';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { load, save } from '../store.js';
import { hasWalletKey } from './vault.js';

const STORE = 'wallet-directory';
const AUDIT_STORE = 'wallet-audit';
const VERSION = 2;
const TAG_COLORS = ['#7c5cfc', '#14b8a6', '#f59e0b', '#38bdf8', '#ec4899', '#84cc16'];

const nowIso = () => new Date().toISOString();
const newId = prefix => `${prefix}_${crypto.randomUUID()}`;

export function normalizeTagName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (!address) throw new Error('Wallet address is required');
  if (/^0x/i.test(address)) {
    const canonical = address.startsWith('0X') ? `0x${address.slice(2)}` : address;
    if (!ethers.isAddress(canonical)) throw new Error(`Invalid EVM address: ${address}`);
    return canonical.toLowerCase();
  }
  try {
    if (bs58.decode(address).length === 32) return address;
  } catch { /* handled below */ }
  throw new Error(`Invalid wallet address: ${address}`);
}

function emptyState() {
  return { version: VERSION, wallets: [], tags: [], walletTags: [] };
}

function readState() {
  const state = load(STORE, emptyState());
  return {
    version: VERSION,
    wallets: Array.isArray(state.wallets) ? state.wallets : [],
    tags: Array.isArray(state.tags) ? state.tags : [],
    walletTags: Array.isArray(state.walletTags) ? state.walletTags : [],
  };
}

function writeState(state) {
  save(STORE, state);
  return state;
}

function audit(action, details = {}) {
  const entries = load(AUDIT_STORE, []);
  entries.unshift({ id: newId('audit'), at: nowIso(), action, ...details });
  save(AUDIT_STORE, entries.slice(0, 5000));
}

function hydrate(state, { includeArchived = false } = {}) {
  const tags = state.tags.filter(tag => includeArchived || !tag.archivedAt);
  const allowedTagIds = new Set(tags.map(tag => tag.id));
  const memberships = state.walletTags.filter(link => allowedTagIds.has(link.tagId));
  const wallets = state.wallets
    .filter(wallet => includeArchived || !wallet.archivedAt)
    .map(wallet => ({
      ...wallet,
      tagIds: memberships.filter(link => link.walletId === wallet.id).map(link => link.tagId),
      hasKey: hasWalletKey(wallet.id),
    }));
  return {
    version: VERSION,
    wallets,
    tags: tags.map(tag => ({
      ...tag,
      walletCount: memberships.filter(link => link.tagId === tag.id).length,
      aggregateBalance: null,
    })),
  };
}

function inferChainIds(address, chainIds) {
  if (Array.isArray(chainIds) && chainIds.length) return [...new Set(chainIds.map(String))];
  return address.startsWith('0x') ? ['evm'] : ['solana'];
}

function createWalletRecord(input, normalizedAddress) {
  const at = nowIso();
  return {
    id: input.id || newId('wallet'),
    name: String(input.name || input.label || `Wallet ${normalizedAddress.slice(0, 6)}`).trim(),
    address: normalizedAddress,
    chainIds: inferChainIds(normalizedAddress, input.chainIds),
    signerType: ['connected', 'external', 'watch-only', 'managed'].includes(input.signerType)
      ? input.signerType : 'watch-only',
    status: ['active', 'disabled', 'error'].includes(input.status) ? input.status : 'active',
    lastActivityAt: input.lastActivityAt || null,
    createdAt: input.createdAt || at,
    updatedAt: at,
    archivedAt: null,
  };
}

export function getDirectory(options) {
  return hydrate(readState(), options);
}

export function listAudit() {
  return load(AUDIT_STORE, []);
}

export function recordWalletActivity(address, at = new Date().toISOString()) {
  let normalized;
  try { normalized = normalizeAddress(address); } catch { return null; }
  const state = readState();
  const wallet = state.wallets.find(item => item.address === normalized && !item.archivedAt);
  if (!wallet) return null;
  wallet.lastActivityAt = typeof at === 'number' ? new Date(at).toISOString() : at;
  wallet.updatedAt = nowIso();
  writeState(state);
  return hydrate(state).wallets.find(item => item.id === wallet.id) || null;
}

export function addWallet(input) {
  const state = readState();
  const address = normalizeAddress(input.address);
  let wallet = state.wallets.find(item => item.address === address && !item.archivedAt);
  if (wallet) {
    wallet.name = String(input.name || input.label || wallet.name).trim();
    wallet.chainIds = inferChainIds(address, input.chainIds?.length ? input.chainIds : wallet.chainIds);
    wallet.status = input.status || wallet.status;
    wallet.signerType = input.signerType || wallet.signerType;
    wallet.updatedAt = nowIso();
  } else {
    wallet = createWalletRecord(input, address);
    state.wallets.push(wallet);
  }
  writeState(state);
  if (input.tagIds?.length) setWalletTags([wallet.id], input.tagIds, true, { skipAudit: true });
  audit('wallet.upsert', { walletId: wallet.id, address: wallet.address });
  return getDirectory().wallets.find(item => item.id === wallet.id);
}

export function updateWallet(id, patch) {
  const state = readState();
  const wallet = state.wallets.find(item => item.id === id && !item.archivedAt);
  if (!wallet) throw new Error('Wallet not found');
  if (patch.address && normalizeAddress(patch.address) !== wallet.address) {
    throw new Error('Wallet addresses are immutable; archive and add a new wallet instead');
  }
  if (patch.name !== undefined) wallet.name = String(patch.name).trim() || wallet.name;
  if (patch.status !== undefined) {
    if (!['active', 'disabled', 'error'].includes(patch.status)) throw new Error('Invalid wallet status');
    wallet.status = patch.status;
  }
  if (patch.signerType !== undefined) {
    if (!['connected', 'external', 'watch-only', 'managed'].includes(patch.signerType)) throw new Error('Invalid signer type');
    wallet.signerType = patch.signerType;
  }
  if (patch.chainIds !== undefined) wallet.chainIds = inferChainIds(wallet.address, patch.chainIds);
  wallet.updatedAt = nowIso();
  writeState(state);
  audit('wallet.update', { walletId: id, fields: Object.keys(patch).filter(key => key !== 'privateKey') });
  return getDirectory().wallets.find(item => item.id === id);
}

export function archiveWallets(ids) {
  const state = readState();
  const wanted = new Set(ids || []);
  const at = nowIso();
  state.wallets.forEach(wallet => { if (wanted.has(wallet.id)) { wallet.archivedAt = at; wallet.updatedAt = at; } });
  state.walletTags = state.walletTags.filter(link => !wanted.has(link.walletId));
  writeState(state);
  audit('wallet.archive', { walletIds: [...wanted] });
  return getDirectory();
}

export function deleteWallet(id) {
  const state = readState();
  const idx = state.wallets.findIndex(w => w.id === id);
  if (idx === -1) throw new Error('Wallet not found');
  const [removed] = state.wallets.splice(idx, 1);
  state.walletTags = state.walletTags.filter(link => link.walletId !== id);
  writeState(state);
  audit('wallet.delete', { walletId: id, address: removed.address });
  return { directory: getDirectory(), removed };
}

export function deleteWallets(ids) {
  const state = readState();
  const wanted = new Set(ids || []);
  if (wanted.size === 0) throw new Error('walletIds is required');
  const removed = state.wallets.filter(w => wanted.has(w.id));
  if (removed.length === 0) throw new Error('No matching wallets found');
  state.wallets = state.wallets.filter(w => !wanted.has(w.id));
  state.walletTags = state.walletTags.filter(link => !wanted.has(link.walletId));
  writeState(state);
  audit('wallet.deleteBulk', { walletIds: [...wanted], count: removed.length });
  return { directory: getDirectory(), removedIds: [...wanted].filter(id => removed.some(w => w.id === id)) };
}

export function createTag(input) {
  const state = readState();
  const name = String(input.name || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const normalizedName = normalizeTagName(name);
  if (!normalizedName) throw new Error('Tag name is required');
  if (state.tags.some(tag => !tag.archivedAt && tag.normalizedName === normalizedName)) {
    throw new Error('A tag with that name already exists');
  }
  const at = nowIso();
  const tag = {
    id: input.id || newId('tag'), name, normalizedName,
    color: input.color || TAG_COLORS[state.tags.length % TAG_COLORS.length],
    description: String(input.description || ''), createdAt: at, updatedAt: at, archivedAt: null,
  };
  state.tags.push(tag);
  writeState(state);
  audit('tag.create', { tagId: tag.id, name: tag.name });
  return getDirectory().tags.find(item => item.id === tag.id);
}

export function updateTag(id, patch) {
  const state = readState();
  const tag = state.tags.find(item => item.id === id && !item.archivedAt);
  if (!tag) throw new Error('Tag not found');
  if (patch.name !== undefined) {
    const name = String(patch.name).normalize('NFKC').trim().replace(/\s+/g, ' ');
    const normalizedName = normalizeTagName(name);
    if (!normalizedName) throw new Error('Tag name is required');
    if (state.tags.some(item => item.id !== id && !item.archivedAt && item.normalizedName === normalizedName)) {
      throw new Error('A tag with that name already exists');
    }
    tag.name = name;
    tag.normalizedName = normalizedName;
  }
  if (patch.color !== undefined) tag.color = String(patch.color);
  if (patch.description !== undefined) tag.description = String(patch.description);
  tag.updatedAt = nowIso();
  writeState(state);
  audit('tag.update', { tagId: id, fields: Object.keys(patch) });
  return getDirectory().tags.find(item => item.id === id);
}

export function archiveTag(id) {
  const state = readState();
  const tag = state.tags.find(item => item.id === id && !item.archivedAt);
  if (!tag) throw new Error('Tag not found');
  tag.archivedAt = nowIso();
  tag.updatedAt = tag.archivedAt;
  state.walletTags = state.walletTags.filter(link => link.tagId !== id);
  writeState(state);
  audit('tag.archive', { tagId: id });
  return getDirectory();
}

export function setWalletTags(walletIds, tagIds, assigned, { skipAudit = false } = {}) {
  const state = readState();
  const wallets = new Set(state.wallets.filter(w => !w.archivedAt).map(w => w.id));
  const tags = new Set(state.tags.filter(t => !t.archivedAt).map(t => t.id));
  const wantedWallets = [...new Set(walletIds || [])].filter(id => wallets.has(id));
  const wantedTags = [...new Set(tagIds || [])].filter(id => tags.has(id));
  if (!wantedWallets.length || !wantedTags.length) throw new Error('Valid walletIds and tagIds are required');
  const key = (walletId, tagId) => `${walletId}:${tagId}`;
  if (assigned) {
    const existing = new Set(state.walletTags.map(link => key(link.walletId, link.tagId)));
    for (const walletId of wantedWallets) for (const tagId of wantedTags) {
      if (!existing.has(key(walletId, tagId))) state.walletTags.push({ walletId, tagId, createdAt: nowIso() });
    }
  } else {
    const remove = new Set(wantedWallets.flatMap(walletId => wantedTags.map(tagId => key(walletId, tagId))));
    state.walletTags = state.walletTags.filter(link => !remove.has(key(link.walletId, link.tagId)));
  }
  writeState(state);
  if (!skipAudit) audit('wallet-tag.bulk', { walletIds: wantedWallets, tagIds: wantedTags, assigned: Boolean(assigned) });
  return getDirectory();
}

export function mergeTags(targetTagId, sourceTagIds) {
  const state = readState();
  const target = state.tags.find(tag => tag.id === targetTagId && !tag.archivedAt);
  if (!target) throw new Error('Target tag not found');
  const sources = new Set((sourceTagIds || []).filter(id => id !== targetTagId));
  const walletIds = new Set(state.walletTags.filter(link => sources.has(link.tagId)).map(link => link.walletId));
  const existing = new Set(state.walletTags.filter(link => link.tagId === targetTagId).map(link => link.walletId));
  for (const walletId of walletIds) if (!existing.has(walletId)) {
    state.walletTags.push({ walletId, tagId: targetTagId, createdAt: nowIso() });
  }
  const at = nowIso();
  state.tags.forEach(tag => { if (sources.has(tag.id)) { tag.archivedAt = at; tag.updatedAt = at; } });
  state.walletTags = state.walletTags.filter(link => !sources.has(link.tagId));
  writeState(state);
  audit('tag.merge', { targetTagId, sourceTagIds: [...sources] });
  return getDirectory();
}

export function resolveWallets({ tagIds = [], walletIds = [], excludeAddresses = [], chainId } = {}) {
  const state = readState();
  const selectedTags = new Set(tagIds);
  const selectedWallets = new Set(walletIds);
  state.walletTags.forEach(link => { if (selectedTags.has(link.tagId)) selectedWallets.add(link.walletId); });
  const excluded = new Set(excludeAddresses.map(address => {
    try { return normalizeAddress(address); } catch { return String(address).trim().toLowerCase(); }
  }));
  const sourcesByWallet = new Map();
  state.walletTags.forEach(link => {
    if (!selectedTags.has(link.tagId)) return;
    const list = sourcesByWallet.get(link.walletId) || [];
    list.push(link.tagId);
    sourcesByWallet.set(link.walletId, list);
  });
  const wallets = state.wallets
    .filter(wallet => selectedWallets.has(wallet.id) && !wallet.archivedAt && wallet.status === 'active')
    .filter(wallet => !excluded.has(wallet.address))
    .filter(wallet => !chainId || wallet.chainIds.includes(chainId) || wallet.chainIds.includes('evm') && chainId !== 'solana')
    .map(wallet => ({ ...wallet, sourceTagIds: sourcesByWallet.get(wallet.id) || [] }));
  return { wallets, addresses: wallets.map(wallet => wallet.address), count: wallets.length };
}

export function importDirectory(input) {
  const incoming = input?.directory || input || {};
  const tags = Array.isArray(incoming.tags) ? incoming.tags : [];
  const wallets = Array.isArray(incoming.wallets) ? incoming.wallets : [];
  const tagMap = new Map();
  for (const tag of tags) {
    const existing = getDirectory().tags.find(item => item.normalizedName === normalizeTagName(tag.name));
    const savedTag = existing || createTag(tag);
    tagMap.set(tag.id, savedTag.id);
  }
  for (const wallet of wallets) {
    const savedWallet = addWallet(wallet);
    const mappedTags = (wallet.tagIds || []).map(id => tagMap.get(id)).filter(Boolean);
    if (mappedTags.length) setWalletTags([savedWallet.id], mappedTags, true, { skipAudit: true });
  }
  audit('directory.import', { walletCount: wallets.length, tagCount: tags.length });
  return getDirectory();
}

export function replaceDirectory(input) {
  const directory = input?.directory || input;
  if (!directory || !Array.isArray(directory.wallets) || !Array.isArray(directory.tags)) {
    throw new Error('A valid directory is required');
  }
  const state = emptyState();
  const tagIds = new Set();
  for (const tag of directory.tags) {
    const normalizedName = normalizeTagName(tag.name);
    if (!normalizedName || state.tags.some(item => item.normalizedName === normalizedName)) continue;
    const id = tag.id || newId('tag');
    tagIds.add(id);
    state.tags.push({
      id, name: String(tag.name).trim(), normalizedName,
      color: tag.color || TAG_COLORS[state.tags.length % TAG_COLORS.length],
      description: tag.description || '', createdAt: tag.createdAt || nowIso(), updatedAt: nowIso(), archivedAt: null,
    });
  }
  for (const inputWallet of directory.wallets) {
    const address = normalizeAddress(inputWallet.address);
    if (state.wallets.some(wallet => wallet.address === address)) continue;
    const wallet = createWalletRecord(inputWallet, address);
    state.wallets.push(wallet);
    for (const tagId of inputWallet.tagIds || []) if (tagIds.has(tagId)) {
      state.walletTags.push({ walletId: wallet.id, tagId, createdAt: nowIso() });
    }
  }
  writeState(state);
  audit('directory.replace', { walletCount: state.wallets.length, tagCount: state.tags.length });
  return getDirectory();
}
