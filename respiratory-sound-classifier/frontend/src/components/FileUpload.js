import React, { useState, useRef } from 'react';
import axios from 'axios';

// Same-origin '/api' in production (nginx proxies it); override with REACT_APP_API_URL for local dev
const API_URL = process.env.REACT_APP_API_URL || '/api';

function FileUpload({ onPrediction, onError, setLoading }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.wav')) {
      onError('Please upload a WAV audio file');
      return;
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      onError('File size must be less than 50MB');
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      onError('Please select a file first');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('audio', selectedFile);

    try {
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        onPrediction(response.data.prediction);
      } else {
        onError('Failed to get prediction');
      }
    } catch (error) {
      console.error('Upload error:', error);
      onError(
        error.response?.data?.error || 
        'Failed to upload file. Please ensure the backend server is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  return (
    <div className="upload-container">
      <div
        className={`upload-area ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav"
          onChange={handleChange}
          style={{ display: 'none' }}
        />

        <div className="upload-icon">📁</div>
        <h3>Upload Respiratory Sound</h3>
        <p>Drag and drop your WAV file here, or click to browse</p>
        <p className="file-requirements">Supported format: WAV | Max size: 50MB</p>

        {selectedFile && (
          <div className="selected-file">
            <span className="file-icon">🎵</span>
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">
              ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>
        )}
      </div>

      {selectedFile && (
        <button onClick={handleUpload} className="btn-primary btn-upload">
          Analyze Audio
        </button>
      )}

      <div className="info-section">
        <h4>ℹ️ About This Tool</h4>
        <p>
          This AI system classifies respiratory sounds into five categories:
        </p>
        <ul className="condition-list">
          <li>🫁 <strong>Healthy</strong> - Normal breathing patterns</li>
          <li>🌬️ <strong>Asthma</strong> - Wheezing and airway obstruction</li>
          <li>💨 <strong>COPD</strong> - Chronic obstructive pulmonary disease</li>
          <li>🦠 <strong>Pneumonia</strong> - Lung infection indicators</li>
          <li>🔊 <strong>Bronchial</strong> - Abnormal bronchial sounds</li>
        </ul>
      </div>
    </div>
  );
}

export default FileUpload;
