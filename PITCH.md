# Auscult — pitch material

Theme: **Real-Time AI for Critical Decisions** · IBM Z Datathon

Before recording, replace the reference numbers (80.1% accuracy, ~0.2 s latency) with the ones from your
LinuxONE run: `train_on_linuxone.ipynb` for accuracy, `bash deploy/ibmz-showcase.sh` for latency and the
on-chip measurements.

---

## 2-minute video script (~290 words)

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Cover slide, then the problem slide | Every year COPD alone kills about three and a half million people, and pneumonia is a leading killer of young children. The first test is a stethoscope — cheap and everywhere. But telling a wheeze from a crackle takes years of training, and lung specialists are scarce exactly where they're needed most. |
| 0:15–0:35 | Web app: click the COPD example; report appears | This is Auscult. A health worker records a few seconds of breathing and uploads it — or sends a WhatsApp voice note. In under a second they get a screening read-out: the closest match among healthy, asthma, COPD, pneumonia and bronchial, and how sure the model is. |
| 0:35–0:55 | Pipeline slide | Under the hood, we turn the sound into seventy-six acoustic features per moment, link similar moments into a graph, and a graph neural network reads the recurring patterns across the breath cycle. |
| 0:55–1:10 | App: upload silence → "cannot be screened"; then a low-agreement result | For a critical decision, trust matters. Auscult refuses silent or noisy recordings instead of guessing, flags when it's unsure, and suggests re-recording. |
| 1:10–1:40 | Terminal: `uname -m` → s390x, `docker compose ps`, `ibmz-showcase.sh`; app's "Running on IBM Z" panel | And all of it runs on IBM LinuxONE. The Python AI stack isn't published for IBM Z, so we ported it — including our own replacement for a library that doesn't run on s390x, verified to give bit-identical results. We train the model on LinuxONE too, in Jupyter on the server, and the app shows the on-chip technologies it runs on. Patient audio is processed on the machine and deleted — it never goes to a public cloud. |
| 1:40–1:55 | Results slide | Tested on patients the model had never heard, it screens correctly about eighty percent of the time, and catches ninety-five percent of COPD cases. |
| 1:55–2:00 | Closing slide | Auscult: listen, screen, refer sooner. |

Tips: record the demo segments first and speak over them; keep the browser at 125% zoom so the report is
readable; show the LinuxONE terminal for at least 5 seconds so judges see `s390x`.

---

## Submission answers

### What is the problem you are trying to solve?

Chronic and acute respiratory diseases — COPD, asthma, pneumonia — are among the world's leading causes of
death (WHO: COPD caused about 3.5 million deaths in 2021; about 262 million people live with asthma;
pneumonia killed about 740,000 children under five in 2019). They are often caught late. The first test is
listening to the lungs with a stethoscope, which is cheap and available almost everywhere, but interpreting
what you hear — wheeze, crackles, bronchial breathing — takes years of training, and lung specialists are
scarce in exactly the places with the highest burden. Front-line health workers need a fast, reliable second
opinion at the point of care, without sending sensitive patient data to outside services.

### How are you planning to solve the problem? (Brief overview)

**Auscult** is a real-time respiratory screening system. A health worker uploads a short stethoscope
recording in the web app or sends it as a WhatsApp voice note. The server first checks the recording's
quality and refuses silent, too-short or noise-only audio instead of guessing. It then extracts 76 acoustic
features for each of 157 moments of the recording, links acoustically similar moments into a graph, and
classifies it with a graph neural network into healthy, asthma, COPD, pneumonia or bronchial. In well under a
second it returns a screening report: the closest match, an agreement level (high / moderate / low), all five
probabilities, and re-recording advice when the model is unsure. The model is trained with a patient-level
split, so its reported accuracy reflects patients it has never heard. It is a screening aid that supports
referral decisions, not a diagnosis.

### How does your solution leverage IBM Z / LinuxONE technologies?

- **Runs natively on IBM LinuxONE (s390x):** web app, API gateway and AI inference run as Docker containers on
  the LinuxONE server; one deploy script detects s390x and builds the right images.
- **AI stack ported to IBM Z:** the Python ML stack has no s390x builds on PyPI, so we built it from Debian's
  s390x packages and PyTorch's official s390x wheel, and wrote a NumPy replacement for numba (which librosa
  needs but which does not support s390x), verified to produce bit-identical audio features. The trained model
  loads correctly on big-endian IBM Z.
- **Training on LinuxONE:** the model is trained on the server in a JupyterLab container that uses the same
  environment as the live service, with patient-level validation and an automated check through the app's own
  inference code.
- **On-chip hardware made visible:** the app reads the machine type and reports the IBM Z technologies in use —
  vector SIMD used by NumPy's kernels, CPACF cryptography, DFLTCC compression and the NNPA AI accelerator where
  present; `deploy/ibmz-showcase.sh` measures the CPACF speed-up, on-chip compression and live inference latency.
- **Data sovereignty and reliability:** patient recordings are processed on the LinuxONE machine and deleted
  after analysis; nothing goes to a public AI cloud. Services restart themselves and come back after reboots,
  fitting LinuxONE's always-on design. Next: screening history in IBM Db2 (built, being integrated) and NNPA
  acceleration on IBM z16 / LinuxONE 4.

### What value does your solution deliver, and who will benefit from it?

- **Front-line health workers** get a second opinion in seconds from a browser or WhatsApp, without specialist
  training, and are told clearly when a result is uncertain.
- **Patients**, especially far from a lung specialist, get earlier referral for COPD, asthma and pneumonia.
- **Clinics and hospitals** get triage that runs on their own infrastructure, so patient audio never leaves it.
- **Health systems** get screening that can scale on hardware built for regulated, always-on workloads.

The value in one line: faster triage, fewer missed cases, and patient data that stays sovereign.
