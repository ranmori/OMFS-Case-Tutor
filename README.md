# OMFS Case Tutor

A free, browser-based oral & maxillofacial surgery (OMFS) case-based learning tool. Generates fictional clinical cases from source material, includes spaced-repetition drug flashcards, procedure logs, progress tracking, embedded YouTube procedure videos, and AI-generated clinical illustrations.

**Zero cost. Zero setup. Runs entirely in your browser.**

## Features

- **AI-powered case generation** — paste any textbook passage, guideline, or lecture note and get a realistic fictional clinical vignette with stem, diagnosis, imaging, and management
- **5 AI providers** — Pollinations (free, no key), Google Gemini (free), Groq (free), OpenRouter (free models), Anthropic (paid)
- **Spaced-repetition drug reference** — SM-2 algorithm auto-builds flashcards from pharmacology in each case
- **Procedure log** — every case touching a surgical procedure gets auto-logged
- **Weak-point targeting** — new cases are biased toward your lowest-rated topics
- **Progress charts** — hand-drawn SVG sparklines showing self-rated recall over time, per topic
- **Embedded procedure videos** — curated YouTube teaching videos matched to each case's procedures
- **Clinical illustrations** — AI-generated radiographs and clinical images via Pollinations image API
- **Speech synthesis** — have the attending read the diagnosis and management aloud
- **Downloadable reference PDF** — one-click export of all drug cards and procedure logs as a clean, printable PDF via the browser's native print dialog
- **PWA** — installable on desktop and mobile, works offline after first load

## Quick start

1. Open the live app: **https://ranmori.github.io/OMFS-Case-Tutor/**
2. Paste any OMFS source material into the text area
3. Click **Generate case**
4. Read the stem, think through your answer, then click **Reveal diagnosis & management**
5. Rate your recall (0–5) to track progress and build drug cards

No account, no API key, no installation required.

## Local development

```bash
# Clone the repo
git clone https://github.com/ranmori/OMFS-Case-Tutor.git
cd OMFS-Case-Tutor

# Start a local server (required for service worker)
node serve.js
# or
npx serve .
# or any static file server

# Open http://localhost:3000
```

> **Note:** The service worker requires HTTP — `file://` won't work. Use a local server.

## Project structure

```
.
├── index.html          # App shell — 4-tab layout (Case, Drug Ref, Procedure Log, Progress)
├── style.css           # Clinical-chart theme (dark bg, paper cards, binder strip)
├── app.js              # Main app logic: AI providers, SM-2 scheduler, video DB, UI
├── sw.js               # Service worker for offline app-shell caching
├── manifest.json       # PWA manifest
├── serve.js            # Local dev server
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

## AI providers

| Provider | Key required? | Cost | Notes |
|---|---|---|---|
| **Pollinations** | No | Free | Default. Keyless, anonymous, no signup. ~1 req/15s rate limit. |
| **Google Gemini** | Yes (free) | Free | Get key at [aistudio.google.com](https://aistudio.google.com) |
| **Groq** | Yes (free) | Free | Get key at [console.groq.com](https://console.groq.com) |
| **OpenRouter** | Yes (free) | Free | 20+ free models. Get key at [openrouter.ai](https://openrouter.ai) |
| **Anthropic** | Yes (paid) | Paid | Get key at [console.anthropic.com](https://console.anthropic.com) |

## How it works

1. You paste source material (textbook, guidelines, notes)
2. The AI generates a fictional clinical case with: topic, stem, prompt questions, diagnosis, imaging, management, drugs, and procedures
3. An AI-generated clinical image is created for the case
4. Procedure videos are matched from a curated database of ~40 OMFS teaching videos
5. You self-rate your recall (0–5 scale)
6. Drug cards are created and scheduled on an SM-2 spaced-repetition timeline
7. Procedure entries are logged automatically
8. Progress charts update with your rating history
9. Future cases are biased toward your weakest topics
10. Click **↓ Reference** to export everything as a printable PDF — drug cards grouped by trigger, full procedure log, date-stamped

All data is stored in your browser's localStorage — nothing is sent to any server except the AI provider you choose.

## OMFS subspecialties covered

- Dentoalveolar surgery (extractions, socket preservation, ridge augmentation)
- Endodontic surgery (apicectomy, endodontic microsurgery)
- Preprosthetic surgery (alveoloplasty, tori removal, vestibuloplasty)
- Dental implants (placement, sinus lifts, All-on-4, bone grafting)
- Orthognathic surgery (Le Fort I–III, BSSO, genioplasty, bimaxillary)
- Trauma (mandible fractures, zygomatic, orbital, NOE, frontal sinus, panfacial)
- Pathology & oncology (OKC, ameloblastoma, neck dissection, marginal/radical mandibulectomy)
- Salivary gland surgery (sialendoscopy, parotidectomy, submandibular excision)
- TMJ surgery (arthrocentesis, arthroscopy, condylectomy, total joint replacement)
- Reconstructive surgery (free fibula flap, microvascular, distraction osteogenesis)
- Cosmetic surgery (rhinoplasty, genioplasty, malar augmentation)

## Data & privacy

- All data stays in your browser (localStorage)
- No accounts, no tracking, no analytics
- Only communication is directly from your browser to the AI provider you select
- "Erase all local data" button in Settings clears everything

## License

MIT

