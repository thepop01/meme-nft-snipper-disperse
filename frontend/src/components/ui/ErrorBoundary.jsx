import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// Class component: React only routes render errors through componentDidCatch.
// Wraps each view so a crash in one tab shows an error card instead of
// white-screening the entire app.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.label || 'view'}] render crash:`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary-card">
        <div className="error-boundary-head">
          <AlertTriangle size={18} />
          <strong>{this.props.label || 'This page'} crashed</strong>
        </div>
        <p>The rest of the app is unaffected. The error below is what a blank screen used to hide:</p>
        <pre className="error-boundary-detail">{String(error?.message || error)}{'\n'}{error?.stack?.split('\n').slice(1, 6).join('\n')}</pre>
        <button className="btn-outline" onClick={() => this.setState({ error: null })}>
          <RotateCcw size={14} /> Try again
        </button>
      </div>
    );
  }
}
