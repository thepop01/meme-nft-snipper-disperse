import React, { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { getBackendUrl, authHeaders, subscribeWs } from '../../utils/sniperApi.js';

const AlertBell = () => {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/alerts`, { headers: authHeaders() });
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => {
    fetchAlerts();
    return subscribeWs((msg) => {
      if (msg.type === 'alert:new') setAlerts(prev => [msg.alert, ...prev].slice(0, 200));
    });
  }, [fetchAlerts]);

  const unread = alerts.filter(a => !a.read).length;

  const openPanel = async () => {
    setOpen(o => !o);
    if (!open && unread > 0) {
      try {
        const res = await fetch(`${getBackendUrl()}/api/alerts/read`, { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        setAlerts(data.alerts || []);
      } catch { /* ignore */ }
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={openPanel} title="Alerts" style={{ position: 'relative' }}>
        <Bell size={18} />
        {unread > 0 && (
          <span className="badge" style={{ position: 'absolute', top: -4, right: -6, fontSize: '0.6rem' }}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="panel" style={{
          position: 'absolute', bottom: '2.5rem', left: 0, width: 320, maxHeight: 420,
          overflowY: 'auto', zIndex: 50, padding: '0.75rem',
        }}>
          {alerts.length === 0
            ? <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No alerts yet</p>
            : alerts.slice(0, 50).map(a => (
              <div key={a.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{
                  fontSize: '0.82rem', fontWeight: 600,
                  color: a.severity === 'critical' ? 'var(--danger, #f87171)' : 'var(--text)',
                }}>
                  {a.title}
                </div>
                {a.body && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.body}</div>}
                <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                  {new Date(a.ts).toLocaleTimeString()}
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
};

export default AlertBell;
