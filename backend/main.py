import os
import base64
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI(title="BiteRight API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# --- Models ---

class ParseMenuRequest(BaseModel):
    menu_text: str

class AnalyzeRequest(BaseModel):
    dishes: list[str]
    allergies: list[str]

class VisionRequest(BaseModel):
    image_base64: str

class ChatRequest(BaseModel):
    question: str
    allergies: list[str]
    dish: Optional[str] = None
    analysis_context: Optional[str] = None

# --- Allergen keyword map ---

ALLERGEN_KEYWORDS = {
    "peanuts": ["peanut", "peanuts", "groundnut", "satay"],
    "dairy": ["milk", "cheese", "butter", "cream", "yogurt", "whey", "lactose", "dairy", "ghee", "paneer"],
    "gluten": ["wheat", "flour", "bread", "pasta", "gluten", "barley", "rye", "semolina", "noodle", "breaded", "crouton"],
    "shellfish": ["shrimp", "prawn", "crab", "lobster", "scallop", "clam", "oyster", "mussel", "shellfish", "squid", "calamari"],
}


def check_allergens(dish_name: str, allergies: list[str]) -> tuple[str, list[str]]:
    """Return (status, matched_allergens) for a dish given user allergies."""
    dish_lower = dish_name.lower()
    matched = []
    for allergy in allergies:
        keywords = ALLERGEN_KEYWORDS.get(allergy.lower(), [allergy.lower()])
        if any(kw in dish_lower for kw in keywords):
            matched.append(allergy)
    if matched:
        return "unsafe", matched
    # Caution: dish name is ambiguous (e.g., "sauce", "soup", "dressing")
    ambiguous_words = ["sauce", "soup", "stew", "dressing", "marinade", "glaze", "gravy", "curry"]
    if any(word in dish_lower for word in ambiguous_words):
        return "caution", []
    return "safe", []


# --- Endpoints ---

@app.post("/parse-menu")
async def parse_menu(request: ParseMenuRequest):
    """Extract a list of dish names from raw menu text using OpenAI."""
    if not request.menu_text.strip():
        raise HTTPException(status_code=400, detail="menu_text is required")

    prompt = (
        "You are a helpful assistant that extracts dish names from restaurant menus.\n"
        "Given the following menu text, return ONLY a JSON array of dish name strings. "
        "Do not include prices, descriptions, or section headers — just the dish names.\n\n"
        f"Menu text:\n{request.menu_text}\n\n"
        "Respond with a JSON array only, e.g.: [\"Dish 1\", \"Dish 2\"]"
    )

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )

    content = response.choices[0].message.content.strip()
    # Parse JSON from response
    import json
    try:
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        dishes = json.loads(content)
        if not isinstance(dishes, list):
            raise ValueError("Expected a list")
    except Exception:
        raise HTTPException(status_code=500, detail=f"Failed to parse dish list from AI response: {content}")

    return {"dishes": dishes}


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """Analyze dishes against user allergies and return status + explanation."""
    if not request.dishes:
        raise HTTPException(status_code=400, detail="dishes list is required")

    results = []
    for dish in request.dishes:
        status, matched_allergens = check_allergens(dish, request.allergies)

        # Generate explanation via OpenAI
        if matched_allergens:
            explanation_hint = f"This dish likely contains {', '.join(matched_allergens)}, which the user is allergic to."
        elif status == "caution":
            explanation_hint = "This dish may contain hidden allergens depending on preparation."
        else:
            explanation_hint = "No obvious allergens detected based on the dish name."

        try:
            explanation_prompt = (
                f"Dish: {dish}\n"
                f"User allergies: {', '.join(request.allergies) if request.allergies else 'none'}\n"
                f"Status: {status}\n"
                f"Hint: {explanation_hint}\n\n"
                "Write a single concise sentence (max 20 words) explaining why this dish is "
                f"{status} for the user. Be direct and specific."
            )
            resp = client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": explanation_prompt}],
                temperature=0.3,
                max_tokens=60,
            )
            explanation = resp.choices[0].message.content.strip()
        except Exception:
            explanation = explanation_hint

        results.append({
            "dish": dish,
            "status": status,
            "explanation": explanation,
        })

    return {"results": results}


@app.post("/vision")
async def vision(request: VisionRequest):
    """Extract menu text from a base64-encoded image using OpenAI Vision."""
    if not request.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")

    # Strip data URI prefix if present
    image_data = request.image_base64
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]

    # Validate base64
    try:
        base64.b64decode(image_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "This is an image of a restaurant menu. "
                            "Please extract and return all the text you can read from it, "
                            "preserving the dish names and descriptions as accurately as possible."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                    },
                ],
            }
        ],
        max_tokens=1000,
    )

    extracted_text = response.choices[0].message.content.strip()
    return {"menu_text": extracted_text}


@app.post("/chat")
async def chat(request: ChatRequest):
    """Answer a user question about a dish in the context of their allergies."""
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    allergies_str = ", ".join(request.allergies) if request.allergies else "none"
    system_prompt = (
        "You are a helpful dietary assistant for a restaurant menu analysis app called BiteRight. "
        "Answer the user's question clearly and concisely. "
        "Always keep their food allergies in mind."
    )

    user_content = f"User allergies: {allergies_str}\n"
    if request.dish:
        user_content += f"Currently viewing dish: {request.dish}\n"
    if request.analysis_context:
        user_content += f"Analysis context: {request.analysis_context}\n"
    user_content += f"\nUser question: {request.question}"

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=300,
    )

    answer = response.choices[0].message.content.strip()
    return {"response": answer}
