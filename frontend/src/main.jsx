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
          background: '#09090b',
          color: '#fafafa',
          padding: '2rem',
          fontFamily: "'Geist', -apple-system, sans-serif"
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '1rem', fontWeight: 600 }}>Something went wrong rendering the UI</h2>
          <pre style={{
            background: '#18181b',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #27272a',
            maxWidth: '600px',
            overflow: 'auto',
            fontSize: '12px',
            color: '#a1a1aa',
            fontFamily: "'Geist Mono', monospace"
          }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.2rem',
              background: '#fafafa',
              color: '#09090b',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: "'Geist', sans-serif"
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
