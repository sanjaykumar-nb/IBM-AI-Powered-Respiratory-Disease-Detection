# Jupyter Kernel Crash Fix

## Problem
The Jupyter kernel crashes when loading audio files with the message:
```
The Kernel crashed while executing code in the current cell or a previous cell.
```

## Common Causes & Solutions

### 1. Memory Issue (Most Likely)

**Solution A: Restart Kernel and Clear Output**
```python
# In Jupyter: Kernel → Restart & Clear Output
# Then run cells one by one
```

**Solution B: Add Memory Management**
```python
import gc

# After processing each file
gc.collect()
```

### 2. Librosa/NumPy Compatibility Issue

**Solution: Update packages**
```bash
pip install --upgrade librosa numpy soundfile
```

### 3. Audio File Corruption

**Solution: Test with a simple audio load**
```python
import librosa
import numpy as np

# Test loading
try:
    audio, sr = librosa.load('P2COPDMc_10.wav', sr=None, duration=1.0)
    print(f"Success! Shape: {audio.shape}, SR: {sr}")
except Exception as e:
    print(f"Error: {e}")
```

### 4. Large Dataset Loading All at Once

**Solution: Process files one at a time**
```python
# Instead of loading all files at once, use a generator
def process_files_safely(file_list):
    for file_path in file_list:
        try:
            # Process one file
            result = predict_single_file(file_path)
            yield result
            
            # Clear memory
            import gc
            gc.collect()
        except Exception as e:
            print(f"Error with {file_path}: {e}")
            continue
```

---

## Quick Fix for Your Notebook

Add this at the beginning of your notebook:

```python
import warnings
warnings.filterwarnings('ignore')

# Limit memory usage
import os
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

# Clear memory function
import gc
def clear_memory():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
```

And modify your prediction loop:

```python
# Process files safely
for audio_file in audio_files[:10]:  # Start with just 10 files
    try:
        print(f"Processing: {audio_file}")
        result = predict_single_file(audio_file)
        print(f"Prediction: {result['predicted_class']}")
        
        # Clear memory after each file
        clear_memory()
        
    except Exception as e:
        print(f"Error: {e}")
        continue
```

---

## Alternative: Use the Standalone Script

Instead of running in Jupyter, use the standalone Python script:

```bash
cd c:\Users\admin\Desktop\pro
python -c "
from model_trained import *  # If you have the functions exported
# Or create a separate test script
"
```

---

## Create a Safe Test Script

Create `test_prediction.py`:

```python
import os
import torch
import librosa
import numpy as np
from pathlib import Path

# Set environment variables for stability
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

def test_single_audio(audio_path):
    """Test loading and processing a single audio file"""
    try:
        print(f"Testing: {audio_path}")
        
        # Load audio
        audio, sr = librosa.load(audio_path, sr=16000)
        print(f"✓ Loaded: shape={audio.shape}, sr={sr}")
        
        # Process to 5 seconds
        target_samples = 16000 * 5
        if len(audio) > target_samples:
            start = (len(audio) - target_samples) // 2
            audio = audio[start:start + target_samples]
        else:
            padding = target_samples - len(audio)
            audio = np.pad(audio, (0, padding), mode='constant')
        
        print(f"✓ Processed: shape={audio.shape}")
        
        # Normalize
        if np.max(np.abs(audio)) > 0:
            audio = audio / np.max(np.abs(audio))
        
        print(f"✓ Normalized: max={np.max(audio):.3f}, min={np.min(audio):.3f}")
        
        return True
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    # Test with one file
    test_file = "Asthma Detection Dataset Version 2/copd/P2COPDMc_10.wav"
    
    if os.path.exists(test_file):
        success = test_single_audio(test_file)
        print(f"\nTest {'PASSED' if success else 'FAILED'}")
    else:
        print(f"File not found: {test_file}")
        print("\nAvailable files:")
        for f in Path("Asthma Detection Dataset Version 2").rglob("*.wav")[:5]:
            print(f"  {f}")
```

Run with:
```bash
python test_prediction.py
```

---

## If Problem Persists

1. **Check audio file integrity:**
```bash
python -c "import librosa; audio, sr = librosa.load('P2COPDMc_10.wav'); print(f'OK: {len(audio)} samples')"
```

2. **Check available memory:**
```python
import psutil
print(f"Available RAM: {psutil.virtual_memory().available / (1024**3):.2f} GB")
```

3. **Use smaller batch size:**
```python
# In your training/prediction code
batch_size = 4  # Reduce from 16
```

4. **Restart Jupyter completely:**
- Close Jupyter
- Clear browser cache
- Restart Jupyter server

---

## Prevention

Add to the top of your notebook:

```python
# Prevent kernel crashes
import os
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

# Memory management
import gc
gc.enable()

# Warnings
import warnings
warnings.filterwarnings('ignore')
```
