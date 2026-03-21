"use client";

import { useState, useRef } from "react";

const ALLERGY_OPTIONS = ["peanuts", "dairy", "gluten", "shellfish"] as const;
type Allergy = (typeof ALLERGY_OPTIONS)[number];

interface DishResult {
  dish: string;
  status: "safe" | "caution" | "unsafe";
  explanation: string;
}

const STATUS_STYLES: Record<DishResult["status"], string> = {
  safe: "bg-green-100 text-green-800",
  caution: "bg-yellow-100 text-yellow-800",
  unsafe: "bg-red-100 text-red-800",
};

const STATUS_ROW: Record<DishResult["status"], string> = {
  safe: "hover:bg-green-50",
  caution: "hover:bg-yellow-50",
  unsafe: "hover:bg-red-50",
};

const API = "http://localhost:8000";

export default function Home() {
  // --- Profile step ---
  const [profileDone, setProfileDone] = useState(false);
  const [allergies, setAllergies] = useState<Allergy[]>([]);

  // --- Menu input ---
  const [menuText, setMenuText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Analysis ---
  const [results, setResults] = useState<DishResult[]>([]);
  const [selectedDish, setSelectedDish] = useState<DishResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // --- Chat ---
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // --- Handlers ---

  function toggleAllergy(a: Allergy) {
    setAllergies((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }

  async function handleAnalyze() {
    setError("");
    setResults([]);
    setSelectedDish(null);
    setChatResponse("");
    setLoading(true);

    try {
      let text = menuText.trim();

      // If image provided, extract text via /vision
      if (imageFile) {
        const base64 = await fileToBase64(imageFile);
        const visionRes = await fetch(`${API}/vision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: base64 }),
        });
        if (!visionRes.ok) throw new Error("Vision extraction failed");
        const visionData = await visionRes.json();
        text = visionData.menu_text;
        setMenuText(text);
      }

      if (!text) {
        setError("Please paste menu text or upload a menu image.");
        setLoading(false);
        return;
      }

      // Parse menu text into dish names
      const parseRes = await fetch(`${API}/parse-menu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_text: text }),
      });
      if (!parseRes.ok) throw new Error("Failed to parse menu");
      const parseData = await parseRes.json();
      const parsedDishes: string[] = parseData.dishes;

      // Analyze dishes
      const analyzeRes = await fetch(`${API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dishes: parsedDishes, allergies }),
      });
      if (!analyzeRes.ok) throw new Error("Failed to analyze dishes");
      const analyzeData = await analyzeRes.json();
      setResults(analyzeData.results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleChat() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse("");
    try {
      const context = results.length
        ? results
            .map((r) => `${r.dish}: ${r.status} — ${r.explanation}`)
            .join("\n")
        : undefined;

      const chatRes = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: chatInput,
          allergies,
          dish: selectedDish?.dish ?? null,
          analysis_context: context ?? null,
        }),
      });
      if (!chatRes.ok) throw new Error("Chat request failed");
      const chatData = await chatRes.json();
      setChatResponse(chatData.response);
    } catch (e: unknown) {
      setChatResponse(
        e instanceof Error ? e.message : "An unexpected error occurred"
      );
    } finally {
      setChatLoading(false);
    }
  }

  // --- Profile modal ---
  if (!profileDone) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold text-center mb-1">🍽️ BiteRight</h1>
          <p className="text-center text-gray-500 mb-6">
            Know what&apos;s safe to eat — instantly.
          </p>
          <h2 className="font-semibold text-lg mb-3">
            Select your dietary restrictions:
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {ALLERGY_OPTIONS.map((a) => (
              <button
                key={a}
                onClick={() => toggleAllergy(a)}
                className={`py-3 px-4 rounded-xl border-2 font-medium capitalize transition-colors ${
                  allergies.includes(a)
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-indigo-300"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            onClick={() => setProfileDone(true)}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors"
          >
            Continue →
          </button>
        </div>
      </main>
    );
  }

  // --- Main app ---
  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">🍽️ BiteRight</h1>
        <button
          onClick={() => setProfileDone(false)}
          className="text-sm text-indigo-600 hover:underline"
        >
          Edit profile
        </button>
      </div>

      {/* Allergies badge row */}
      <div className="flex flex-wrap gap-2 mb-6">
        {allergies.length === 0 ? (
          <span className="text-sm text-gray-400 italic">No allergies set</span>
        ) : (
          allergies.map((a) => (
            <span
              key={a}
              className="px-3 py-1 bg-indigo-100 text-indigo-700 text-sm font-medium rounded-full capitalize"
            >
              {a}
            </span>
          ))
        )}
      </div>

      {/* Menu input card */}
      <div className="bg-white rounded-2xl shadow p-6 mb-6">
        <h2 className="font-semibold text-lg mb-3">Paste or upload a menu</h2>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
          rows={6}
          placeholder="Paste menu text here…"
          value={menuText}
          onChange={(e) => setMenuText(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            {imageFile ? `📎 ${imageFile.name}` : "Upload menu image"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
          {imageFile && (
            <button
              className="text-xs text-gray-400 hover:text-red-500"
              onClick={() => {
                setImageFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              ✕ Remove
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="ml-auto px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4">
            Results{" "}
            <span className="text-sm font-normal text-gray-400">
              (click a dish for details)
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4 font-medium">Dish</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.dish}
                    onClick={() =>
                      setSelectedDish(selectedDish?.dish === r.dish ? null : r)
                    }
                    className={`border-b last:border-0 cursor-pointer transition-colors ${STATUS_ROW[r.status]} ${
                      selectedDish?.dish === r.dish ? "bg-indigo-50" : ""
                    }`}
                  >
                    <td className="py-3 pr-4 font-medium">{r.dish}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-500 text-xs">
                      {selectedDish?.dish === r.dish ? r.explanation : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dish explanation panel */}
          {selectedDish && (
            <div className="mt-4 p-4 rounded-xl border border-indigo-200 bg-indigo-50">
              <p className="font-semibold mb-1">{selectedDish.dish}</p>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize mr-2 ${STATUS_STYLES[selectedDish.status]}`}
              >
                {selectedDish.status}
              </span>
              <p className="mt-2 text-sm text-gray-700">
                {selectedDish.explanation}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Chat section */}
      {results.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="font-semibold text-lg mb-3">
            Ask a follow-up question
          </h2>
          {selectedDish && (
            <p className="text-xs text-indigo-600 mb-2">
              Context: {selectedDish.dish}
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="e.g. Is this dish safe if I have a mild dairy allergy?"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleChat()}
            />
            <button
              onClick={handleChat}
              disabled={chatLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {chatLoading ? "…" : "Ask"}
            </button>
          </div>
          {chatResponse && (
            <div className="mt-4 p-4 bg-gray-50 rounded-xl text-sm text-gray-700 whitespace-pre-wrap">
              {chatResponse}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

// Utility: file → base64 string
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}
