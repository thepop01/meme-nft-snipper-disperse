import React from 'react';

export const UMI_CHAINS = [
  { id: 'ethereum', label: 'Ethereum', color: '#627eea', symbol: 'Ξ', iconType: 'eth' },
  { id: 'starknet', label: 'Starknet', color: '#0c0c4f', symbol: '★', iconType: 'starknet' },
  { id: 'linea', label: 'Linea', color: '#121212', symbol: '—', iconType: 'linea' },
  { id: 'apechain', label: 'ApeChain', color: '#0054fa', symbol: 'APE', iconType: 'ape' },
  { id: 'base', label: 'Base', color: '#0052ff', symbol: 'B', iconType: 'base' },
  { id: 'arbitrum', label: 'Arbitrum', color: '#28a0f0', symbol: 'A', iconType: 'arb' },
  { id: 'mantle', label: 'Mantle', color: '#000000', symbol: 'M', iconType: 'mantle' },
  { id: 'polygon', label: 'Polygon', color: '#8247e5', symbol: 'P', iconType: 'polygon' },
  { id: 'bsc', label: 'BNB Chain', color: '#f0b90b', symbol: 'B', iconType: 'bsc' },
  { id: 'zksync', label: 'zkSync', color: '#1035ac', symbol: 'Z', iconType: 'zksync' },
  { id: 'scroll', label: 'Scroll', color: '#ffe7c7', symbol: 'S', iconType: 'scroll' },
  { id: 'metis', label: 'Metis', color: '#00d2ff', symbol: 'M', iconType: 'metis' },
  { id: 'celestia', label: 'Celestia', color: '#7b2bf9', symbol: 'C', iconType: 'celestia' },
  { id: 'blast', label: 'Blast', color: '#fcfe00', symbol: 'B', iconType: 'blast' },
  { id: 'mode', label: 'Mode', color: '#dffe00', symbol: 'M', iconType: 'mode' },
  { id: 'zora', label: 'Zora', color: '#000000', symbol: 'Z', iconType: 'zora' },
  { id: 'optimism', label: 'Optimism', color: '#ff0420', symbol: 'O', iconType: 'op' },
  { id: 'avalanche', label: 'Avalanche', color: '#e84142', symbol: 'A', iconType: 'avax' },
  { id: 'solana', label: 'Solana', color: '#9945ff', symbol: 'S', iconType: 'sol' },
  { id: 'robinhood', label: 'Robinhood', color: '#00c805', symbol: 'R', iconType: 'robinhood' },
  { id: 'monad', label: 'Monad', color: '#836ef9', symbol: 'M', iconType: 'monad' },
];

export function EthGlyphSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '4px' }}>
      <circle cx="8" cy="8" r="8" fill="#4f46e5" />
      <path d="M8 2.5v4.1l3.4 1.55L8 2.5z" fill="#fff" opacity=".65" />
      <path d="M8 2.5L4.6 8.15 8 6.6V2.5z" fill="#fff" />
      <path d="M8 10.85l3.4-2.05L8 13.5v-2.65z" fill="#fff" opacity=".65" />
      <path d="M4.6 8.8L8 10.85V13.5L4.6 8.8z" fill="#fff" />
    </svg>
  );
}

export function ChainSvgIcon({ type, size = 18 }) {
  switch (type) {
    case 'eth':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M11.999 1.5L4.5 13.882L11.999 18.25L19.5 13.882L11.999 1.5Z" fill="#627EEA" />
          <path d="M11.999 1.5L4.5 13.882L11.999 18.25V1.5Z" fill="#8C9FE8" />
          <path d="M11.999 19.539L4.5 15.172L11.999 22.5L19.5 15.172L11.999 19.539Z" fill="#627EEA" />
          <path d="M11.999 19.539V22.5L19.5 15.172L11.999 19.539Z" fill="#8C9FE8" />
        </svg>
      );
    case 'starknet':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#0C0C4F" />
          <path d="M12 4L14 10H20L15 14L17 20L12 16L7 20L9 14L4 10H10L12 4Z" fill="#EC796B" />
        </svg>
      );
    case 'linea':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#121212" />
          <rect x="6" y="10.5" width="12" height="3" rx="1.5" fill="#61DFFF" />
        </svg>
      );
    case 'ape':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#0054FA" />
          <text x="12" y="15" textAnchor="middle" fill="#FFFFFF" fontSize="8" fontWeight="bold" fontFamily="sans-serif">APE</text>
        </svg>
      );
    case 'base':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#0052FF" />
          <circle cx="12" cy="12" r="5" fill="#FFFFFF" />
        </svg>
      );
    case 'arb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#28A0F0" />
          <path d="M12 6L6 16H10L12 12L14 16H18L12 6Z" fill="#FFFFFF" />
        </svg>
      );
    case 'mantle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#000000" />
          <circle cx="8" cy="12" r="2.5" fill="#65B3AD" />
          <circle cx="16" cy="12" r="2.5" fill="#65B3AD" />
          <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="#65B3AD" strokeWidth="2" />
        </svg>
      );
    case 'polygon':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#8247E5" />
          <path d="M12 6.5L16.5 9V14L12 16.5L7.5 14V9L12 6.5Z" fill="#FFFFFF" />
        </svg>
      );
    case 'bsc':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#F0B90B" />
          <path d="M12 6L14.5 8.5L12 11L9.5 8.5L12 6Z" fill="#FFFFFF" />
          <path d="M8 12L10.5 9.5L12 11L10.5 12.5L8 12Z" fill="#FFFFFF" />
          <path d="M16 12L13.5 9.5L12 11L13.5 12.5L16 12Z" fill="#FFFFFF" />
          <path d="M12 18L9.5 15.5L12 13L14.5 15.5L12 18Z" fill="#FFFFFF" />
        </svg>
      );
    case 'zksync':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#1035AC" />
          <path d="M6 14L12 8L18 14H14L12 12L10 14H6Z" fill="#8C8EFA" />
        </svg>
      );
    case 'scroll':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#FFE7C7" />
          <path d="M8 9C8 7.9 8.9 7 10 7H14C15.1 7 16 7.9 16 9V15C16 16.1 15.1 17 14 17H10C8.9 17 8 16.1 8 15V9Z" fill="#E59960" />
        </svg>
      );
    case 'metis':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#00D2FF" />
          <text x="12" y="16" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="900" fontFamily="sans-serif">M</text>
        </svg>
      );
    case 'celestia':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#7B2BF9" />
          <circle cx="12" cy="12" r="4" fill="#FFFFFF" />
          <circle cx="12" cy="7" r="1.5" fill="#FFFFFF" />
          <circle cx="12" cy="17" r="1.5" fill="#FFFFFF" />
          <circle cx="7" cy="12" r="1.5" fill="#FFFFFF" />
          <circle cx="17" cy="12" r="1.5" fill="#FFFFFF" />
        </svg>
      );
    case 'blast':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#FCFE00" />
          <path d="M7 15L12 8L17 15H7Z" fill="#000000" />
        </svg>
      );
    case 'mode':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#DFFE00" />
          <circle cx="12" cy="12" r="4" fill="#111111" />
        </svg>
      );
    case 'zora':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#111827" />
          <circle cx="12" cy="12" r="6" fill="url(#zora-grad)" />
          <defs>
            <radialGradient id="zora-grad" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#EC4899" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </radialGradient>
          </defs>
        </svg>
      );
    case 'op':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#FF0420" />
          <text x="12" y="16" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily="sans-serif">OP</text>
        </svg>
      );
    case 'avax':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#E84142" />
          <path d="M12 6L6 17H9L12 11L15 17H18L12 6Z" fill="#FFFFFF" />
        </svg>
      );
    case 'sol':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#111827" />
          <path d="M6 8H16L18 6H8L6 8Z" fill="#14F195" />
          <path d="M8 13H18L16 11H6L8 13Z" fill="#9945FF" />
          <path d="M6 18H16L18 16H8L6 18Z" fill="#14F195" />
        </svg>
      );
    case 'robinhood':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#00C805" />
          <text x="12" y="16" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="900" fontFamily="sans-serif">R</text>
        </svg>
      );
    case 'monad':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#836EF9" />
          <text x="12" y="16" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="900" fontFamily="sans-serif">M</text>
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#6B7280" />
          <circle cx="12" cy="12" r="4" fill="#FFFFFF" />
        </svg>
      );
  }
}

export function ChainBar({ activeChain = 'ethereum', onSelectChain }) {
  return (
    <div className="umi-chain-bar-wrapper">
      <div className="umi-chain-bar">
        {UMI_CHAINS.map(chain => {
          const isActive = activeChain === chain.id;
          return (
            <button
              key={chain.id}
              type="button"
              className={`umi-chain-icon-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectChain?.(chain.id)}
              title={chain.label}
            >
              <ChainSvgIcon type={chain.iconType} size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
