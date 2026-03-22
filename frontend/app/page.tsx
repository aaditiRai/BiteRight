"use client";

import { useEffect, useState, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

const ALLERGY_OPTIONS = [
  { id: "peanuts",   label: "Peanuts",   emoji: "🥜" },
  { id: "tree nuts", label: "Tree nuts", emoji: "🌰" },
  { id: "dairy",     label: "Dairy",     emoji: "🥛" },
  { id: "eggs",      label: "Eggs",      emoji: "🥚" },
  { id: "fish",      label: "Fish",      emoji: "🐟" },
  { id: "shellfish", label: "Shellfish", emoji: "🦐" },
  { id: "soy",       label: "Soy",       emoji: "🫘" },
  { id: "gluten",    label: "Gluten",    emoji: "🌾" },
  { id: "sesame",    label: "Sesame",    emoji: "🌿" },
  { id: "sulfites",  label: "Sulfites",  emoji: "🍷" },
] as const;

const HEALTH_OPTIONS = [
  { id: "high cholesterol",    label: "High cholesterol" },
  { id: "diabetes",            label: "Diabetes / blood sugar" },
  { id: "high blood pressure", label: "High blood pressure" },
  { id: "vegan",               label: "Vegan" },
  { id: "vegetarian",          label: "Vegetarian" },
  { id: "halal",               label: "Halal" },
  { id: "kosher",              label: "Kosher" },
] as const;

const GUIDANCE_OPTIONS: Record<string, string[]> = {
  "high cholesterol": [
    "Basic — major concerns only",
    "Balanced — high saturated fat & cholesterol",
    "Strict — avoid cholesterol-raising foods"
  ],
  "diabetes": [
    "Basic — major concerns only",
    "Balanced — high sugar & refined carbs",
    "Strict — avoid blood sugar spikes"
  ],
  "high blood pressure": [
    "Basic — major concerns only",
    "Balanced — high sodium",
    "Strict — avoid blood pressure triggers"
  ],
  "vegan": [
    "Strict — no animal products"
  ],
  "vegetarian": [
    "Strict — no meat or fish"
  ],
  "halal": [
    "Basic — obvious non-halal items",
    "Balanced — common non-halal ingredients",
    "Strict — avoid anything questionable"
  ],
  "kosher": [
    "Basic — obvious non-kosher items",
    "Balanced — common non-kosher ingredients",
    "Strict — avoid anything questionable"
  ]
};

const CUSTOM_HEALTH_GUIDANCE_OPTIONS = [
  "Basic — major concerns only",
  "Balanced — common relevant ingredients",
  "Strict — avoid anything questionable",
];

type AllergyId = (typeof ALLERGY_OPTIONS)[number]["id"];
type HealthId   = (typeof HEALTH_OPTIONS)[number]["id"];
type SeverityTier = "low" | "med" | "high";

const SEVERITY_TIER_META: Record<SeverityTier, { label: string; badgeLabel: string; explanation: string }> = {
  low: {
    label: "Mild intolerance — discomfort only",
    badgeLabel: "mild intolerance",
    explanation: "We only flag dominant ingredients and ignore cooking oils, traces, and incidental garnish exposure.",
  },
  med: {
    label: "Moderate allergy — real reaction",
    badgeLabel: "moderate allergy",
    explanation: "We flag direct ingredients and common sauce components, but do not flag trace oil-only exposure.",
  },
  high: {
    label: "Severe / anaphylactic allergy",
    badgeLabel: "severe / anaphylactic",
    explanation: "We flag everything relevant, including oils, garnish traces, and cross-contamination risk.",
  },
};

const SEVERITY_TIER_COLORS: Record<SeverityTier, { text: string; border: string; bg: string }> = {
  low: { text: "#9fe271", border: "rgba(120,181,54,0.72)", bg: "rgba(120,181,54,0.16)" },
  med: { text: "#f1b26a", border: "rgba(208,138,36,0.78)", bg: "rgba(208,138,36,0.18)" },
  high: { text: "#ff8a8a", border: "rgba(195,58,58,0.78)", bg: "rgba(195,58,58,0.18)" },
};

const SEVERITY_TIER_SELECT_BG: Record<SeverityTier, string> = {
  low: "rgba(120,181,54,0.28)",
  med: "rgba(208,138,36,0.30)",
  high: "rgba(195,58,58,0.30)",
};

const SEVERITY_TIER_TO_SCORE: Record<SeverityTier, number> = {
  low: 3,
  med: 6,
  high: 9,
};

interface AllergyProfile {
  id: string;
  label: string;
  emoji: string;
  severity_tier: SeverityTier;
}

interface HealthProfile {
  id: string;
  label: string;
  guidance: string;
}

interface DishResult {
  dish: string;
  original_name?: string | null;
  english_name?: string | null;
  original_is_latin?: boolean;
  status: "safe_for_you" | "be_mindful" | "skip_this";
  explanation: string;
  hidden_risk: string | null;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  skip_this:    { label: "Skip this",    dot: "#C33A3A", text: "#C95A5A", bg: "rgba(195, 58, 58, 0.18)", activeCls: "bg-red-50" },
  be_mindful:   { label: "Be mindful",   dot: "#D08A24", text: "#DFA35B", bg: "rgba(208, 138, 36, 0.2)", activeCls: "bg-amber-50" },
  safe_for_you: { label: "Safe for you", dot: "#78B536", text: "#8CCD45", bg: "rgba(120, 181, 54, 0.18)", activeCls: "bg-green-50" },
};

const API = "http://localhost:8000";
const BRAND_BITE_COLOR = "#1f4a33";
const BRAND_RIGHT_COLOR = "#8a6034";
const PROFILE_BG_DARK_GREEN = "#1f4a33";
const PROFILE_BG_LIGHT_GREEN = "#dff0dc";

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  // Profile state
  const [profileDone, setProfileDone]     = useState(false);
  const [allergies, setAllergies]         = useState<AllergyProfile[]>([]);
  const [customInput, setCustomInput]     = useState("");
  const [healthProfiles, setHealthProfiles] = useState<HealthProfile[]>([]);
  const [healthCustomInput, setHealthCustomInput] = useState("");
  const [healthNotes, setHealthNotes]     = useState("");

  // Menu state
  const [menuText, setMenuText]   = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showMenuInput, setShowMenuInput] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Results state
  const [results, setResults]         = useState<DishResult[]>([]);
  const [selectedDish, setSelectedDish] = useState<DishResult | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");

  // Chat state
  const [chatInput, setChatInput]       = useState("");
  const [chatResponse, setChatResponse] = useState("");
  const [chatLoading, setChatLoading]   = useState(false);

  // ─── Profile helpers ────────────────────────────────────────────────────────

  function toggleAllergy(opt: typeof ALLERGY_OPTIONS[number]) {
    setAllergies(prev => {
      if (prev.find(a => a.id === opt.id)) return prev.filter(a => a.id !== opt.id);
      return [...prev, { id: opt.id, label: opt.label, emoji: opt.emoji, severity_tier: "med" }];
    });
  }

  function setSeverityTier(id: string, tier: SeverityTier) {
    setAllergies(prev => prev.map(a => a.id === id ? { ...a, severity_tier: tier } : a));
  }

  function addCustomAllergy() {
    const val = customInput.trim();
    if (!val || allergies.find(a => a.id === val.toLowerCase())) return;
    setAllergies(prev => [...prev, { id: val.toLowerCase(), label: val, emoji: "⚠️", severity_tier: "med" }]);
    setCustomInput("");
  }

  function guidanceOptionsForHealth(id: string) {
    return GUIDANCE_OPTIONS[id] ?? CUSTOM_HEALTH_GUIDANCE_OPTIONS;
  }

  function toggleHealth(opt: typeof HEALTH_OPTIONS[number]) {
    setHealthProfiles(prev => {
      if (prev.find(h => h.id === opt.id)) return prev.filter(h => h.id !== opt.id);
      const defaultGuidance = guidanceOptionsForHealth(opt.id)[0] ?? "";
      return [...prev, { id: opt.id, label: opt.label, guidance: defaultGuidance }];
    });
  }

  function addCustomHealthConcern() {
    const label = healthCustomInput.trim();
    const id = label.toLowerCase();
    if (!label || healthProfiles.find(h => h.id === id)) return;

    const defaultGuidance = guidanceOptionsForHealth(id)[0] ?? "";
    setHealthProfiles(prev => [...prev, { id, label, guidance: defaultGuidance }]);
    setHealthCustomInput("");
  }

  function setGuidance(id: string, guidance: string) {
    setHealthProfiles(prev => prev.map(h => h.id === id ? { ...h, guidance } : h));
  }

  function severityBadgeLabel(tier: SeverityTier) {
    return SEVERITY_TIER_META[tier].badgeLabel;
  }

  function toApiAllergy(a: AllergyProfile) {
    return {
      id: a.id,
      label: a.label,
      severity: SEVERITY_TIER_TO_SCORE[a.severity_tier],
    };
  }

  function guidanceTier(guidance: string, index: number, total: number): SeverityTier {
    const g = guidance.toLowerCase();
    if (g.startsWith("basic")) return "low";
    if (g.startsWith("balanced")) return "med";
    if (g.startsWith("strict")) return "high";
    if (total === 1) return "high";
    if (index === 0) return "low";
    if (index === 1) return "med";
    return "high";
  }

  function cardName(d: DishResult) {
    const original = (d.original_name ?? d.dish).trim();
    if (d.original_is_latin) return original;
    return d.english_name ?? original;
  }

  function detailAltName(d: DishResult): { label: string; value: string } | null {
    const original = (d.original_name ?? d.dish).trim();
    if (d.original_is_latin) {
      if (!d.english_name) return null;
      return { label: "English translation", value: d.english_name };
    }
    if (!original) return null;
    return { label: "Original name", value: original };
  }

  // ─── Analyze ────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    setShowMenuInput(false);
    setError("");
    setResults([]);
    setSelectedDish(null);
    setChatResponse("");
    setLoading(true);

    try {
      let text = menuText.trim();

      if (imageFile) {
        const b64 = await fileToBase64(imageFile);
        const res = await fetch(`${API}/vision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: b64 }),
        });
        if (!res.ok) throw new Error("Vision extraction failed");
        text = (await res.json()).menu_text;
        setMenuText(text);
      }

      if (!text) {
        setError("Please paste menu text or upload an image.");
        setShowMenuInput(true);
        setLoading(false);
        return;
      }

      const parseRes = await fetch(`${API}/parse-menu`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_text: text }),
      });
      if (!parseRes.ok) throw new Error("Failed to parse menu");
      const { dishes } = await parseRes.json();

      const analyzeRes = await fetch(`${API}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dishes,
          allergies: allergies.map(toApiAllergy),
          health_profiles: healthProfiles,
          health_notes: healthNotes,
        }),
      });
      if (!analyzeRes.ok) throw new Error("Failed to analyze dishes");
      setResults((await analyzeRes.json()).results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      setShowMenuInput(true);
    } finally {
      setLoading(false);
    }
  }

  function stopCameraStream() {
    if (cameraStreamRef.current) {
      for (const track of cameraStreamRef.current.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }
  }

  async function openCameraModal() {
    setCameraError("");
    setCameraLoading(true);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("Camera access failed. Please allow camera permission or upload an image instead.");
    } finally {
      setCameraLoading(false);
    }
  }

  function closeCameraModal() {
    setCameraOpen(false);
    stopCameraStream();
    setCameraError("");
  }

  function captureFromCamera() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const captured = new File([blob], "captured-menu.jpg", { type: "image/jpeg" });
      setImageFile(captured);
      setMenuText("");
      closeCameraModal();
    }, "image/jpeg", 0.92);
  }

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  // ─── Chat ───────────────────────────────────────────────────────────────────

  async function handleChat() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse("");
    try {
      const context = results.map(r =>
        `${cardName(r)}${r.english_name ? ` (original: ${(r.original_name ?? r.dish)})` : ""}: ${r.status} — ${r.explanation}${r.hidden_risk ? ` [hidden: ${r.hidden_risk}]` : ""}`
      ).join("\n");

      const res = await fetch(`${API}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: chatInput,
          allergies: allergies.map(toApiAllergy),
          health_profiles: healthProfiles,
          health_notes: healthNotes,
          dish: selectedDish ? cardName(selectedDish) : null,
          analysis_context: context,
        }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      setChatResponse((await res.json()).response);
    } catch (e: unknown) {
      setChatResponse(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setChatLoading(false);
    }
  }

  // ─── PROFILE SETUP ──────────────────────────────────────────────────────────

  if (!profileDone) {
    return (
      <main style={{ minHeight: "100vh", padding: "30px clamp(16px, 3.2vw, 52px)", maxWidth: "100%", margin: "0 auto", background: PROFILE_BG_DARK_GREEN }}>
        <div className="br-shell" style={{ width: "100%", maxWidth: 1260, margin: "0 auto", background: PROFILE_BG_LIGHT_GREEN, borderColor: "rgba(31,74,51,0.22)", padding: "30px clamp(18px, 2.4vw, 36px)" }}>

          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 30 }}>
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              <p style={{ fontSize: 62, fontWeight: 800, margin: 0, letterSpacing: "-0.03em", lineHeight: 1 }}>
                <span style={{ color: BRAND_BITE_COLOR }}>Bite</span>
                <span style={{ color: BRAND_RIGHT_COLOR }}>Right</span>
              </p>
            </div>
            <p style={{ fontSize: 20, color: "#2a2a2a", margin: "8px 0 0", fontWeight: 600 }}>Know what&apos;s safe to eat - instantly.</p>
          </div>

          {/* ── Allergy card ── */}
          <div style={cardStyle}>
            <p style={sectionLabel}>Food allergies</p>
            <p style={hintText}>Choose a sensitivity tier for each selected allergy.</p>

            {/* Allergy chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
              {ALLERGY_OPTIONS.map(opt => {
                const sel = !!allergies.find(a => a.id === opt.id);
                return (
                  <button key={opt.id} onClick={() => toggleAllergy(opt)} style={{
                    padding: "9px 18px", borderRadius: 999, fontSize: 19, fontWeight: 500,
                    border: sel ? "1px solid rgba(128,184,79,0.7)" : "1px solid rgba(255,255,255,0.16)",
                    background: sel ? "rgba(128,184,79,0.2)" : "rgba(255,255,255,0.06)",
                    color: sel ? "#d8f5be" : "rgba(245,245,245,0.8)",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                    transition: "all .15s",
                  }}>
                    <span style={{ fontSize: 20 }}>{opt.emoji}</span>
                    {opt.label}
                    {sel && <span style={{ color: "#d8f5be", fontSize: 14, marginLeft: 2 }}>✕</span>}
                  </button>
                );
              })}
              {/* Custom chips */}
              {allergies.filter(a => !ALLERGY_OPTIONS.find(o => o.id === a.id)).map(a => (
                <button key={a.id} onClick={() => setAllergies(prev => prev.filter(x => x.id !== a.id))} style={{
                  padding: "9px 18px", borderRadius: 999, fontSize: 16, fontWeight: 500,
                  border: "1px solid rgba(128,184,79,0.7)", background: "rgba(128,184,79,0.2)", color: "#d8f5be", cursor: "pointer",
                }}>
                  {a.label} <span style={{ color: "#d8f5be", fontSize: 14 }}>✕</span>
                </button>
              ))}
            </div>

            {/* Severity tiers */}
            {allergies.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
                {allergies.map(a => (
                  <div key={a.id} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: "12px 14px", background: "rgba(255,255,255,0.04)" }}>
                    {(() => {
                      const tierColors = SEVERITY_TIER_COLORS[a.severity_tier];
                      return (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <span style={{ fontSize: 21, fontWeight: 600, color: "#f2f2f2", minWidth: 220 }}>
                        {a.emoji} {a.label}
                      </span>
                      <select
                        value={a.severity_tier}
                        onChange={e => setSeverityTier(a.id, e.target.value as SeverityTier)}
                        style={{
                          ...inputStyle,
                          width: "100%",
                          maxWidth: 420,
                          background: SEVERITY_TIER_SELECT_BG[a.severity_tier],
                          borderColor: tierColors.border,
                          color: tierColors.text,
                          fontWeight: 600,
                        }}
                      >
                        <option value="low" style={{ color: "#4f8f22", background: "#f4fff0" }}>{SEVERITY_TIER_META.low.label}</option>
                        <option value="med" style={{ color: "#a45f15", background: "#fff7ee" }}>{SEVERITY_TIER_META.med.label}</option>
                        <option value="high" style={{ color: "#a12e2e", background: "#fff1f1" }}>{SEVERITY_TIER_META.high.label}</option>
                      </select>
                    </div>
                      );
                    })()}
                    <p style={{ margin: 0, fontSize: 14, color: "rgba(245,245,245,0.82)", lineHeight: 1.45 }}>
                      {SEVERITY_TIER_META[a.severity_tier].explanation}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Custom allergy input */}
            <div style={{ display: "flex", gap: 10 }}>
              <input type="text" placeholder="+ Add another allergy (e.g. mustard)"
                value={customInput} onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomAllergy()}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={addCustomAllergy} style={secondaryBtnStyle}>Add</button>
            </div>
          </div>

          {/* ── Health conditions card ── */}
          <div style={cardStyle}>
            <p style={sectionLabel}>Health conditions &amp; dietary goals</p>
            <p style={hintText}>Optional — tell us what kind of guidance you want for each condition.</p>

            {/* Condition chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
              {HEALTH_OPTIONS.map(opt => {
                const sel = !!healthProfiles.find(h => h.id === opt.id);
                return (
                  <button key={opt.id} onClick={() => toggleHealth(opt)} style={{
                    padding: "9px 18px", borderRadius: 999, fontSize: 16, fontWeight: 500,
                    border: sel ? "1px solid rgba(231,200,154,0.8)" : "1px solid rgba(255,255,255,0.16)",
                    background: sel ? "rgba(231,200,154,0.2)" : "rgba(255,255,255,0.06)",
                    color: sel ? "#ffe9c7" : "rgba(245,245,245,0.8)",
                    cursor: "pointer", transition: "all .15s",
                  }}>
                    {opt.label}
                    {sel && <span style={{ color: "#ffe9c7", fontSize: 14, marginLeft: 4 }}>✕</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input
                type="text"
                placeholder="+ Add another health concern"
                value={healthCustomInput}
                onChange={e => setHealthCustomInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomHealthConcern()}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={addCustomHealthConcern} style={secondaryBtnStyle}>Add</button>
            </div>

            {/* Guidance selectors per condition */}
            {healthProfiles.map(h => (
              <div key={h.id} style={{
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, padding: "14px 16px",
                marginBottom: 10, background: "#EEEDFE18",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#f2f2f2" }}>{h.label}</span>
                  <button onClick={() => setHealthProfiles(prev => prev.filter(x => x.id !== h.id))}
                    style={{ fontSize: 13, color: "rgba(245,245,245,0.62)", background: "none", border: "none", cursor: "pointer" }}>
                    Remove ✕
                  </button>
                </div>
                <p style={{ fontSize: 14, color: "rgba(245,245,245,0.62)", margin: "0 0 10px" }}>What kind of guidance do you want?</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {guidanceOptionsForHealth(h.id).map((g, idx, arr) => {
                    const tier = guidanceTier(g, idx, arr.length);
                    const tierColors = SEVERITY_TIER_COLORS[tier];
                    const isSelected = h.guidance === g;
                    return (
                      <button key={g} onClick={() => setGuidance(h.id, g)} style={{
                        padding: "7px 14px", borderRadius: 999, fontSize: 14, fontWeight: 500,
                        border: isSelected ? `1px solid ${tierColors.border}` : `1px solid ${tierColors.border.replace(/0\.\d+\)$/, "0.55)")}`,
                        background: isSelected ? tierColors.bg.replace(/0\.\d+\)$/, "0.32)") : tierColors.bg.replace(/0\.\d+\)$/, "0.2)") ,
                        color: isSelected ? tierColors.text : "rgba(245,245,245,0.86)",
                        cursor: "pointer", transition: "all .15s",
                      }}>{g}</button>
                    );
                  })}
                </div>
              </div>
            ))}

          </div>

          {/* Continue */}
          <button onClick={() => setProfileDone(true)} style={{
            width: "100%", padding: "18px", background: BRAND_RIGHT_COLOR, color: "#fff",
            border: "1px solid rgba(255,255,255,0.32)", borderRadius: 14, fontSize: 20, fontWeight: 700,
            cursor: "pointer", letterSpacing: ".01em",
          }}>
            Continue →
          </button>
        </div>
      </main>
    );
  }

  // ─── MAIN APP ───────────────────────────────────────────────────────────────

  const skipList    = results.filter(r => r.status === "skip_this");
  const mindfulList = results.filter(r => r.status === "be_mindful");
  const safeList    = results.filter(r => r.status === "safe_for_you");

  return (
    <main style={{ minHeight: "100vh", padding: "30px clamp(16px, 3.2vw, 52px)", maxWidth: "100%", margin: "0 auto", background: PROFILE_BG_DARK_GREEN }}>
      <div className="br-shell" style={{ width: "100%", maxWidth: 1260, margin: "0 auto", background: PROFILE_BG_LIGHT_GREEN, borderColor: "rgba(31,74,51,0.22)", padding: "30px clamp(18px, 2.4vw, 36px)" }}>

      {/* Header */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 18, minHeight: 68 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 52, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, textAlign: "center" }}>
            <span style={{ color: BRAND_BITE_COLOR }}>Bite</span>
            <span style={{ color: BRAND_RIGHT_COLOR }}>Right</span>
          </span>
        </div>
        <button
          onClick={() => setProfileDone(false)}
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 17,
            color: "#fff8eb",
            background: BRAND_RIGHT_COLOR,
            border: "1px solid rgba(95,63,29,0.45)",
            borderRadius: 999,
            cursor: "pointer",
            fontWeight: 700,
            lineHeight: 1,
            padding: "13px 20px",
            boxShadow: "0 4px 14px rgba(95,63,29,0.25)",
          }}
        >
          Edit profile
        </button>
      </div>

      {/* Profile badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        {allergies.map(a => (
          <span key={a.id} style={{ padding: "8px 16px", borderRadius: 999, fontSize: 15, fontWeight: 700, background: "rgba(128,184,79,0.3)", color: "#1f4a33", border: "1px solid rgba(31,74,51,0.48)" }}>
            {a.emoji} {a.label} — {severityBadgeLabel(a.severity_tier)}
          </span>
        ))}
        {healthProfiles.map(h => (
          <span key={h.id} style={{ padding: "8px 16px", borderRadius: 999, fontSize: 15, fontWeight: 700, background: "rgba(231,200,154,0.34)", color: "#5f3f1d", border: "1px solid rgba(138,96,52,0.55)" }}>
            {h.label} · {h.guidance.toLowerCase()}
          </span>
        ))}
        {allergies.length === 0 && healthProfiles.length === 0 && (
          <span style={{ fontSize: 12, color: "rgba(245,245,245,0.62)", fontStyle: "italic" }}>No restrictions set</span>
        )}
      </div>

      {/* Menu input */}
      {showMenuInput && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <p style={{ fontSize: 21, fontWeight: 700, color: "rgba(245,245,245,0.9)", margin: "0 0 10px", letterSpacing: ".03em", textTransform: "uppercase" }}>Paste or upload a menu</p>
          <textarea rows={6} placeholder="Paste menu text here..."
            value={menuText} onChange={e => setMenuText(e.target.value)}
            style={{ ...inputStyle, resize: "none", width: "100%", marginBottom: 10 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                ...secondaryBtnStyle,
                background: BRAND_RIGHT_COLOR,
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                fontWeight: 700,
              }}
            >
              {imageFile ? `📎 ${imageFile.name}` : "Upload menu image"}
            </button>
            <button
              onClick={openCameraModal}
              style={{
                ...secondaryBtnStyle,
                background: BRAND_RIGHT_COLOR,
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                fontWeight: 700,
              }}
            >
              Use camera
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => setImageFile(e.target.files?.[0] ?? null)} />
            {imageFile && (
              <button onClick={() => { setImageFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ fontSize: 11, color: "rgba(245,245,245,0.62)", background: "none", border: "none", cursor: "pointer" }}>
                ✕ Remove
              </button>
            )}
            <button onClick={handleAnalyze} disabled={loading} style={{
              marginLeft: "auto", padding: "12px 24px", background: loading ? "#6f583f" : BRAND_RIGHT_COLOR,
              color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
            }}>
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>
          {error && <p style={{ marginTop: 8, fontSize: 12, color: "#A32D2D" }}>{error}</p>}
        </div>
      )}

      {loading && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <p style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 800, color: "rgba(245,245,245,0.94)" }}>
            Analyzing menu...
          </p>

          <div className="menu-scan-wrap">
            <div className="menu-scan-sheet">
              <div className="menu-scan-row">
                <span className="scan-word lit lit-1">Dan Dan Noodles</span>
                <span className="scan-word">Braised Tofu</span>
                <span className="scan-word lit lit-2">Peanut Sauce</span>
              </div>
              <div className="menu-scan-row">
                <span className="scan-word">Mapo Tofu</span>
                <span className="scan-word lit lit-3">Shrimp Dumplings</span>
                <span className="scan-word">Scallion Pancake</span>
              </div>
              <div className="menu-scan-row">
                <span className="scan-word">Sesame Chicken</span>
                <span className="scan-word">Hot &amp; Sour Soup</span>
                <span className="scan-word lit lit-4">Walnut Prawns</span>
              </div>
              <div className="scan-glass">
                <div className="scan-glass-lens" />
                <div className="scan-glass-handle" />
              </div>
            </div>
          </div>

          <p style={{ margin: "12px 0 0", fontSize: 15, fontWeight: 600, color: "rgba(245,245,245,0.82)" }}>
            Scanning menu text and highlighting ingredient risks...
          </p>
        </div>
      )}

      {!showMenuInput && !loading && (
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => {
              setShowMenuInput(true);
              setResults([]);
              setSelectedDish(null);
              setChatResponse("");
              setChatInput("");
              setMenuText("");
              setImageFile(null);
              setError("");
              if (fileRef.current) fileRef.current.value = "";
            }}
            style={{
              ...secondaryBtnStyle,
              background: PROFILE_BG_DARK_GREEN,
              color: "#dff0dc",
              border: "1px solid rgba(223,240,220,0.34)",
              fontWeight: 700,
            }}
          >
            Analyze another menu
          </button>
        </div>
      )}

      {/* ── Results ── */}
      {results.length > 0 && (
        <>
          {/* 3-column grid */}
          <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 12, marginBottom: 12 }}>
            {(["skip_this", "be_mindful", "safe_for_you"] as const).map(status => {
              const cfg  = STATUS_CONFIG[status];
              const list = status === "skip_this" ? skipList : status === "be_mindful" ? mindfulList : safeList;
              return (
                <div key={status} className="br-dark-card">
                  {/* Column header */}
                  <div style={{ padding: "12px 18px 10px", borderBottom: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: cfg.dot, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 19, fontWeight: 700, color: cfg.text }}>{cfg.label}</span>
                    <span style={{
                      fontSize: 13,
                      color: cfg.text,
                      marginLeft: "auto",
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1.5px solid ${cfg.dot}`,
                      background: cfg.bg,
                      boxShadow: `0 0 0 1px ${cfg.dot}33, 0 0 10px ${cfg.dot}40`,
                      lineHeight: 1.2,
                    }}>{list.length} dish{list.length !== 1 ? "es" : ""}</span>
                  </div>
                  {/* Dish rows */}
                  {list.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: 12, color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>None</div>
                  ) : list.map(r => {
                    const isActive = selectedDish?.dish === r.dish;
                    return (
                      <div key={r.dish}
                        onClick={() => setSelectedDish(isActive ? null : r)}
                        style={{
                          padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)",
                          cursor: "pointer", fontSize: 17, fontWeight: 600, color: "#eeeeee",
                          background: isActive ? cfg.bg : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          transition: "background .12s",
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        <span>{cardName(r)}</span>
                        <span style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", transform: isActive ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          {selectedDish && (() => {
            const cfg = STATUS_CONFIG[selectedDish.status];
            const detailName = detailAltName(selectedDish);
            return (
              <div className="br-dark-card" style={{ padding: "20px 22px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.dot, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontSize: 21, fontWeight: 700, color: "#f2f2f2" }}>{cardName(selectedDish)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: cfg.text }}>{cfg.label}</span>
                </div>
                {detailName && (
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#ffe9c7", lineHeight: 1.4 }}>
                    {detailName.label}: {detailName.value}
                  </p>
                )}
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.84)", lineHeight: 1.65, margin: 0 }}>{selectedDish.explanation}</p>
                {selectedDish.hidden_risk && (
                  <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(239, 159, 39, 0.18)", border: "1px solid rgba(239, 159, 39, 0.5)", display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
                    <span style={{ fontSize: 12, color: "#ffe9c7", lineHeight: 1.5 }}>
                      <strong>Hidden ingredient note:</strong> {selectedDish.hidden_risk}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Chat */}
          <div className="br-dark-card" style={{ padding: "24px 28px", marginBottom: 0 }}>
            <p style={{ fontSize: 40, fontWeight: 700, color: "#f3f3f3", margin: "0 0 2px", letterSpacing: "-0.02em" }}>Ask a follow-up</p>
            {selectedDish
              ? <p style={{ fontSize: 14, color: "#ffe9c7", margin: "0 0 12px" }}>Context: {cardName(selectedDish)}</p>
              : <p style={{ fontSize: 14, color: "#ffe9c7", margin: "0 0 12px" }}>Select a dish above for context</p>
            }
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="e.g. Can I ask them to make this without the sauce?"
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleChat()}
                className="br-soft-input"
                style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "13px 18px", borderRadius: 14 }} />
              <button onClick={handleChat} disabled={chatLoading} style={{
                padding: "10px 28px", background: BRAND_RIGHT_COLOR,
                color: "#f7f7f7", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 14, fontSize: 13, fontWeight: 700,
                cursor: chatLoading ? "not-allowed" : "pointer",
              }}>
                {chatLoading ? "…" : "Ask"}
              </button>
            </div>
            {chatResponse && (
              <div style={{ marginTop: 12, padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 13, color: "#ececec", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                {chatResponse}
              </div>
            )}
          </div>

          {/* Disclaimer */}
          <p style={{ margin: "14px auto 0", fontSize: 17, fontWeight: 650, lineHeight: 1.55, color: PROFILE_BG_DARK_GREEN, textAlign: "right", maxWidth: 980 }}>
            BiteRight gives general guidance based on typical ingredients. Always confirm with your server for severe allergies.
          </p>
        </>
      )}

      {cameraOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.64)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          zIndex: 1000,
        }}>
          <div className="br-dark-card" style={{ width: "min(760px, 96vw)", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f2f2f2" }}>Capture menu photo</p>
              <button onClick={closeCameraModal} style={{ background: "none", border: "none", color: "#f2f2f2", cursor: "pointer", fontSize: 18, fontWeight: 700 }}>✕</button>
            </div>

            <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "#111" }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", minHeight: 260, objectFit: "cover" }} />
            </div>

            {cameraLoading && <p style={{ margin: "10px 0 0", color: "rgba(245,245,245,0.8)" }}>Starting camera...</p>}
            {cameraError && <p style={{ margin: "10px 0 0", color: "#ffabab", fontWeight: 600 }}>{cameraError}</p>}

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={closeCameraModal} style={{ ...secondaryBtnStyle, color: "#f2f2f2" }}>Cancel</button>
              <button
                onClick={captureFromCamera}
                disabled={!!cameraError || cameraLoading}
                style={{
                  ...secondaryBtnStyle,
                  background: BRAND_RIGHT_COLOR,
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.3)",
                  fontWeight: 700,
                  cursor: !!cameraError || cameraLoading ? "not-allowed" : "pointer",
                  opacity: !!cameraError || cameraLoading ? 0.6 : 1,
                }}
              >
                Capture
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(155deg, #323232, #2a2a2a)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)",
  padding: "24px 26px", marginBottom: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: "rgba(245,245,245,0.9)", letterSpacing: ".08em",
  textTransform: "uppercase", margin: "0 0 6px",
};

const hintText: React.CSSProperties = {
  fontSize: 21, fontWeight: 600, color: "rgba(245,245,245,0.9)", margin: "0 0 20px",
};

const inputStyle: React.CSSProperties = {
  fontSize: 16, padding: "12px 16px", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)",
  color: "#f2f2f2", outline: "none", fontFamily: "inherit",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "11px 18px", fontSize: 16, borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)",
  color: "#f2f2f2", cursor: "pointer",
};

// ─── Util ─────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload  = () => resolve(r.result as string);
    r.onerror = reject;
  });
}