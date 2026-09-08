export const DIRECTORY_VERSION = 2;

const TAG_COLORS = ['#7c5cfc', '#14b8a6', '#f59e0b', '#38bdf8', '#ec4899', '#84cc16'];

export function normalizeAddress(address) {
  const trimmed = String(address || '').trim();
  return /^0x[0-9a-f]+$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function normalizeTagName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function emptyDirectory() {
  return { version: DIRECTORY_VERSION, wallets: [], tags: [] };
}

function stableWalletId(address) {
  const safe = normalizeAddress(address).replace(/[^a-zA-Z0-9]/g, '').slice(0, 42);
  return `wallet-${safe || Math.random().toString(36).slice(2)}`;
}

export function migrateLegacyGroups(groups = []) {
  const directory = emptyDirectory();
  const byAddress = new Map();

  for (const [index, group] of groups.entries()) {
    const name = String(group?.name || `Group ${index + 1}`).trim();
    const tag = {
      id: String(group?.id || `tag-${index + 1}`),
      name,
      normalizedName: normalizeTagName(name),
      color: group?.color || TAG_COLORS[index % TAG_COLORS.length],
      description: group?.description || '',
    };
    directory.tags.push(tag);

    for (const rawAddress of group?.addresses || []) {
      const address = String(rawAddress || '').trim();
      const normalized = normalizeAddress(address);
      if (!normalized) continue;
      let wallet = byAddress.get(normalized);
      if (!wallet) {
        wallet = {
          id: stableWalletId(address),
          name: `Wallet ${byAddress.size + 1}`,
          address,
          tagIds: [],
          status: 'active',
        };
        byAddress.set(normalized, wallet);
        directory.wallets.push(wallet);
      }
      if (!wallet.tagIds.includes(tag.id)) wallet.tagIds.push(tag.id);
    }
  }
  return directory;
}

export function sanitizeDirectory(value) {
  if (!value || !Array.isArray(value.wallets) || !Array.isArray(value.tags)) return emptyDirectory();
  const tags = value.tags
    .map((tag, index) => {
      const name = String(tag?.name || '').trim();
      if (!name) return null;
      return {
        ...tag,
        id: String(tag.id || `tag-${index + 1}`),
        name,
        normalizedName: normalizeTagName(name),
        color: tag.color || TAG_COLORS[index % TAG_COLORS.length],
        description: tag.description || '',
      };
    })
    .filter(Boolean);
  const tagIds = new Set(tags.map(tag => tag.id));
  const seen = new Set();
  const wallets = value.wallets
    .map((wallet, index) => {
      const address = String(wallet?.address || '').trim();
      const normalized = normalizeAddress(address);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      return {
        ...wallet,
        id: String(wallet.id || stableWalletId(address)),
        name: String(wallet.name || `Wallet ${index + 1}`).trim(),
        address,
        tagIds: [...new Set((wallet.tagIds || []).filter(id => tagIds.has(id)))],
        status: ['active', 'disabled', 'error'].includes(wallet.status) ? wallet.status : 'active',
        chainIds: Array.isArray(wallet.chainIds) && wallet.chainIds.length
          ? wallet.chainIds : (address.startsWith('0x') ? ['evm'] : ['solana']),
        signerType: wallet.signerType || 'watch-only',
      };
    })
    .filter(Boolean);
  return { version: DIRECTORY_VERSION, wallets, tags };
}

export function deriveWalletGroups(directory) {
  return directory.tags.map(tag => ({
    ...tag,
    addresses: directory.wallets
      .filter(wallet => wallet.tagIds.includes(tag.id))
      .map(wallet => wallet.address),
  }));
}

export function createTag(directory, name) {
  const normalizedName = normalizeTagName(name);
  if (!normalizedName) return directory;
  if (directory.tags.some(tag => tag.normalizedName === normalizedName)) return directory;
  const tag = {
    id: `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(name).trim().replace(/\s+/g, ' '),
    normalizedName,
    color: TAG_COLORS[directory.tags.length % TAG_COLORS.length],
    description: '',
  };
  return { ...directory, tags: [...directory.tags, tag] };
}

export function addAddressesToTag(directory, tagId, addresses) {
  if (!directory.tags.some(tag => tag.id === tagId)) return directory;
  const wallets = directory.wallets.map(wallet => ({ ...wallet, tagIds: [...wallet.tagIds] }));
  const byAddress = new Map(wallets.map(wallet => [normalizeAddress(wallet.address), wallet]));

  for (const raw of addresses) {
    const address = String(raw || '').trim();
    const normalized = normalizeAddress(address);
    if (!normalized) continue;
    let wallet = byAddress.get(normalized);
    if (!wallet) {
      wallet = {
        id: stableWalletId(address),
        name: `Wallet ${wallets.length + 1}`,
        address,
        tagIds: [],
        status: 'active',
      };
      wallets.push(wallet);
      byAddress.set(normalized, wallet);
    }
    if (!wallet.tagIds.includes(tagId)) wallet.tagIds.push(tagId);
  }
  return { ...directory, wallets };
}

export function addWallet(directory, { address: rawAddress, name, tagIds = [] }) {
  const address = String(rawAddress || '').trim();
  const normalized = normalizeAddress(address);
  if (!normalized) return directory;
  const validTags = new Set(directory.tags.map(tag => tag.id));
  const assignedTags = [...new Set(tagIds.filter(tagId => validTags.has(tagId)))];
  const existing = directory.wallets.find(wallet => normalizeAddress(wallet.address) === normalized);
  if (existing) {
    return {
      ...directory,
      wallets: directory.wallets.map(wallet => wallet.id === existing.id ? {
        ...wallet,
        name: String(name || wallet.name).trim() || wallet.name,
        tagIds: [...new Set([...wallet.tagIds, ...assignedTags])],
      } : wallet),
    };
  }
  return {
    ...directory,
    wallets: [...directory.wallets, {
      id: stableWalletId(address),
      name: String(name || `Wallet ${directory.wallets.length + 1}`).trim(),
      address,
      tagIds: assignedTags,
      status: 'active',
    }],
  };
}

export function setWalletTag(directory, walletId, tagId, assigned) {
  return {
    ...directory,
    wallets: directory.wallets.map(wallet => {
      if (wallet.id !== walletId) return wallet;
      const tagIds = assigned
        ? [...new Set([...wallet.tagIds, tagId])]
        : wallet.tagIds.filter(id => id !== tagId);
      return { ...wallet, tagIds };
    }),
  };
}

export function setWalletsTag(directory, walletIds, tagId, assigned) {
  const selected = new Set(walletIds);
  return {
    ...directory,
    wallets: directory.wallets.map(wallet => {
      if (!selected.has(wallet.id)) return wallet;
      return {
        ...wallet,
        tagIds: assigned
          ? [...new Set([...wallet.tagIds, tagId])]
          : wallet.tagIds.filter(id => id !== tagId),
      };
    }),
  };
}

export function deleteTag(directory, tagId) {
  return {
    ...directory,
    tags: directory.tags.filter(tag => tag.id !== tagId),
    wallets: directory.wallets.map(wallet => ({
      ...wallet,
      tagIds: wallet.tagIds.filter(id => id !== tagId),
    })),
  };
}

export function updateTag(directory, tagId, patch) {
  const nextName = patch.name?.trim();
  const normalizedName = nextName ? normalizeTagName(nextName) : null;
  if (normalizedName && directory.tags.some(tag => tag.id !== tagId && tag.normalizedName === normalizedName)) {
    return directory;
  }
  return {
    ...directory,
    tags: directory.tags.map(tag => tag.id === tagId ? {
      ...tag,
      ...patch,
      ...(nextName ? { name: nextName, normalizedName } : {}),
    } : tag),
  };
}

export function updateWallet(directory, walletId, patch) {
  return {
    ...directory,
    wallets: directory.wallets.map(wallet => wallet.id === walletId ? { ...wallet, ...patch } : wallet),
  };
}

export function deleteWallet(directory, walletId) {
  return {
    ...directory,
    wallets: directory.wallets.filter(wallet => wallet.id !== walletId),
  };
}

export function deleteWallets(directory, walletIds) {
  const wanted = new Set(walletIds || []);
  return {
    ...directory,
    wallets: directory.wallets.filter(wallet => !wanted.has(wallet.id)),
  };
}
