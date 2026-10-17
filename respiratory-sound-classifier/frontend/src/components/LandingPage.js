import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../App.css';

function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="container landing-container">
      <div className="header-icon landing-icon">🫁</div>
      
      <h1 className="landing-title">
        Respiratory Health AI
      </h1>
      
      <p className="subtitle landing-subtitle">
        Advanced respiratory disease detection using artificial intelligence. 
        Analyze breath sounds for early indicators of Asthma, COPD, Pneumonia, and more.
      </p>

      <div className="landing-cta">
        <button 
          onClick={() => navigate('/detect')} 
          className="btn-primary btn-large"
        >
          Check Disease Detection
        </button>
      </div>

      <div className="info-section features-grid">
        <h4>Why use this tool?</h4>
        <ul className="features-list">
          <li>🚀 Instant Analysis with Deep Learning</li>
          <li>📊 Detailed Confidence Metrics</li>
          <li>🛡️ Privacy-Focused Processing</li>
          <li>⚕️ Supports Multiple Conditions</li>
        </ul>
      </div>
    </div>
  );
}

export default LandingPage;
