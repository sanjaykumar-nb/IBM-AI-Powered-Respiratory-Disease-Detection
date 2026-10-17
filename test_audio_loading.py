import os
import torch
import librosa
import numpy as np
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Set environment variables for stability
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'

def test_single_audio(audio_path):
    """Test loading and processing a single audio file"""
    try:
        print(f"\nTesting: {audio_path}")
        print("-" * 50)
        
        # Load audio
        print("Loading audio file...")
        audio, sr = librosa.load(audio_path, sr=16000)
        print(f"✓ Loaded successfully")
        print(f"  Shape: {audio.shape}")
        print(f"  Sample rate: {sr} Hz")
        print(f"  Duration: {len(audio)/sr:.2f} seconds")
        
        # Process to 5 seconds
        print("\nProcessing to 5 seconds...")
        target_samples = 16000 * 5
        if len(audio) > target_samples:
            start = (len(audio) - target_samples) // 2
            audio = audio[start:start + target_samples]
            print(f"✓ Trimmed from center")
        else:
            padding = target_samples - len(audio)
            audio = np.pad(audio, (0, padding), mode='constant')
            print(f"✓ Padded with {padding} samples")
        
        print(f"  Final shape: {audio.shape}")
        
        # Normalize
        print("\nNormalizing...")
        if np.max(np.abs(audio)) > 0:
            audio = audio / np.max(np.abs(audio))
            print(f"✓ Normalized")
        else:
            print("⚠ Warning: Audio is silent!")
        
        print(f"  Max value: {np.max(audio):.3f}")
        print(f"  Min value: {np.min(audio):.3f}")
        print(f"  Mean value: {np.mean(audio):.3f}")
        
        # Extract basic features
        print("\nExtracting features...")
        mfccs = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=20)
        print(f"✓ MFCCs extracted: {mfccs.shape}")
        
        print("\n" + "="*50)
        print("TEST PASSED ✓")
        print("="*50)
        return True
        
    except Exception as e:
        print(f"\n{'='*50}")
        print("TEST FAILED ✗")
        print("="*50)
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def find_test_file():
    """Find a test audio file"""
    dataset_path = Path("Asthma Detection Dataset Version 2")
    
    if not dataset_path.exists():
        print(f"Dataset not found at: {dataset_path}")
        return None
    
    # Try to find the specific file mentioned in error
    test_file = dataset_path / "copd" / "P2COPDMc_10.wav"
    if test_file.exists():
        return str(test_file)
    
    # Otherwise find any wav file
    wav_files = list(dataset_path.rglob("*.wav"))
    if wav_files:
        return str(wav_files[0])
    
    return None

if __name__ == "__main__":
    print("="*50)
    print("AUDIO FILE LOADING TEST")
    print("="*50)
    
    # Check librosa version
    print(f"\nLibrosa version: {librosa.__version__}")
    print(f"NumPy version: {np.__version__}")
    print(f"PyTorch version: {torch.__version__}")
    
    # Find test file
    test_file = find_test_file()
    
    if test_file:
        print(f"\nTest file: {test_file}")
        success = test_single_audio(test_file)
        
        if success:
            print("\n✓ Your audio processing pipeline is working correctly!")
            print("  The kernel crash is likely due to memory issues.")
            print("  Try processing files one at a time with gc.collect() between files.")
        else:
            print("\n✗ There's an issue with audio processing.")
            print("  Check the error message above for details.")
    else:
        print("\n✗ No test file found!")
        print("  Please check the dataset path.")
        print(f"  Expected: Asthma Detection Dataset Version 2/")
