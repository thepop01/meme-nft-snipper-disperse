import { loadWallets, saveWallets, upsertWallets } from './tracker.js';
import { upsertWalletsDb } from './db.js';
import { normalizeAddress } from './addresses.js';

export async function persistWallets(db, incoming = []) {
  const wallets = Array.isArray(incoming) ? incoming : [];
  if (db && wallets.length > 0) {
    await upsertWalletsDb(db, wallets);
  }
  const doc = loadWallets();
  const updated = wallets.length > 0 ? upsertWallets(doc.wallets || [], wallets) : (doc.wallets || []);
  if (wallets.length > 0) {
    saveWallets({ ...doc, wallets: updated });
  }
  return updated;
}

export async function removeWallet(db, chain, address) {
  const norm = normalizeAddress(chain, address);
  if (db) {
    await db.query('DELETE FROM smart_wallets WHERE chain = $1 AND address = $2', [chain, norm]);
  }
  const doc = loadWallets();
  const remaining = (doc.wallets || []).filter(
    w => !(w.chain === chain && (w.chain === 'robinhood' ? String(w.address).toLowerCase() : String(w.address)) === norm)
  );
  saveWallets({ ...doc, wallets: remaining });
  return remaining;
}
