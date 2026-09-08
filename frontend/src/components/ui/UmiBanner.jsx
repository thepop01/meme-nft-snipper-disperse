import React from 'react';

export function UmiBanner({ onAction }) {
  return (
    <div className="umi-top-banner greeting-banner">
      <div className="umi-banner-greeting">
        <span className="umi-banner-emoji">✨</span>
        <span className="umi-banner-text">
          <strong>Welcome back!</strong> Multi-wallet management, batch disperse, and automated mint bot are active.
        </span>
      </div>
      <div className="umi-banner-status-tag">
        <span className="umi-status-dot-pulse" />
        <span>All Systems Operational</span>
      </div>
    </div>
  );
}

export default UmiBanner;
