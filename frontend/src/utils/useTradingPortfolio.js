import { useCallback, useEffect, useState } from 'react';
import { api, subscribeWs } from './sniperApi';

export function useTradingPortfolio({ tagIds = [], walletAddress = '' } = {}) {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [orders, setOrders] = useState([]);
  const [fills, setFills] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [loading, setLoading] = useState(true);

  const tagKey = tagIds.join(',');
  const refresh = useCallback(async () => {
    try {
      const params = {};
      if (tagKey) params.tagIds = tagKey;
      if (walletAddress) params.walletAddress = walletAddress;
      const [positionData, tradeData, orderData, fillData, pnlData] = await Promise.all([
        api.positions(params), api.trades(params), api.limitOrders(params), api.fills(params), api.pnl(params),
      ]);
      setPositions(positionData.positions || []);
      setTrades(tradeData.trades || []);
      setOrders(orderData.orders || []);
      setFills(fillData.fills || []);
      setPnl(pnlData.summary || null);
    } catch {
      // Connectivity is surfaced by the parent view.
    } finally {
      setLoading(false);
    }
  }, [tagKey, walletAddress]);

  useEffect(() => {
    refresh();
    return subscribeWs(message => {
      if (message.type === 'ws:status' && message.connected) refresh();
      if (message.type === 'position:update' && message.position) {
        setPositions(current => [message.position, ...current.filter(item => item.id !== message.position.id)]);
      }
      if (message.type === 'limitorder:update' && message.order) {
        setOrders(current => [message.order, ...current.filter(item => item.id !== message.order.id)]);
      }
      if (message.type === 'trade:executed') refresh();
      if (message.type === 'fill:confirmed') refresh();
    });
  }, [refresh]);

  return { positions, trades, orders, fills, pnl, loading, refresh };
}
