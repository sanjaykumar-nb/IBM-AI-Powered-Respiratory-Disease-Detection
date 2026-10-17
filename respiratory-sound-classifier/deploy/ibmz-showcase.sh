#!/usr/bin/env bash
# Shows, with live measurements, the IBM Z / LinuxONE technologies this deployment runs on.
# Meant for the demo video. Run on the LinuxONE server, with the app already deployed (deploy/deploy.sh):
#   bash deploy/ibmz-showcase.sh
# Read-only: it only reads /proc and /sys, runs benchmarks in memory and sends 5 dataset recordings
# to the running app.
set -u
cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
row() { printf '  %-36s %s\n' "$1" "$2"; }
yes_no() { if [[ " $FEATURES " == *" $1 "* ]]; then echo "yes"; else echo "no"; fi; }

ARCH=$(uname -m)
FEATURES=$(grep -m1 '^features' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs)
HTTP_PORT=$(grep -s '^HTTP_PORT=' .env | cut -d= -f2)
APP="${APP_URL:-http://localhost:${HTTP_PORT:-80}}"
DATASET="../Asthma Detection Dataset Version 2"

[[ "$ARCH" == "s390x" ]] || echo "Note: this machine is $ARCH, not IBM Z - the results below are not from LinuxONE."

# ------------------------------------------------------------------------------------------ 1
bold "1. The machine"
TYPE=$(awk -F: '/^Type:/ {gsub(/ /, "", $2); print $2; exit}' /proc/sysinfo 2>/dev/null)
TYPE=${TYPE:-$(grep -m1 -o 'machine = [0-9A-F]*' /proc/cpuinfo 2>/dev/null | awk '{print $3}')}
case "$TYPE" in
    2964|2965) NAME="IBM z13 / LinuxONE Emperor, Rockhopper" ;;
    3906|3907) NAME="IBM z14 / LinuxONE Emperor II, Rockhopper II" ;;
    8561|8562) NAME="IBM z15 / LinuxONE III" ;;
    3931|3932) NAME="IBM z16 / LinuxONE 4 (Telum processor)" ;;
    9175)      NAME="IBM z17 / LinuxONE 5 (Telum II processor)" ;;
    *)         NAME="unknown" ;;
esac
row "Architecture" "$ARCH"
row "Machine type" "${TYPE:-unknown} = $NAME"
grep -E '^(Manufacturer|Model|LPAR Name|VM00 Control Program):' /proc/sysinfo 2>/dev/null \
    | while IFS=: read -r k v; do row "$k" "$(echo "$v" | xargs)"; done
row "CPUs / clock" "$(nproc) CPUs at $(awk -F: '/cpu MHz static/ {print $2 + 0; exit}' /proc/cpuinfo 2>/dev/null) MHz"
row "Memory" "$(free -h | awk '/^Mem:/ {print $2}')"

# ------------------------------------------------------------------------------------------ 2
bold "2. On-chip technologies (from /proc/cpuinfo)"
row "Vector facility (vx / vxe / vxe2)" "$(yes_no vx) / $(yes_no vxe) / $(yes_no vxe2)"
row "AI accelerator NNPA (z16+)" "$(yes_no nnpa)"
row "CPACF crypto (msa)" "$(yes_no msa)"
row "Compression DFLTCC (z15+)" "$(yes_no dflt)"
row "Sort accelerator (z15+)" "$(yes_no sort)"
SE=$(cat /sys/firmware/uv/prot_virt_guest 2>/dev/null)
row "Secure Execution guest" "$([[ "$SE" == 1 ]] && echo yes || echo "no${SE:+ (supported by the kernel)}")"
CARDS=$(ls -d /sys/bus/ap/devices/card* 2>/dev/null | wc -l)
row "Crypto Express adapters (HSM)" "$CARDS"

# ------------------------------------------------------------------------------------------ 3
bold "3. CPACF: AES-256-GCM and SHA-256 with and without the crypto hardware (OpenSSL)"
if command -v openssl >/dev/null; then
    speed() {  # $1 = algorithm, rest = env; prints MB/s on 16 KB blocks
        env "${@:2}" openssl speed -evp "$1" -bytes 16384 -seconds 2 2>/dev/null \
            | awk '/^(AES|aes|sha|SHA)/ {v = $NF} END {sub(/k$/, "", v); printf "%.0f", v / 1000}'
    }
    for alg in aes-256-gcm sha256; do
        hw=$(speed "$alg")
        # OPENSSL_s390xcap=z900 makes OpenSSL behave as on the first z/Architecture CPU, i.e. without CPACF
        sw=$(speed "$alg" OPENSSL_s390xcap=z900)
        row "$alg" "${hw} MB/s with CPACF   vs   ${sw} MB/s in software  ($(awk -v a="$hw" -v b="$sw" 'BEGIN {printf "%.1f", (b > 0 ? a / b : 0)}')x)"
    done
else
    echo "  openssl not installed (sudo apt install openssl)"
fi

# ------------------------------------------------------------------------------------------ 4
bold "4. On-chip compression: zlib level 1 on the dataset's WAV files (Python zlib = system zlib)"
if [[ -d "$DATASET" ]] && command -v python3 >/dev/null; then
    zbench() {
        env "$@" python3 - "$DATASET" <<'EOF'
import sys, time, zlib
from pathlib import Path
data = b"".join(p.read_bytes() for p in sorted(Path(sys.argv[1]).rglob("*.wav"))[:400])
t = time.perf_counter()
out = zlib.compress(data, 1)
dt = time.perf_counter() - t
print(f"{len(data) / dt / 1e6:.0f} MB/s ({len(data) / 1e6:.0f} MB -> {len(out) / 1e6:.0f} MB)")
EOF
    }
    row "with DFLTCC (default)" "$(zbench)"
    # The s390x zlib patches read these variables; 0 turns the hardware path off
    row "software only (DFLTCC=0)" "$(zbench DFLTCC=0 DFLTCC_LEVEL_MASK=0)"
    echo "  (the same speed in both rows means this zlib build does not use the on-chip compressor)"
else
    echo "  dataset folder or python3 not found - skipped"
fi

# ------------------------------------------------------------------------------------------ 5
bold "5. What the running app reports ($APP/api/status)"
STATUS=$(curl -s --max-time 5 "$APP/api/status")
if [[ -n "$STATUS" ]]; then
    python3 -c 'import json, sys; m = json.load(sys.stdin).get("model") or {}; print(json.dumps({"arch": m.get("arch"), "ibm_z": m.get("ibm_z")}, indent=2))' <<<"$STATUS" | sed 's/^/  /'
else
    echo "  app not reachable on $APP - deploy it first (bash deploy/deploy.sh)"
fi

# ------------------------------------------------------------------------------------------ 6
bold "6. Live inference on this machine (5 dataset recordings through the web app's API)"
if [[ -n "$STATUS" && -d "$DATASET" ]]; then
    for cls in asthma Bronchial copd healthy pneumonia; do
        f=$(ls "$DATASET/$cls"/*.wav 2>/dev/null | head -1)
        [[ -n "$f" ]] || continue
        RESULT=$(curl -s --max-time 120 -F "audio=@$f" "$APP/api/upload")
        python3 - "$cls" "$(basename "$f")" "$RESULT" <<'EOF'
import json, sys
true, name, body = sys.argv[1:4]
r = json.loads(body or "{}")
p = r.get("prediction")
if p:
    print(f"  {name:28s} true {true:10s} -> {p['predicted_class']:10s} {p['confidence']:6.1%}"
          f"  {p['inference_ms']:6.0f} ms on {p['arch']}")
else:
    print(f"  {name:28s} error: {r.get('error')}")
EOF
    done
else
    echo "  skipped (app or dataset not available)"
fi

if [[ " $FEATURES " == *" nnpa "* ]]; then
    bold "Next: this machine has the Telum AI accelerator (NNPA)"
    echo "  The model can be compiled for it with the free IBM Z Deep Learning Compiler (icr.io/ibmz/zdlc)."
fi
echo
