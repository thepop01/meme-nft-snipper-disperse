import React, { useCallback, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';
import { ToastContext } from './useToast';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((type, message, duration = 4200) => {
    const id = ++idCounter;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const api = {
    success: (msg) => push('success', msg),
    error: (msg) => push('error', msg, 6000),
    info: (msg) => push('info', msg),
    warning: (msg) => push('warning', msg),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-container">
        {toasts.map(t => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`toast ${t.type}`}>
              <Icon size={16} className="toast-icon" />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
