# Wallet Types + umi-style UI Redesign — Design

Date: 2026-08-22
Status: Approved (Option A)

## Goal

Two wallet types in one unified list — **Watch-only** (address only) and
**Signer** (address + private key) — with an encrypted server-side vault,
umi-style UI for the Wallets and Disperse pages, larger readable fonts, and
Mint Bot reading the same unified list.

## Decisions (from brainstorm)

- One unified wallet table; type shown as a badge column; watch-only can be
  promoted to Signer by attaching a private key.
- Private keys live in a **backend-encrypted vault** (AES-256-GCM, scrypt-derived
  key from a profile password). Keys never leave the server after save.
- Scope includes the Mint Bot wallet picker.

## Backend

1. New `src/wallets/vault.js`:
   - `initVault(password)` — one-time setup; stores scrypt salt + verifier in
     `signer-vault` store.
   - `unlockVault(password)` / `lockVault()` / `isUnlocked()` / `isInitialized()`.
   - `setWalletKey(walletId, privateKey)` — validates the key derives the same
     address, encrypts (AES-256-GCM), persists; never returned afterwards.
   - `removeWalletKey(walletId)`, `hasWalletKey(walletId)`.
   - `getDecryptedKeys(addresses)` — internal use by executors; throws when locked.
2. Routes under `/api/wallets/vault`: `init`, `unlock`, `lock`, `status`;
   `POST/DELETE /api/wallets/:id/key`; directory responses gain computed `hasKey`.
3. Mint arming: `POST /api/nft/jobs/:id/arm` falls back to vault keys for job
   wallets when the client sends none (vault must be unlocked).
4. Balances: `POST /api/wallets/balances` `{ chain, addresses }` → ETH balance
   per address via the NFT chain RPC config.

## Frontend

1. **Wallets page**: single unified table (checkbox · NAME · TYPE · ADDRESS ·
   CHAIN · BALANCE · TAGS · actions). Toolbar: search right-aligned, "+ Create"
   and "Import" top-right. Type badges: green key = Signer, eye = Watch-only.
   Promote flow: key-icon action opens modal (private key + vault password).
   Old "Signing Wallets" tab replaced by one-click migration of any existing
   browser-local signing wallets into the vault.
2. **Disperse page**: SENDERS lists Signers only; RECIPIENTS lists everyone;
   MODE dropdown + PER-WALLET stepper kept; umi visual pass.
3. **Mint Bot**: wallet picker reads unified directory; signers selectable,
   watch-only marked ineligible.
4. **Fonts**: base bumped toward umi (~14px): tables 0.85–0.9rem rows, 0.7rem
   uppercase headers, mono addresses.

## Security notes

- Keys encrypted at rest; plaintext only in server memory while unlocked.
- No key material ever returned by any API response; audit log records
  set/remove without secrets.

## Migration

- If `senderWalletStore` has an unlocked/local profile, Wallets page shows a
  one-click "Import signing wallets" banner that pushes each key through the
  vault-set flow.
