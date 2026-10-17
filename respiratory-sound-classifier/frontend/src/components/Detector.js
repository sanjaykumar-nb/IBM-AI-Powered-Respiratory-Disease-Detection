import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from './FileUpload';
import ResultsDisplay from './ResultsDisplay';
import ParticleLoader from './ParticleLoader';

function Detector() {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handlePrediction = (result) => {
    setPrediction(result);
    setError(null);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setPrediction(null);
  };

  const handleReset = () => {
    setPrediction(null);
    setError(null);
    setLoading(false);
  };

  return (
    <div className="container">
      <header className="app-header">
        <div className="header-icon">🫁</div>
        <h1>Respiratory Sound Classifier</h1>
        <p className="subtitle">AI-Powered Respiratory Disease Detection</p>
      </header>

      <div className="main-content">
        {!prediction && !loading && (
          <FileUpload
            onPrediction={handlePrediction}
            onError={handleError}
            setLoading={setLoading}
          />
        )}

        {loading && <ParticleLoader />}

        {error && (
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={handleReset} className="btn-primary">
              Try Again
            </button>
          </div>
        )}

        {prediction && !loading && (
          <ResultsDisplay prediction={prediction} onReset={handleReset} />
        )}
      </div>

      <footer className="app-footer">
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#64748b', marginBottom: '20px', cursor: 'pointer', textDecoration: 'underline' }}>
          ← Back to Home
        </button>
        <p>⚕️ For research and educational purposes only</p>
        <p className="footer-note">Not a substitute for professional medical diagnosis</p>
      </footer>
    </div>
  );
}

export default Detector;
