// Shared hook for backend connectivity + WS reconnection.
// Replaces the duplicated refresh-on-mount + ws-reconnect + offline-banner
// pattern across DashboardView, MemeFinderView, SniperView, BotsView.
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, subscribeWs } from './sniperApi';

/**
 * @param {object} opts
 * @param {Function} opts.onMessage - called for every WS message (after ws:status)
 * @param {string[]} opts.wsTypes - which event types trigger a refresh (default: all)
 */
export function useBackend({ onMessage, wsTypes } = {}) {
  const [backend, setBackend] = useState(undefined); // undefined=loading, null=offline, obj=connected
  const [wsOn, setWsOn] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const status = await api.status();
      if (mountedRef.current) setBackend(status);
    } catch {
      if (mountedRef.current) setBackend(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const unsub = subscribeWs((msg) => {
      if (msg.type === 'ws:status') {
        setWsOn(msg.connected);
        if (msg.connected) refresh();
        return;
      }
      if (wsTypes && !wsTypes.includes(msg.type)) return;
      onMessage?.(msg);
    });
    return () => { mountedRef.current = false; unsub(); };
  }, [refresh, onMessage, wsTypes]);

  return { backend, wsOn, refresh };
}
