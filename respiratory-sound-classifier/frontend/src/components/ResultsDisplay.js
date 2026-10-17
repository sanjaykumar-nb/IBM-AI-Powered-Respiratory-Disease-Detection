import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const COLORS = {
  'Healthy': '#10b981',       // Emerald 500
  'Asthma': '#f59e0b',        // Amber 500
  'COPD': '#ef4444',          // Red 500
  'Pneumonia': '#a78bfa',     // Violet 400 (lighter for dark mode)
  'Bronchial': '#60a5fa'      // Blue 400 (lighter for dark mode)
};

const ICONS = {
  'Healthy': '✅',
  'Asthma': '🌬️',
  'COPD': '💨',
  'Pneumonia': '🦠',
  'Bronchial': '🔊'
};

function ResultsDisplay({ prediction, onReset }) {
  const { predicted_class, confidence, all_probabilities } = prediction;

  // Prepare data for pie chart
  const chartData = Object.entries(all_probabilities).map(([name, value]) => ({
    name,
    value: (value * 100).toFixed(2),
    percentage: value
  }));

  // Sort probabilities for display
  const sortedProbs = Object.entries(all_probabilities)
    .sort((a, b) => b[1] - a[1]);

  const getConditionInfo = (condition) => {
    const info = {
      'Healthy': 'Normal respiratory function detected. No signs of respiratory disease.',
      'Asthma': 'Possible asthma indicators detected. Characterized by wheezing and airway inflammation.',
      'COPD': 'Chronic Obstructive Pulmonary Disease indicators detected. Progressive lung disease.',
      'Pneumonia': 'Possible pneumonia indicators detected. Lung infection with inflammation.',
      'Bronchial': 'Abnormal bronchial sounds detected. May indicate bronchial tube issues.'
    };
    return info[condition] || 'Analysis complete.';
  };

  return (
    <div className="results-container">
      <div className="results-header">
        <h2>Analysis Results</h2>
        <button onClick={onReset} className="btn-secondary">
          Analyze Another File
        </button>
      </div>

      <div className="prediction-card">
        <div className="prediction-main">
          <div className="prediction-icon">
            {ICONS[predicted_class] || '🫁'}
          </div>
          <div className="prediction-details">
            <h3>Detected Condition</h3>
            <div className="predicted-class">{predicted_class}</div>
            <div className="confidence-bar">
              <div className="confidence-label">
                Confidence: {(confidence * 100).toFixed(2)}%
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${confidence * 100}%`,
                    backgroundColor: COLORS[predicted_class]
                  }}
                ></div>
              </div>
            </div>
            <p className="condition-info">{getConditionInfo(predicted_class)}</p>
          </div>
        </div>
      </div>

      <div className="analysis-grid">
        <div className="probability-list">
          <h3>All Probabilities</h3>
          {sortedProbs.map(([condition, prob]) => (
            <div key={condition} className="probability-item">
              <div className="prob-label">
                <span className="prob-icon">{ICONS[condition]}</span>
                <span className="prob-name">{condition}</span>
              </div>
              <div className="prob-bar-container">
                <div
                  className="prob-bar"
                  style={{
                    width: `${prob * 100}%`,
                    backgroundColor: COLORS[condition]
                  }}
                ></div>
              </div>
              <span className="prob-value">{(prob * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>

        <div className="chart-container">
          <h3>Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) =>
                  percentage > 0.05 ? `${name} ${(percentage * 100).toFixed(0)}%` : ''
                }
                outerRadius={80}
                fill="#8884d8"
                dataKey="percentage"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${(value * 100).toFixed(2)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="disclaimer">
        <strong>⚠️ Medical Disclaimer:</strong> This is an AI-based analysis tool for research
        and educational purposes only. It should not be used as a substitute for professional
        medical diagnosis. Please consult a qualified healthcare provider for medical advice.
      </div>
    </div>
  );
}

export default ResultsDisplay;
