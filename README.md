# BiteRight 🍽️

A minimal full-stack hackathon app that lets users set up a dietary profile and instantly analyze a restaurant menu for allergen safety.

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | Next.js 14 (React) + Tailwind CSS   |
| Backend  | FastAPI (Python 3.11+)              |
| AI       | OpenAI API — `gpt-4.1-mini`         |

## Project Structure

```
/frontend   → Next.js app (App Router)
/backend    → FastAPI app
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- An OpenAI API key

### Backend

```bash
cd backend
pip install -r requirements.txt
OPENAI_API_KEY=sk-... uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## App Flow

1. **Profile setup** — Select your food allergies (peanuts, dairy, gluten, shellfish).
2. **Menu input** — Paste menu text or upload a menu image.
3. **Analysis** — Each dish is labelled `safe`, `caution`, or `unsafe` with a short explanation.
4. **Chat** — Ask follow-up questions about any dish in context of your allergies.

## API Endpoints

| Method | Path          | Description                                   |
|--------|---------------|-----------------------------------------------|
| POST   | `/parse-menu` | Extract dish names from raw menu text         |
| POST   | `/analyze`    | Analyze dishes against user allergies         |
| POST   | `/vision`     | Extract menu text from a base64 image         |
| POST   | `/chat`       | Answer follow-up questions about dishes       |

### Example: Parse Menu

```bash
curl -X POST http://localhost:8000/parse-menu \
  -H "Content-Type: application/json" \
  -d '{"menu_text": "Grilled Salmon $18\nPeanut Noodles $12\nCaesar Salad $10"}'
```

**Response:**
```json
{"dishes": ["Grilled Salmon", "Peanut Noodles", "Caesar Salad"]}
```

### Example: Analyze

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"dishes": ["Grilled Salmon", "Peanut Noodles"], "allergies": ["peanuts"]}'
```

**Response:**
```json
{
  "results": [
    {"dish": "Grilled Salmon", "status": "safe", "explanation": "No peanut ingredients detected."},
    {"dish": "Peanut Noodles", "status": "unsafe", "explanation": "Contains peanuts, which you are allergic to."}
  ]
}
```

### Example: Chat

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Can I ask for the peanut noodles without peanuts?",
    "allergies": ["peanuts"],
    "dish": "Peanut Noodles",
    "analysis_context": null
  }'
```

**Response:**
```json
{"response": "Cross-contamination risk is high for dishes that are named after an allergen. I'd recommend asking the kitchen directly and mentioning your allergy."}
```
