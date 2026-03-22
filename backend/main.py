from dotenv import load_dotenv
load_dotenv()
import os
import json
import base64
from typing import Optional
import re
import unicodedata
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI(title="BiteRight API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# ─── Models ───────────────────────────────────────────────────────────────────

class AllergyInput(BaseModel):
    id: str
    label: str
    severity: int  # 1–10

class HealthProfileInput(BaseModel):
    id: str
    label: str
    guidance: str  # the user's selected guidance level string

class ParseMenuRequest(BaseModel):
    menu_text: str

class AnalyzeRequest(BaseModel):
    dishes: list[str]
    allergies: list[AllergyInput] = []
    health_profiles: list[HealthProfileInput] = []
    health_notes: str = ""

class VisionRequest(BaseModel):
    image_base64: str

class ChatRequest(BaseModel):
    question: str
    allergies: list[AllergyInput] = []
    health_profiles: list[HealthProfileInput] = []
    health_notes: str = ""
    dish: Optional[str] = None
    analysis_context: Optional[str] = None


# ─── Allergen keyword map (fast pre-check) ────────────────────────────────────

ALLERGEN_KEYWORDS: dict[str, list[str]] = {
    "peanuts":   ["peanut", "groundnut", "satay"],
    "tree nuts": ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut"],
    "dairy":     ["milk", "cheese", "butter", "cream", "yogurt", "whey", "lactose", "ghee", "paneer"],
    "eggs":      ["egg", "eggs", "omelette", "frittata", "quiche", "mayo", "mayonnaise", "aioli"],
    "fish":      ["salmon", "tuna", "cod", "tilapia", "halibut", "anchovy", "anchovies", "fish sauce"],
    "gluten":    ["wheat", "flour", "bread", "pasta", "gluten", "barley", "rye", "semolina", "noodle", "breaded"],
    "shellfish": ["shrimp", "prawn", "crab", "lobster", "scallop", "clam", "oyster", "mussel", "squid", "calamari"],
    "soy":       ["soy", "tofu", "edamame", "miso", "tempeh"],
    "sesame":    ["sesame", "tahini", "hummus"],
    "sulfites":  ["wine", "sulfite", "sulphite"],
}

TITLECASE_SMALL_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
    "of", "on", "onto", "or", "per", "so", "the", "to", "up", "via", "with", "yet"
}

TITLECASE_KEEP_UPPER = {
    "BBQ", "BLT", "MSG", "V", "VG", "GF", "DF", "NF", "VGN", "HALAL", "KETO", "VEG"
}


def _smart_title_word(word: str, is_first: bool) -> str:
    if not word:
        return word

    # Keep punctuation-wrapped words intact while casing only the core token.
    match = re.match(r"^(\W*)([A-Za-z][A-Za-z'./&-]*)(\W*)$", word)
    if not match:
        return word

    prefix, core, suffix = match.groups()
    upper_core = core.upper()

    if upper_core in TITLECASE_KEEP_UPPER:
        return f"{prefix}{upper_core}{suffix}"

    lower_core = core.lower()
    if not is_first and lower_core in TITLECASE_SMALL_WORDS:
        return f"{prefix}{lower_core}{suffix}"

    # Preserve slash and hyphen token boundaries (e.g., sweet-and-sour, fish/chips).
    pieces = re.split(r"([/-])", lower_core)
    titled = "".join(
        p.capitalize() if p not in {"/", "-"} else p
        for p in pieces
    )
    return f"{prefix}{titled}{suffix}"


def normalize_menu_text(text: str) -> str:
    lines = text.splitlines()
    normalized: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            normalized.append("")
            continue

        letters = [c for c in stripped if c.isalpha()]
        is_all_caps = bool(letters) and (sum(1 for c in letters if c.isupper()) / len(letters) > 0.8)

        # Only normalize aggressive all-caps lines to avoid changing already-good OCR text.
        if is_all_caps:
            words = stripped.split()
            cased_words = [_smart_title_word(w, i == 0) for i, w in enumerate(words)]
            stripped = " ".join(cased_words)

        normalized.append(stripped)

    # Collapse excessive blank lines from OCR while keeping section spacing.
    clean = "\n".join(normalized)
    clean = re.sub(r"\n{3,}", "\n\n", clean)
    return clean.strip()


def normalize_dish_name(name: str) -> str:
    """Normalize dish names to professional title casing."""
    words = name.strip().split()
    if not words:
        return ""
    cased_words = [_smart_title_word(w, i == 0) for i, w in enumerate(words)]
    return " ".join(cased_words)


def translate_dishes_to_english(dishes: list[str]) -> list[str]:
    """Translate non-English dish names into natural English menu names."""
    if not dishes:
        return dishes

    prompt = (
        "You are a multilingual culinary translator.\n"
        "Translate each restaurant dish name to natural English while preserving culinary meaning.\n"
        "Rules:\n"
        "- Return ONLY a JSON array of strings.\n"
        "- Keep the same number of items and same order.\n"
        "- If a dish is already in English, keep it as-is.\n"
        "- Prefer common menu wording over literal machine translation.\n"
        "- Keep cuisine-specific names (e.g., Mapo Tofu, Bibimbap, Ramen) recognizable.\n\n"
        f"Dish names JSON:\n{json.dumps(dishes, ensure_ascii=False)}"
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        content = (resp.choices[0].message.content or "").strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        translated = json.loads(content)
        if isinstance(translated, list) and len(translated) == len(dishes):
            clean = [normalize_dish_name(str(x)) for x in translated if str(x).strip()]
            if len(clean) == len(dishes):
                return clean
    except Exception:
        pass

    return dishes


def keyword_match(dish: str, allergies: list[AllergyInput]) -> list[str]:
    dish_lower = dish.lower()
    matched = []
    for a in allergies:
        kws = ALLERGEN_KEYWORDS.get(a.id, [a.id])
        if any(kw in dish_lower for kw in kws):
            matched.append(a.label)
    return matched


def uses_non_latin_script(text: str) -> bool:
    """Detect dishes written in non-Latin scripts (CJK, Cyrillic, Arabic, etc.)."""
    for ch in text:
        code = ord(ch)
        if (
            0x4E00 <= code <= 0x9FFF   # CJK Unified Ideographs
            or 0x3400 <= code <= 0x4DBF  # CJK Extension A
            or 0x3040 <= code <= 0x30FF  # Hiragana + Katakana
            or 0xAC00 <= code <= 0xD7AF  # Hangul syllables
            or 0x0400 <= code <= 0x04FF  # Cyrillic
            or 0x0600 <= code <= 0x06FF  # Arabic
            or 0x0590 <= code <= 0x05FF  # Hebrew
            or 0x0900 <= code <= 0x097F  # Devanagari
            or 0x0E00 <= code <= 0x0E7F  # Thai
        ):
            return True
    return False


def is_latin_script(text: str) -> bool:
    """Returns True if the text is primarily latin/ASCII characters."""
    if not text:
        return True

    latin_chars = sum(
        1
        for c in text
        if unicodedata.category(c).startswith("L") and ord(c) < 0x250
    )
    total_letters = sum(1 for c in text if unicodedata.category(c).startswith("L"))
    if total_letters == 0:
        return True
    return (latin_chars / total_letters) > 0.8


STATUS_RANK = {
    "safe_for_you": 0,
    "be_mindful": 1,
    "skip_this": 2,
}


HEALTH_RISK_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "high cholesterol": {
        "high": [
            "deep fried", "fried", "crispy", "battered", "breaded", "tempura",
            "bacon", "sausage", "pork belly", "fatty", "cream", "alfredo", "ghee", "butter",
        ],
        "moderate": ["cheese", "rich", "creamy", "mayo", "mayonnaise", "aioli", "coconut milk"],
    },
    "diabetes": {
        "high": [
            "dessert", "cake", "pastry", "donut", "ice cream", "syrup", "sweetened", "soda",
            "gulab jamun", "honey", "sugar",
        ],
        "moderate": ["white rice", "naan", "refined", "sweet sauce", "sweet chili"],
    },
    "high blood pressure": {
        "high": ["cured", "processed", "soy sauce", "fish sauce", "ramen", "pickled", "salted", "anchovy"],
        "moderate": ["broth", "soup", "teriyaki", "gravy", "smoked"],
    },
    "vegan": {
        "high": [
            "chicken", "beef", "pork", "lamb", "fish", "shrimp", "egg", "eggs", "milk", "cheese", "butter",
            "cream", "yogurt", "ghee", "honey", "gelatin", "anchovy",
        ],
        "moderate": [],
    },
    "vegetarian": {
        "high": ["chicken", "beef", "pork", "lamb", "fish", "shrimp", "prawn", "anchovy", "shellfish"],
        "moderate": [],
    },
    "halal": {
        "high": ["pork", "bacon", "ham", "lard", "alcohol", "wine", "beer", "mirin", "sake"],
        "moderate": ["gelatin"],
    },
    "kosher": {
        "high": ["pork", "bacon", "ham", "shellfish", "shrimp", "crab", "lobster"],
        "moderate": [],
    },
}


def _max_status(current: str, candidate: str) -> str:
    return candidate if STATUS_RANK[candidate] > STATUS_RANK[current] else current


def _guidance_level(guidance: str) -> str:
    g = (guidance or "").lower()
    if any(token in g for token in [
        "all potentially relevant",
        "all potentially non-compliant",
        "everything that could matter",
        "highlight all",
    ]):
        return "high"
    if any(token in g for token in ["major risk", "obvious risk", "obvious"]):
        return "low"
    return "med"


def _guidance_to_constraint(guidance: str) -> dict[str, str]:
    g = (guidance or "").lower()
    if any(token in g for token in [
        "all potentially relevant",
        "everything that could matter",
        "highlight all",
        "all potentially non-compliant",
    ]):
        return {
            "level": "strict",
            "instruction": (
                "STRICT MODE: Treat this condition like a severe allergy. "
                "Any high-risk dish MUST be skip_this. "
                "Any moderate-risk dish MUST be be_mindful. "
                "safe_for_you is only allowed when there is no relevant risk."
            ),
        }
    if any(token in g for token in ["major risk", "obvious risk", "obvious"]):
        return {
            "level": "low",
            "instruction": (
                "LENIENT MODE: Only extreme clear offenders should be flagged. "
                "Most dishes should remain safe_for_you."
            ),
        }
    return {
        "level": "med",
        "instruction": (
            "MODERATE MODE: Dishes clearly matching this risk category should be be_mindful."
        ),
    }


def _health_risk_level(profile_id: str, text: str) -> str:
    rules = HEALTH_RISK_KEYWORDS.get((profile_id or "").lower(), {})
    t = (text or "").lower()

    for kw in rules.get("high", []):
        if kw in t:
            return "high"
    for kw in rules.get("moderate", []):
        if kw in t:
            return "moderate"
    return "none"


def _clamp_risk_score(value) -> int:
    try:
        score = int(round(float(value)))
    except Exception:
        score = 0
    return max(0, min(100, score))


def _default_score_for_status(status: str) -> int:
    if status == "skip_this":
        return 90
    if status == "be_mindful":
        return 60
    return 20


def _strict_mode_enabled(allergies: list[AllergyInput], health_profiles: list[HealthProfileInput]) -> bool:
    if any(a.severity >= 8 for a in allergies):
        return True
    return any(_guidance_level(h.guidance) == "high" for h in health_profiles)


def _apply_distribution_quota(entries: list[dict], strict_mode: bool) -> None:
    if not strict_mode:
        return

    n = len(entries)
    if n < 6:
        return

    if n >= 10:
        min_skip = 2
        desired_skip = 3 if sum(1 for e in entries if e.get("risk_score", 0) >= 80) >= 3 else 2
    else:
        min_skip = 1
        desired_skip = 1

    current_skip = sum(1 for e in entries if e.get("status") == "skip_this")
    target_skip = max(min_skip, desired_skip)
    if current_skip >= target_skip:
        return

    candidates = [(i, e) for i, e in enumerate(entries) if e.get("status") != "skip_this"]
    candidates.sort(
        key=lambda t: (t[1].get("risk_score", 0), STATUS_RANK.get(t[1].get("status", "safe_for_you"), 0)),
        reverse=True,
    )

    needed = target_skip - current_skip
    for _, entry in candidates[:needed]:
        entry["status"] = "skip_this"
        entry["risk_score"] = max(80, entry.get("risk_score", 0))
        if not entry.get("hidden_risk"):
            entry["hidden_risk"] = "strict-mode distribution guard: elevated high-risk dish"
        if not entry.get("explanation"):
            entry["explanation"] = "High-risk dish elevated to avoid recommendation under strict user settings."


def enforce_health_policy(
    status: str,
    dish_name: str,
    english_name: str,
    explanation: str,
    hidden_risk: Optional[str],
    health_profiles: list[HealthProfileInput],
) -> tuple[str, Optional[str]]:
    combined_text = " ".join([
        dish_name or "",
        english_name or "",
        explanation or "",
        hidden_risk or "",
    ]).lower()

    updated_status = status
    policy_notes: list[str] = []

    for profile in health_profiles:
        pid = profile.id.lower()
        level = _guidance_level(profile.guidance)
        risk = _health_risk_level(pid, combined_text)

        # Keep this as an escalation guard by default: only escalate from safe_for_you.
        # Exception: for strict dietary conflicts, allow hard override to skip_this.
        if updated_status != "safe_for_you":
            if pid in {"vegan", "vegetarian", "halal", "kosher"} and risk == "high":
                updated_status = _max_status(updated_status, "skip_this")
                if not hidden_risk:
                    policy_notes.append(f"{profile.label} conflict")
            continue

        # Dietary preference profiles should be strict on direct conflict.
        if pid in {"vegan", "vegetarian", "halal", "kosher"}:
            if risk == "high":
                updated_status = _max_status(updated_status, "skip_this")
                policy_notes.append(f"{profile.label} conflict")
            elif level == "high" and risk == "moderate":
                updated_status = _max_status(updated_status, "be_mindful")
            continue

        # Medical condition profiles use guidance strictness tiers.
        if level == "high":
            if risk == "high":
                updated_status = _max_status(updated_status, "skip_this")
                policy_notes.append(f"high {profile.label.lower()} relevance")
            elif risk == "moderate":
                updated_status = _max_status(updated_status, "be_mindful")
                policy_notes.append(f"possible {profile.label.lower()} relevance")
        elif level == "med":
            if risk in {"high", "moderate"}:
                updated_status = _max_status(updated_status, "be_mindful")
                policy_notes.append(f"{profile.label.lower()} relevance")
        else:  # low guidance: only clear/extreme conflicts
            if risk == "high":
                updated_status = _max_status(updated_status, "be_mindful")
                policy_notes.append(f"clear {profile.label.lower()} concern")

    if not hidden_risk and policy_notes:
        hidden_risk = ", ".join(dict.fromkeys(policy_notes))

    return updated_status, hidden_risk


# ─── Few-shot examples ────────────────────────────────────────────────────────

FEW_SHOT_EXAMPLES = """
CLASSIFICATION POLICY (SYSTEM-LEVEL)

Use the user's allergy severity and health guidance to classify each dish as: safe_for_you, be_mindful, or skip_this.

ALLERGY SEVERITY RULES
- low tier (severity 1-4): only flag dominant direct allergen presence (primary ingredient). Ignore trace amounts, cooking oils, garnish traces, and cross-contamination.
- med tier (severity 5-7): flag direct ingredients and standard recipe components (including common sauces/components where the allergen is meaningfully present). Ignore cooking oils, trace exposure, and cross-contamination.
- high tier (severity 8-10): flag all meaningful exposure including direct ingredients, standard components, cooking oils, garnishes, and shared fryer/cross-contamination risk.

HEALTH GUIDANCE RULES
- "flag obvious risks only" (or equivalent conservative guidance): only flag extreme/clear offenders; do not over-flag borderline dishes.
- "flag anything fried or fatty" (or similar moderate guidance): flag dishes that clearly belong to that risk category.
- "flag everything that could matter" (or equivalent strict guidance): be thorough and comprehensive; expect more be_mindful/skip_this and fewer safe_for_you results.
- In strict guidance mode, if a health-condition risk is meaningfully present, do not return safe_for_you.

STATUS CALIBRATION
- safe_for_you: no meaningful concern at this user's severity tier and health guidance.
- be_mindful: relevant concern exists, but user may still proceed with caution or modification.
- skip_this: direct/strong conflict with allergies or health guidance.
- Avoid defaulting to safe_for_you when there is a clear profile-dish conflict.

CRITICAL EXAMPLE
Same dish: Vegetable Stir Fry

Case A:
Profile: peanut allergy severity 6/10 (med tier)
Reasoning: possible peanut oil alone is not enough at med tier.
Output:
{"status":"safe_for_you","explanation":"No clear peanut ingredient listed. Possible peanut oil is typically not enough to flag at your current sensitivity tier.","hidden_risk":"may use peanut oil for stir frying"}

Case B:
Profile: peanut allergy severity 9/10 (high tier)
Reasoning: oil exposure matters at high tier.
Output:
{"status":"be_mindful","explanation":"No obvious peanut ingredient is listed, but peanut oil is commonly used in stir fries and this matters at your sensitivity level. Confirm cooking oil with the kitchen.","hidden_risk":"possible peanut oil exposure"}
"""


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/parse-menu")
async def parse_menu(request: ParseMenuRequest):
    if not request.menu_text.strip():
        raise HTTPException(status_code=400, detail="menu_text is required")

    prompt = (
        "Extract dish names from this restaurant menu. "
        "Preserve each dish name exactly as written on the menu, including original language/script. "
        "Return ONLY a JSON array of dish name strings. "
        "No prices, descriptions, or section headers.\n\n"
        f"Menu:\n{request.menu_text}\n\n"
        'Respond with JSON array only, e.g. ["Dish 1", "Dish 2"]'
    )
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )
    content = (response.choices[0].message.content or "").strip()
    try:
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        dishes = json.loads(content)
        if not isinstance(dishes, list):
            raise ValueError
        dishes = [
            normalize_dish_name(normalize_menu_text(str(d)).replace("\n", " "))
            for d in dishes
            if str(d).strip()
        ]
    except Exception:
        raise HTTPException(status_code=500, detail=f"Could not parse dish list: {content}")
    return {"dishes": dishes}


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    if not request.dishes:
        raise HTTPException(status_code=400, detail="dishes list is required")

    # Build human-readable profile string for the prompt
    allergy_lines = []
    for a in request.allergies:
        if a.severity <= 4:
            sens = "mild — trace amounts and cooking oils are fine, only flag if it's a primary or sauce ingredient"
        elif a.severity <= 7:
            sens = "moderate — flag if it's a primary ingredient or standard sauce component; ignore trace/oil exposure"
        else:
            sens = "severe/anaphylactic — flag any meaningful exposure including possible cooking oils and cross-contamination"
        allergy_lines.append(f"  - {a.label}: severity {a.severity}/10 ({sens})")

    health_lines = []
    for h in request.health_profiles:
        health_lines.append(f"  - {h.label}: {h.guidance}")

    profile_str = ""
    if allergy_lines:
        profile_str += "Allergies:\n" + "\n".join(allergy_lines) + "\n"
    if health_lines:
        profile_str += "Health conditions:\n" + "\n".join(health_lines) + "\n"
    if request.health_notes.strip():
        profile_str += f"Additional notes: {request.health_notes.strip()}\n"
    if not profile_str:
        profile_str = "No restrictions or health conditions.\n"

    normalized_dishes = [normalize_dish_name(d) for d in request.dishes]
    english_dishes = translate_dishes_to_english(normalized_dishes)

    dish_lines: list[str] = []
    for i, (orig, eng) in enumerate(zip(normalized_dishes, english_dishes)):
        line = f'{i}: "{orig}"'
        if eng and eng.lower() != orig.lower():
            line += f' (English: "{eng}")'
        dish_lines.append(line)

    health_constraint_lines: list[str] = []
    for h in request.health_profiles:
        constraint = _guidance_to_constraint(h.guidance)
        health_constraint_lines.append(
            f"  - {h.label} [{constraint['level'].upper()}]: {constraint['instruction']}"
        )
    health_constraints_str = "\n".join(health_constraint_lines) if health_constraint_lines else "  - None"

    system_prompt = f"""You are a dietary safety classifier for a restaurant menu app.

CLASSIFICATION:
- safe_for_you: no meaningful concern given this user's allergy severity and health guidance
- be_mindful: relevant concern exists; user may proceed with caution
- skip_this: direct conflict with allergies or health profile

ALLERGY TIERS:
- 1-4: flag only primary/dominant allergen presence
- 5-7: flag primary ingredients and standard sauce/components; ignore traces and cooking-oil-only exposure
- 8-10: flag all meaningful exposure including oils and cross-contamination risk

HEALTH GUIDANCE:
- "obvious risks only": flag only extreme clear offenders
- moderate guidance: flag dishes that clearly match that risk category
- strict guidance ("all potentially relevant" / "everything that could matter"): be comprehensive and avoid overusing safe_for_you when any meaningful risk is present

HEALTH CONDITION CONSTRAINTS (BINDING):
{health_constraints_str}

HIGH CHOLESTEROL REFERENCE:
- high-risk: deep fried, battered, crispy, pork belly, fatty cuts, heavy cream, butter-based sauces, ghee, full-fat cheese, coconut cream, bacon, lard
- moderate-risk: cream-based, cheese, mayonnaise, coconut milk, egg yolk, rich gravy

IMPORTANT:
- You are classifying a full menu, not isolated dishes.
- Return realistic mixed outputs; do not classify everything the same way.
- In STRICT MODE constraints, required outcomes are mandatory and must not be softened.
"""

    user_prompt = (
        f"User profile:\n{profile_str}\n"
        f"Menu dishes to classify (by index):\n{chr(10).join(dish_lines)}\n\n"
        "Return ONLY valid JSON array, one object per dish, same order:\n"
        "[\n"
        "  {\"index\": 0, \"status\": \"safe_for_you|be_mindful|skip_this\", \"risk_score\": 0-100, \"risk_level\": \"none|low|moderate|high\", \"explanation\": \"1-2 sentences\", \"hidden_risk\": \"string or null\"},\n"
        "  ...\n"
        "]"
    )

    parsed_items: list[dict] = []
    try:
        max_tokens = min(6000, 220 + 140 * max(1, len(normalized_dishes)))
        resp = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=max_tokens,
        )
        content = (resp.choices[0].message.content or "").strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        raw = json.loads(content)
        if isinstance(raw, list):
            parsed_items = [x for x in raw if isinstance(x, dict)]
    except Exception:
        parsed_items = []

    by_index: dict[int, dict] = {}
    for item in parsed_items:
        idx = item.get("index")
        if isinstance(idx, int) and 0 <= idx < len(normalized_dishes) and idx not in by_index:
            by_index[idx] = item

    strict_mode = _strict_mode_enabled(request.allergies, request.health_profiles)
    entries: list[dict] = []
    strict_high_cholesterol = any(
        h.id.lower() == "high cholesterol" and _guidance_level(h.guidance) == "high"
        for h in request.health_profiles
    )
    strict_high_chol_candidates: list[int] = []

    for i, (orig, eng) in enumerate(zip(normalized_dishes, english_dishes)):
        scan_text = f"{orig} {eng}" if eng else orig
        matched = keyword_match(scan_text, request.allergies)

        item = by_index.get(i)
        if item:
            status = item.get("status", "safe_for_you")
            if status not in ("safe_for_you", "be_mindful", "skip_this"):
                status = "safe_for_you"
            risk_score = _clamp_risk_score(item.get("risk_score"))
            if risk_score == 0:
                risk_score = _default_score_for_status(status)
            explanation = str(item.get("explanation", "")).strip()
            hidden_risk = item.get("hidden_risk") or None
        else:
            # Keyword fallback with health-aware escalation pass afterward.
            if matched:
                status = "skip_this"
                explanation = f"Contains {', '.join(matched)}."
            else:
                status = "safe_for_you"
                explanation = "No direct allergen match detected from menu text."
            hidden_risk = None
            risk_score = _default_score_for_status(status)

        status, hidden_risk = enforce_health_policy(
            status=status,
            dish_name=orig,
            english_name=eng,
            explanation=explanation,
            hidden_risk=hidden_risk,
            health_profiles=request.health_profiles,
        )

        if status == "skip_this":
            risk_score = max(risk_score, 80)
        elif status == "be_mindful":
            risk_score = max(risk_score, 45)
        else:
            risk_score = min(risk_score, 40)

        if strict_high_cholesterol:
            risk_level = _health_risk_level("high cholesterol", f"{orig} {eng} {explanation} {hidden_risk or ''}")
            if risk_level == "high":
                strict_high_chol_candidates.append(i)

        original_is_latin = is_latin_script(orig)
        english_name = eng if eng and eng.lower() != orig.lower() else None

        entries.append({
            "dish": orig,
            "original_name": orig,
            "english_name": english_name,
            "original_is_latin": original_is_latin,
            "status": status,
            "risk_score": risk_score,
            "explanation": explanation,
            "hidden_risk": hidden_risk,
        })

    if strict_high_cholesterol:
        has_skip = any(r.get("status") == "skip_this" for r in entries)
        if not has_skip and strict_high_chol_candidates:
            promote_idx = strict_high_chol_candidates[0]
            entries[promote_idx]["status"] = "skip_this"
            entries[promote_idx]["risk_score"] = max(80, entries[promote_idx].get("risk_score", 0))
            if not entries[promote_idx].get("hidden_risk"):
                entries[promote_idx]["hidden_risk"] = "high high cholesterol relevance"
            if not entries[promote_idx].get("explanation"):
                entries[promote_idx]["explanation"] = "High-risk for strict high cholesterol guidance."

    _apply_distribution_quota(entries, strict_mode)

    results = [{
        "dish": e["dish"],
        "original_name": e["original_name"],
        "english_name": e["english_name"],
        "original_is_latin": e["original_is_latin"],
        "status": e["status"],
        "explanation": e["explanation"],
        "hidden_risk": e["hidden_risk"],
    } for e in entries]

    return {"results": results}


@app.post("/vision")
async def vision(request: VisionRequest):
    if not request.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 is required")

    image_data = request.image_base64
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        base64.b64decode(image_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "This is a restaurant menu image. Extract all menu text accurately and preserve the original language/script exactly as written. Do not translate, transliterate, summarize, or normalize script. Keep line breaks readable and return normal menu casing (not SHOUTY ALL CAPS) unless a token is an acronym like BBQ or GF."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
        ]}],
        max_tokens=1000,
    )
    raw_text = (response.choices[0].message.content or "").strip()
    return {"menu_text": normalize_menu_text(raw_text)}


@app.post("/chat")
async def chat(request: ChatRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    allergy_str = ", ".join(
        f"{a.label} (severity {a.severity}/10)" for a in request.allergies
    ) if request.allergies else "none"

    health_str = "; ".join(
        f"{h.label} — {h.guidance}" for h in request.health_profiles
    ) if request.health_profiles else "none"

    system_prompt = (
        "You are a helpful dietary assistant for BiteRight, a menu analysis app. "
        "You have deep knowledge of cuisines worldwide including hidden ingredients. "
        "Answer clearly and concisely. Always consider the user's allergies (respecting their severity level) "
        "and health conditions (respecting their guidance preference). "
        "For low severity allergies, don't be alarmist about trace exposures. "
        "For high severity allergies, mention any relevant hidden risks. "
        "If a dish is safe allergy-wise but conflicts with a health condition, mention it calmly. "
        "Never be preachy or over-cautious — be like a knowledgeable friend, not a warning label."
    )

    user_content = (
        f"User allergies: {allergy_str}\n"
        f"Health conditions: {health_str}\n"
    )
    if request.health_notes.strip():
        user_content += f"Additional notes: {request.health_notes.strip()}\n"
    if request.dish:
        user_content += f"Currently asking about: {request.dish}\n"
    if request.analysis_context:
        user_content += f"Menu analysis context:\n{request.analysis_context}\n"
    user_content += f"\nQuestion: {request.question}"

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=300,
    )
    return {"response": (response.choices[0].message.content or "").strip()}
