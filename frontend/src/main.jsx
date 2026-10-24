import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('UI Crash Error caught by Boundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#080c14',
          color: '#f8fafc',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <h2 style={{ color: '#f43f5e', marginBottom: '1rem' }}>Something went wrong rendering the UI</h2>
          <pre style={{
            background: '#0f172a',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            maxWidth: '600px',
            overflow: 'auto',
            fontSize: '12px',
            color: '#94a3b8'
          }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.5rem',
              padding: '0.6rem 1.2rem',
              background: '#38bdf8',
              color: '#080c14',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
