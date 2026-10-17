import http.server
import socketserver
import threading
import requests
import time
import os

# Configuration
AUDIO_DIR = r"C:\Users\admin\Desktop\pro\Asthma Detection Dataset Version 2\copd"
AUDIO_FILE = "P2COPDMc_10.wav"
FILE_SERVER_PORT = 8080
WEBHOOK_URL = "http://localhost:5000/api/whatsapp"

def run_file_server():
    os.chdir(AUDIO_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", FILE_SERVER_PORT), handler) as httpd:
        print(f"📂 File server running at http://localhost:{FILE_SERVER_PORT}")
        httpd.serve_forever()

def test_webhook():
    # Start file server in background
    server_thread = threading.Thread(target=run_file_server, daemon=True)
    server_thread.start()
    time.sleep(2) # Wait for server to start

    # Construct Mock Twilio Payload
    payload = {
        "NumMedia": "1",
        "MediaUrl0": f"http://localhost:{FILE_SERVER_PORT}/{AUDIO_FILE}",
        "MediaContentType0": "audio/wav",
        "From": "whatsapp:+1234567890",
        "Body": ""
    }

    print(f"\n🚀 Sending mock WhatsApp request to {WEBHOOK_URL}...")
    print(f"🔗 Payload Media URL: {payload['MediaUrl0']}")

    try:
        response = requests.post(WEBHOOK_URL, data=payload)
        
        print("\n✅ Response Received:")
        print(f"Status Code: {response.status_code}")
        print("Body (TwiML):")
        print(response.text)
        
        if "<Response>" in response.text and "Analysis Result" in response.text:
            print("\n🎉 SUCCESS: Webhook processed the audio and returned a result!")
        else:
            print("\n⚠️ WARNING: Response format unexpected.")

    except Exception as e:
        print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    test_webhook()
