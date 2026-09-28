"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Bold, Italic, Strikethrough, Heading1, Heading2, Quote, List,
  ListOrdered, Minus, ImageIcon, BarChart3, UserCircle, Video, LinkIcon,
  Sun, Moon, Send, Save, Type, Sparkles, X, CircleHelp
} from "lucide-react";
import Link from "next/link";
import { wordCount } from "@/lib/utils";

const PLACEHOLDERS = [
  "Start your innings here...",
  "Bowl your first delivery...",
  "Step up to the crease...",
  "Play your opening shot...",
  "Take guard and begin...",
];

const FONT_STYLES = [
  { id: "classic", name: "THE CLASSIC", font: "Georgia, serif", desc: "Clean serif, professional" },
  { id: "correspondent", name: "THE CORRESPONDENT", font: "'Inter', sans-serif", desc: "Modern, authoritative" },
  { id: "storyteller", name: "THE STORYTELLER", font: "'Georgia', serif", desc: "Warm, rounded, personal" },
  { id: "pundit", name: "THE PUNDIT", font: "'Arial Black', sans-serif", desc: "Bold condensed, confident" },
];

const OVERS_MESSAGES = [
  { max: 3, msg: "Just starting your innings" },
  { max: 6, msg: "Building nicely" },
  { max: 10, msg: "Solid innings developing" },
  { max: Infinity, msg: "A proper Test innings" },
];

const EQS_WAIT_STEPS = [
  "Toxicity",
  "Sarcasm & Tone",
  "Factual Accuracy",
  "Bias / Fandom Skew",
  "Originality",
  "Grammar & Readability",
  "Depth of Insight",
  "Hook Quality",
  "Coherence & Structure",
  "Emotional Register",
  "Spam / Low-effort",
  "Archetype Alignment",
] as const;

const EQS_EXPECTED_DURATION_SECONDS = 72;
const EQS_REVEAL_SCHEDULE_SECONDS = [3, 8, 14, 20, 27, 34, 41, 48, 55, 62, 68, 74] as const;
const EQS_SLOW_NOTICE_SECONDS = 85;

const EQS_EXPLAINER =
  "EQS checks how clearly your cricket expression came through. It is not judging whether you sound like a formal columnist. It simply shows where your expression landed well and where you can sharpen it.";

const EQS_TOOLTIP = "EQS tracks clarity, originality, and tone of your cricket expression. It is feedback, not a strict writing exam.";

function WriteBlogPageContent() {
  const searchParams = useSearchParams();
  const linkedMatchId = searchParams.get("matchId");
  const linkedMatchName = searchParams.get("matchName");
  const [activeContests, setActiveContests] = useState<Array<{
    id: string;
    title: string;
    shortBlogMaxWords: number;
    prize?: string | null;
    endDate: string;
  }>>([]);
  const [contestId, setContestId] = useState("");
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionUserRole, setSessionUserRole] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nightMode, setNightMode] = useState(true);
  const [fontStyle, setFontStyle] = useState("correspondent");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [autoSaveMsg, setAutoSaveMsg] = useState("");
  const [generatingTags, setGeneratingTags] = useState(false);
  const [tagError, setTagError] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polishResult, setPolishResult] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [upgradingWriter, setUpgradingWriter] = useState(false);
  const [publishPhase, setPublishPhase] = useState<"idle" | "scoring" | "publishing" | "published">("idle");
  const [publishReviewCollapsed, setPublishReviewCollapsed] = useState(false);
  const [publishEqsReady, setPublishEqsReady] = useState(false);
  const [publishWaitSeconds, setPublishWaitSeconds] = useState(0);
  const [publishRevealCount, setPublishRevealCount] = useState(0);
  const [publishEqsResult, setPublishEqsResult] = useState<{ overallEqs: number; weightedEqs?: number; attributes: Array<{ name: string; score: number; explanation: string; weight?: number }> } | null>(null);
  const [publishedBlog, setPublishedBlog] = useState<{ id: string; slug: string; title: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const generateTags = async () => {
    if (!content.trim()) {
      setTagError("Write some content first so the AI has something to work with.");
      return;
    }

    setGeneratingTags(true);
    setTagError("");
    try {
      const res = await fetch("/api/ai/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTagError(data.error || "Tag generation failed");
        return;
      }
      const existing = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const merged = [...new Set([...existing, ...data.tags])];
      setTags(merged.join(", "));
    } catch {
      setTagError("Could not reach the AI service.");
    } finally {
      setGeneratingTags(false);
    }
  };

  const removeTag = (tagToRemove: string) => {
    const updated = tags.split(",").map((t) => t.trim()).filter((t) => t !== tagToRemove);
    setTags(updated.join(", "));
  };

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  const currentWordCount = wordCount(content);
  const overs = (currentWordCount / 50).toFixed(1);
  const oversProgress = Math.min((currentWordCount / 500) * 100, 100);
  const oversMessage = OVERS_MESSAGES.find((m) => parseFloat(overs) <= m.max)?.msg || "";
  const isValidLength = currentWordCount >= 50 && currentWordCount <= 2000;
  const publishWaitClock = `${String(Math.floor(publishWaitSeconds / 60)).padStart(2, "0")}:${String(publishWaitSeconds % 60).padStart(2, "0")}`;
  const publishWaitOver = `${Math.floor(publishWaitSeconds / 6)}.${publishWaitSeconds % 6}`;
  const publishWaitBallIndex = publishWaitSeconds % 6;
  const publishRevealPercent = Math.round((publishRevealCount / EQS_WAIT_STEPS.length) * 100);
  const publishRevealStep = EQS_WAIT_STEPS[Math.max(0, Math.min(EQS_WAIT_STEPS.length - 1, publishRevealCount - 1))];
  const publishTakingLong = publishPhase === "scoring" && !publishEqsReady && publishWaitSeconds >= EQS_SLOW_NOTICE_SECONDS;
  const publishExpectedProgress = publishEqsReady
    ? 100
    : Math.min(96, Math.round((publishWaitSeconds / EQS_EXPECTED_DURATION_SECONDS) * 96));
  const publishLiveScore = publishEqsResult
    ? Math.round((publishEqsResult.overallEqs * Math.max(1, publishRevealCount)) / EQS_WAIT_STEPS.length)
    : Math.min(96, Math.round(42 + publishExpectedProgress * 0.43 + ((publishWaitSeconds % 6) / 6) * 3));

  // Quality estimate based on word count and structure
  const qualityEstimate = Math.min(100, Math.round(
    (currentWordCount >= 50 ? 40 : (currentWordCount / 50) * 40) +
    (content.includes("\n") ? 15 : 0) +
    (title.length > 10 ? 15 : (title.length / 10) * 15) +
    (tags.length > 0 ? 10 : 0) +
    Math.min(20, (new Set(content.toLowerCase().split(/\s+/))).size / 5)
  ));

  // Stats detected (simple pattern matching)
  const statsDetected = (content.match(/\d+\.?\d*/g) || []).length;

  // Auto save
  const autoSave = useCallback(() => {
    if (content.length > 10) {
      localStorage.setItem("cricgeek-draft", JSON.stringify({ title, content, tags, time: Date.now() }));
      setAutoSaveMsg("🏏 Your innings is saved");
      setTimeout(() => setAutoSaveMsg(""), 2000);
    }
  }, [title, content, tags]);

  useEffect(() => {
    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [autoSave]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPlaceholderIdx((index) => (index + 1) % PLACEHOLDERS.length);
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (publishPhase !== "scoring") return;

    const interval = window.setInterval(() => {
      setPublishWaitSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [publishPhase]);

  useEffect(() => {
    if (publishPhase !== "scoring") return;

    const revealTarget = publishEqsReady
      ? EQS_WAIT_STEPS.length
      : Math.min(
        EQS_WAIT_STEPS.length - 1,
        EQS_REVEAL_SCHEDULE_SECONDS.filter((threshold) => publishWaitSeconds >= threshold).length,
      );

    setPublishRevealCount((current) => (current === revealTarget ? current : revealTarget));
  }, [publishPhase, publishEqsReady, publishWaitSeconds]);

  useEffect(() => {
    async function loadContests() {
      try {
        const res = await fetch("/api/contests?active=true");
        const data = await res.json();
        setActiveContests(data.contests || []);
      } catch {
        setActiveContests([]);
      }
    }

    void loadContests();
  }, []);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        setSessionUserId(data?.user?.id || null);
        setSessionUserRole(data?.user?.role || null);
      } catch {
        setSessionUserId(null);
        setSessionUserRole(null);
      }
    }

    void loadSession();
  }, []);

  useEffect(() => {
    try {
      const draft = localStorage.getItem("cricgeek-draft");
      if (draft) {
        const parsed = JSON.parse(draft);
        if (Date.now() - parsed.time < 86400000) {
          setTitle(parsed.title || "");
          setContent(parsed.content || "");
          setTags(parsed.tags || "");
        }
      }
    } catch {
      // ignore draft restore issues
    }
  }, []);

  const handlePolishWithAi = async () => {
    if (!content.trim()) {
      setError("Add a draft before polishing it.");
      return;
    }

    setPolishing(true);
    setError("");
    try {
      const res = await fetch("/api/ai/paraphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Polishing failed");
      }
      setPolishResult(data.polishedContent || content);
    } catch (err) {
      console.error(err);
      setError("AI polishing is unavailable right now.");
    } finally {
      setPolishing(false);
    }
  };

  const acceptPolishResult = () => {
    if (!polishResult) return;
    setContent(polishResult);
    setPolishResult("");
  };

  const rejectPolishResult = () => {
    setPolishResult("");
  };

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setContent((current) => `${current}${text}`);
      return;
    }

    const start = textarea.selectionStart ?? content.length;
    const end = textarea.selectionEnd ?? content.length;
    const updated = content.slice(0, start) + text + content.slice(end);
    setContent(updated);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + text.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const insertFormatting = (prefix: string, suffix = "") => {
    const textarea = textareaRef.current;
    if (!textarea) {
      insertAtCursor(`${prefix}${suffix}`);
      return;
    }

    const start = textarea.selectionStart ?? content.length;
    const end = textarea.selectionEnd ?? content.length;
    const selected = content.slice(start, end);
    const wrapped = `${prefix}${selected}${suffix}`;
    const updated = content.slice(0, start) + wrapped + content.slice(end);
    setContent(updated);

    requestAnimationFrame(() => {
      textarea.focus();
      if (selected.length > 0) {
        textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
      } else {
        const cursor = start + prefix.length;
        textarea.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPG, PNG, or WEBP image.");
      event.target.value = "";
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setError("Image is too large. Please upload a smaller file.");
      event.target.value = "";
      return;
    }

    setImageUploading(true);
    setError("");
    try {
      const resizedFile = await new Promise<File>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const maxWidth = 1200;
            const scale = Math.min(1, maxWidth / img.width);
            const width = Math.max(320, Math.round(img.width * scale));
            const height = Math.max(240, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) {
              reject(new Error("Canvas unavailable"));
              return;
            }
            context.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error("Image compression failed"));
                return;
              }
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }));
            }, "image/webp", 0.82);
          };
          img.onerror = () => reject(new Error("Image could not be loaded"));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error("Image could not be read"));
        reader.readAsDataURL(file);
      });

      const formData = new FormData();
      formData.append("file", resizedFile);
      const res = await fetch("/api/ai/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Image upload failed");
      }

      insertAtCursor(`\n![image](${data.url})\n`);
    } catch (err) {
      console.error(err);
      setError("Image upload failed.");
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const activateWriterProfile = async () => {
    setUpgradingWriter(true);
    setError("");

    try {
      const res = await fetch("/api/writer/profile", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not activate your writer profile.");
        return;
      }

      setSessionUserRole(data.user?.role || "writer");
      window.dispatchEvent(new Event("auth-change"));
    } catch {
      setError("Could not activate your writer profile.");
    } finally {
      setUpgradingWriter(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isValidLength) {
      setError(`Expression must be at least 50 words. Current: ${currentWordCount} words.`);
      return;
    }

    if (!sessionUserId) {
      setError("__auth__"); // Special signal to show sign-in banner
      return;
    }

    setLoading(true);
    setPublishPhase("scoring");
    setPublishReviewCollapsed(false);
    setPublishWaitSeconds(0);
    setPublishRevealCount(0);
    setPublishEqsReady(false);
    setPublishEqsResult(null);
    setPublishedBlog(null);

    try {
      const eqsResponse = await fetch("/api/ai/eqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });

      let eqsData: Record<string, unknown> = {};
      try {
        eqsData = await eqsResponse.json();
      } catch {
        eqsData = {};
      }

      if (!eqsResponse.ok) {
        console.error("EQS API error", {
          status: eqsResponse.status,
          statusText: eqsResponse.statusText,
          body: eqsData,
        });
        throw new Error((eqsData.error as string) || "EQS scoring failed");
      }

      setPublishEqsResult(eqsData as { overallEqs: number; weightedEqs?: number; attributes: Array<{ name: string; score: number; explanation: string; weight?: number }> });
      setPublishEqsReady(true);
      setPublishRevealCount(EQS_WAIT_STEPS.length);
      setPublishPhase("publishing");

      const publishController = new AbortController();
      const publishTimeout = window.setTimeout(() => publishController.abort("PUBLISH_TIMEOUT"), 30000);
      const res = await fetch("/api/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          tags,
          authorId: sessionUserId,
          matchId: linkedMatchId || null,
          contestId: contestId || null,
        }),
        signal: publishController.signal,
      }).finally(() => {
        window.clearTimeout(publishTimeout);
      });

      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        console.error("Blog creation API error", {
          status: res.status,
          statusText: res.statusText,
          body: data,
          request: {
            title,
            contentLength: content.length,
            tags,
            authorId: sessionUserId,
            matchId: linkedMatchId || null,
            contestId: contestId || null,
          },
        });
        setError((data.error as string) || `Server error (${res.status}). Please try again.`);
        setPublishPhase("idle");
        return;
      }

      const createdBlog = data.blog as { id: string; slug: string; title: string } | undefined;
      if (!createdBlog?.id || !createdBlog?.slug || !createdBlog?.title) {
        console.error("Blog creation response missing expected blog payload", data);
        setError("Expression creation response was incomplete. Please refresh and check your expressions.");
        setPublishPhase("idle");
        return;
      }

      setPublishedBlog({ id: createdBlog.id, slug: createdBlog.slug, title: createdBlog.title });
      setPublishPhase("published");
      try {
        fetch("/api/scoring/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blogId: createdBlog.id }),
        });
      } catch {
        /* scoring is non-blocking */
      }
      localStorage.removeItem("cricgeek-draft");
    } catch (err) {
      console.error("Submit error:", err);
      if ((err instanceof DOMException && err.name === "AbortError") || err === "EQS_TIMEOUT" || err === "PUBLISH_TIMEOUT" || (err instanceof Error && /timeout/i.test(err.message))) {
        setError("Scoring took too long. Please try again or continue editing.");
      } else {
        setError(err instanceof Error ? err.message : "Network error. Check your connection and try again.");
      }
      setPublishPhase("idle");
    } finally {
      setLoading(false);
    }
  };

  const currentFont = FONT_STYLES.find((f) => f.id === fontStyle) || FONT_STYLES[1];

  return (
    <div className={`min-h-screen ${nightMode ? "bg-cg-dark" : "bg-[#FAFAF5]"}`}>
      {publishPhase !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className={`w-full max-w-4xl rounded-3xl border ${nightMode ? "border-gray-800 bg-cg-dark-2" : "border-gray-200 bg-white"} shadow-2xl`}>
            {publishPhase === "scoring" && (
              <div className="rounded-3xl p-6 sm:p-8">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full border border-cg-green/20 bg-black/20">
                    <div className="absolute inset-3 rounded-full border border-dashed border-cg-green/30" />
                    <div className="eqs-ball-orbit absolute h-4 w-4 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.75)]" />
                    <div className="relative text-5xl eqs-batsman-wait">🏏</div>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">Publish review in progress</p>
                    <h2 className={`mt-2 text-2xl font-black ${nightMode ? "text-white" : "text-gray-900"}`}>Scoring your draft before publishing</h2>
                    <p className={`mt-2 text-sm ${nightMode ? "text-gray-400" : "text-gray-600"}`}>The writer cannot edit or double-submit while EQS is running.</p>
                    <p className="mt-2 text-xs font-semibold text-cg-green">Real AI scoring usually takes about a minute. This is expected behavior.</p>
                    {publishTakingLong ? (
                      <p className="mt-2 text-xs font-semibold text-cyan-300">Still evaluating deeply with real AI. Thanks for waiting.</p>
                    ) : null}
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em]">
                      <div className="rounded-lg border border-gray-800 bg-cg-dark-3/70 px-2 py-2 text-cg-green eqs-score-tick">Batting</div>
                      <div className="rounded-lg border border-gray-800 bg-cg-dark-3/70 px-2 py-2 text-cg-green eqs-score-tick [animation-delay:150ms]">Pitch</div>
                      <div className="rounded-lg border border-gray-800 bg-cg-dark-3/70 px-2 py-2 text-cg-green eqs-score-tick [animation-delay:300ms]">Score</div>
                    </div>
                  </div>
                </div>

                <div className={`mt-6 rounded-3xl border ${nightMode ? "border-gray-800 bg-black/25" : "border-gray-200 bg-white/80"} p-4 sm:p-5`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">Cricket waiting clock</p>
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <div className={`text-4xl font-black ${nightMode ? "text-white" : "text-gray-900"}`}>{publishWaitClock}</div>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${nightMode ? "border-cg-green/30 text-cg-green" : "border-cg-green/40 text-cg-green-dark"}`}>
                          Over {publishWaitOver}
                        </div>
                      </div>
                      <p className={`mt-2 text-sm ${nightMode ? "text-gray-400" : "text-gray-600"}`}>A clean, live scoring wait. You can keep watching or tuck this away and check back later.</p>
                    </div>

                    <div className="min-w-[14rem] rounded-2xl border border-cg-green/15 bg-black/20 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                        <span>Ball tracker</span>
                        <span>Ball {publishWaitBallIndex + 1}/6</span>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div
                            key={index}
                            className={`h-3 w-3 rounded-full transition-all duration-300 ${index === publishWaitBallIndex ? "bg-cg-green shadow-[0_0_12px_rgba(34,197,94,0.8)] scale-125" : "bg-gray-700"}`}
                          />
                        ))}
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cg-green via-emerald-400 to-cyan-400 transition-all duration-500"
                          style={{ width: `${Math.min(100, (publishWaitSeconds % 24) * (100 / 24))}%` }}
                        />
                      </div>

                      <div className="mt-3 rounded-xl border border-cg-green/20 bg-black/40 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Live EQS</p>
                        <p className="mt-1 text-3xl font-black text-cg-green">{Math.min(100, publishLiveScore)}</p>
                        <p className="text-[11px] text-gray-400">{publishRevealPercent}% complete</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-cg-green/15 bg-black/30 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cg-green">Live scoring deliveries</p>
                      <p className="text-xs text-gray-400">{publishRevealCount}/{EQS_WAIT_STEPS.length} checks</p>
                    </div>
                    <p className="mb-3 text-sm text-gray-300">
                      {publishRevealCount > 0 ? `Now checking: ${publishRevealStep}` : "Preparing first scoring check..."}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {EQS_WAIT_STEPS.map((step, index) => {
                        const done = index < publishRevealCount;
                        const current = index === publishRevealCount;
                        return (
                          <div
                            key={step}
                            className={`rounded-lg border px-3 py-2 text-xs transition-all ${done
                              ? "border-cg-green/40 bg-cg-green/10 text-cg-green"
                              : current
                                ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-300"
                                : "border-gray-800 bg-black/20 text-gray-500"
                              }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">{step}</span>
                              <span>{done ? "Done" : current ? "Live" : "Waiting"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      <span className="rounded-full border border-gray-800 px-3 py-1">Live scoring</span>
                      <span className="rounded-full border border-gray-800 px-3 py-1">No editing</span>
                      <span className="rounded-full border border-gray-800 px-3 py-1">No double-submit</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPublishReviewCollapsed((current) => !current)}
                        className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:border-gray-500 hover:text-white"
                      >
                        {publishReviewCollapsed ? "Show full animation" : "Skip and come back later"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPublishReviewCollapsed(false)}
                        className="rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black hover:bg-cg-green-dark"
                      >
                        Keep watching
                      </button>
                    </div>
                  </div>
                </div>

                {publishReviewCollapsed && (
                  <div className={`mt-4 rounded-2xl border px-4 py-3 ${nightMode ? "border-gray-800 bg-black/30" : "border-gray-200 bg-white/70"}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cg-green">Come back later</p>
                    <p className={`mt-1 text-sm ${nightMode ? "text-gray-400" : "text-gray-600"}`}>
                      The scoring over is still running in the background. You can leave this view open and return when the result is ready.
                    </p>
                  </div>
                )}
              </div>
            )}

            {publishPhase !== "scoring" && publishEqsResult && (
              <div className="rounded-3xl p-6 sm:p-8">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cg-green">EQS result</p>
                      <h2 className={`mt-2 text-3xl font-black sm:text-5xl ${nightMode ? "text-white" : "text-gray-900"}`}>
                        {publishEqsResult.overallEqs}/100
                      </h2>
                      <p className={`mt-3 max-w-3xl text-sm leading-7 ${nightMode ? "text-gray-300" : "text-gray-600"}`}>
                        {EQS_EXPLAINER}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className={`rounded-full px-4 py-2 text-sm font-semibold ${publishPhase === "published" ? "bg-cg-green/15 text-cg-green" : "bg-yellow-400/15 text-yellow-400"}`}>
                        {publishPhase === "published" ? "Published" : "Publishing..."}
                      </div>
                      <span title={EQS_TOOLTIP} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-300">
                        <CircleHelp size={12} /> True expression
                      </span>
                    </div>
                  </div>

                  <p className={`text-xs ${nightMode ? "text-gray-500" : "text-gray-500"}`}>{EQS_TOOLTIP}</p>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {publishEqsResult.attributes.map((attribute) => (
                      <div key={attribute.name} className={`rounded-2xl border px-4 py-3 ${nightMode ? "border-gray-800 bg-cg-dark-3/60" : "border-gray-200 bg-gray-50"}`}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className={`font-medium ${nightMode ? "text-gray-200" : "text-gray-700"}`}>{attribute.name}</span>
                          <span className="font-semibold text-cg-green">{attribute.score}/100</span>
                        </div>
                        <p className={`mt-1 text-xs ${nightMode ? "text-gray-400" : "text-gray-500"}`}>{attribute.explanation}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className={`text-xs ${nightMode ? "text-gray-500" : "text-gray-500"}`}>
                      {publishPhase === "published"
                        ? "Your expression is live and this score is your confirmation summary."
                        : "Publishing your expression now..."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {publishedBlog ? (
                        <Link href={`/blog/${publishedBlog.slug}`} className="rounded-lg bg-cg-green px-4 py-2 text-sm font-bold text-black hover:bg-cg-green-dark">
                          View expression
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setPublishPhase("idle");
                          setPublishEqsResult(null);
                          setPublishedBlog(null);
                          setLoading(false);
                        }}
                        className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:border-gray-500 hover:text-white"
                      >
                        Continue editing
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={publishPhase !== "idle" ? "pointer-events-none select-none opacity-40" : ""} aria-hidden={publishPhase !== "idle"}>
      {/* Top bar */}
      <div className={`border-b ${nightMode ? "border-gray-800 bg-cg-dark-2" : "border-gray-200 bg-white"} px-4 py-2 flex items-center justify-between`}>
        <Link href="/blog" className={`text-sm flex items-center gap-1 ${nightMode ? "text-gray-400 hover:text-white" : "text-gray-600 hover:text-black"}`}>
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="flex items-center gap-2">
          {autoSaveMsg && (
            <span className="text-xs text-cg-green animate-pulse">{autoSaveMsg}</span>
          )}
          <button onClick={autoSave} className={`p-2 rounded-lg transition-all ${nightMode ? "text-gray-400 hover:text-white hover:bg-gray-800" : "text-gray-500 hover:text-black hover:bg-gray-100"}`} title="Save draft">
            <Save size={16} />
          </button>
          <button onClick={() => setShowFontPicker(!showFontPicker)} className={`p-2 rounded-lg transition-all ${nightMode ? "text-gray-400 hover:text-white hover:bg-gray-800" : "text-gray-500 hover:text-black hover:bg-gray-100"}`} title="Font style">
            <Type size={16} />
          </button>
          <button onClick={() => setNightMode(!nightMode)} className={`p-2 rounded-lg transition-all ${nightMode ? "text-gray-400 hover:text-white hover:bg-gray-800" : "text-gray-500 hover:text-black hover:bg-gray-100"}`}>
            {nightMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      {linkedMatchId && (
        <div className="px-4 pt-4">
          <div className="mx-auto max-w-5xl rounded-xl border border-cg-green/20 bg-cg-green/5 px-4 py-3 text-sm text-cg-green">
            Writing for match coverage:
            {" "}
            <span className="font-semibold text-white">{linkedMatchName || linkedMatchId}</span>
          </div>
        </div>
      )}

      {/* Font picker dropdown */}
      {showFontPicker && (
        <div className={`absolute right-4 top-24 z-50 ${nightMode ? "bg-cg-dark-2 border-gray-800" : "bg-white border-gray-200"} border rounded-xl p-3 shadow-xl w-64`}>
          {FONT_STYLES.map((f) => (
            <button
              key={f.id}
              onClick={() => { setFontStyle(f.id); setShowFontPicker(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                fontStyle === f.id
                  ? "bg-cg-green/10 text-cg-green"
                  : nightMode ? "text-gray-300 hover:bg-gray-800" : "text-gray-700 hover:bg-gray-100"
              }`}
              style={{ fontFamily: f.font }}
            >
              <span className="font-bold text-xs">{f.name}</span>
              <br />
              <span className={`text-[10px] ${nightMode ? "text-gray-500" : "text-gray-400"}`}>{f.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error === "__auth__" && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-amber-400">
                <span>🔐</span>
                <span>You need to be signed in to publish an expression.</span>
              </div>
              <Link
                href="/auth/login?redirect=/blog/write"
                className="bg-cg-green text-black text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-cg-green-dark transition-all whitespace-nowrap"
              >
                Sign In
              </Link>
            </div>
          )}
          {sessionUserId && sessionUserRole === "user" && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-blue-200">Writer access is required to publish.</p>
                <p className="text-blue-100/80">
                  Normal users can react, save, and follow writers. Activate your writer profile to start publishing expressions.
                </p>
              </div>
              <button
                type="button"
                onClick={activateWriterProfile}
                disabled={upgradingWriter}
                className="rounded-lg bg-cg-green px-4 py-2 text-xs font-bold text-black hover:bg-cg-green-dark disabled:opacity-60"
              >
                {upgradingWriter ? "Activating..." : "Become a Writer"}
              </button>
            </div>
          )}
          {error && error !== "__auth__" && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full bg-transparent text-2xl sm:text-3xl font-bold focus:outline-none placeholder-gray-600 ${nightMode ? "text-white" : "text-gray-900"}`}
            placeholder="Your headline..."
            required
            maxLength={100}
            style={{ fontFamily: currentFont.font }}
          />

          {/* Formatting Toolbar */}
          <div className={`flex flex-wrap items-center gap-1 p-2 rounded-xl border ${nightMode ? "bg-cg-dark-2 border-gray-800" : "bg-gray-50 border-gray-200"}`}>
            <span className={`text-[10px] font-bold px-2 ${nightMode ? "text-gray-600" : "text-gray-400"}`}>BATTING ORDER</span>
            <div className="flex gap-0.5">
              <button type="button" onClick={() => insertFormatting("**", "**")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Bold"><Bold size={14} /></button>
              <button type="button" onClick={() => insertFormatting("*", "*")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Italic"><Italic size={14} /></button>
              <button type="button" onClick={() => insertFormatting("~~", "~~")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Strikethrough"><Strikethrough size={14} /></button>
            </div>
            <div className={`w-px h-5 mx-1 ${nightMode ? "bg-gray-700" : "bg-gray-300"}`} />
            <span className={`text-[10px] font-bold px-2 ${nightMode ? "text-gray-600" : "text-gray-400"}`}>FIELD</span>
            <div className="flex gap-0.5">
              <button type="button" onClick={() => insertFormatting("# ")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Heading 1"><Heading1 size={14} /></button>
              <button type="button" onClick={() => insertFormatting("## ")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Heading 2"><Heading2 size={14} /></button>
              <button type="button" onClick={() => insertFormatting("> ")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Quote"><Quote size={14} /></button>
              <button type="button" onClick={() => insertFormatting("- ")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Bullet list"><List size={14} /></button>
              <button type="button" onClick={() => insertFormatting("1. ")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Numbered list"><ListOrdered size={14} /></button>
              <button type="button" onClick={() => insertFormatting("\n---\n")} className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Divider"><Minus size={14} /></button>
            </div>
            <div className={`w-px h-5 mx-1 ${nightMode ? "bg-gray-700" : "bg-gray-300"}`} />
            <span className={`text-[10px] font-bold px-2 ${nightMode ? "text-gray-600" : "text-gray-400"}`}>EXTRAS</span>
            <div className="flex gap-0.5">
              <button type="button" className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Insert image"><ImageIcon size={14} /></button>
              <button type="button" className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Insert stat card"><BarChart3 size={14} /></button>
              <button type="button" className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Insert player card"><UserCircle size={14} /></button>
              <button type="button" className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Insert video"><Video size={14} /></button>
              <button type="button" className={`p-1.5 rounded ${nightMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-600"}`} title="Insert link"><LinkIcon size={14} /></button>
            </div>
          </div>

          {/* Content */}
          <div className={`rounded-2xl border p-3 ${nightMode ? "border-gray-800 bg-cg-dark-2/70" : "border-gray-200 bg-white/80"}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePolishWithAi}
                disabled={polishing || !content.trim()}
                className="rounded-full border border-cg-green/30 bg-cg-green/10 px-3 py-1.5 text-xs font-semibold text-cg-green disabled:opacity-60"
              >
                {polishing ? "Polishing..." : "✨ Polish with AI"}
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={imageUploading}
                className="rounded-full border border-cg-green/30 bg-cg-green/10 px-3 py-1.5 text-xs font-semibold text-cg-green disabled:opacity-60"
              >
                {imageUploading ? "Uploading..." : "🖼️ Add image"}
              </button>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} className="hidden" />
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (polishResult) {
                  setPolishResult("");
                }
              }}
              className={`w-full bg-transparent text-base leading-relaxed focus:outline-none min-h-[350px] resize-y ${nightMode ? "text-gray-200 placeholder-gray-700" : "text-gray-800 placeholder-gray-400"}`}
              placeholder={PLACEHOLDERS[placeholderIdx]}
              required
              style={{ fontFamily: currentFont.font }}
            />
          </div>

          {polishResult && polishResult !== content && (
            <div className={`rounded-2xl border p-4 ${nightMode ? "border-gray-800 bg-cg-dark-2/70" : "border-gray-200 bg-white/90"}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className={`text-sm font-semibold ${nightMode ? "text-white" : "text-gray-900"}`}>AI polish preview</p>
                  <p className={`text-xs ${nightMode ? "text-gray-400" : "text-gray-500"}`}>Review the rewrite before replacing your current draft.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={rejectPolishResult} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-gray-500 hover:text-white">
                    Reject
                  </button>
                  <button type="button" onClick={acceptPolishResult} className="rounded-lg bg-cg-green px-3 py-1.5 text-xs font-semibold text-black hover:bg-cg-green-dark">
                    Use this version
                  </button>
                </div>
              </div>
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${nightMode ? "text-gray-400" : "text-gray-600"}`}>{polishResult}</p>
            </div>
          )}

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-sm font-medium ${nightMode ? "text-gray-300" : "text-gray-600"}`}>
                Tags
              </label>
              <button
                type="button"
                onClick={generateTags}
                disabled={generatingTags}
                className="flex items-center gap-1.5 text-xs font-medium text-cg-green hover:text-cg-green-dark disabled:opacity-50 transition-all"
                title="Generate tags with local Llama AI"
              >
                {generatingTags ? (
                  <><span className="w-3 h-3 border border-cg-green/50 border-t-cg-green rounded-full animate-spin" />Generating...</>
                ) : (
                  <><Sparkles size={12} />AI Generate</>  
                )}
              </button>
            </div>

            {/* Tag chips */}
            {tagList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tagList.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 bg-cg-green/10 text-cg-green border border-cg-green/20 text-xs px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-cg-green/60 hover:text-cg-green ml-0.5 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              type="text"
              value={tags}
              onChange={(e) => { setTags(e.target.value); setTagError(""); }}
              className={`w-full bg-transparent border rounded-lg px-4 py-2.5 text-sm focus:border-cg-green focus:outline-none ${
                nightMode ? "border-gray-800 text-white" : "border-gray-300 text-gray-800"
              }`}
              placeholder="e.g., analysis, ipl, india — or click AI Generate ✨"
            />

            {tagError && (
              <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                ⚠️ {tagError}
                {tagError.includes("ollama") || tagError.includes("connect") ? (
                  <span className="text-gray-500 ml-1">(Run <code className="text-gray-400">ollama serve</code> in a terminal)</span>
                ) : null}
              </p>
            )}
          </div>

          {activeContests.length > 0 && (
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${nightMode ? "text-gray-300" : "text-gray-600"}`}>
                Contest Submission
              </label>
              <select
                value={contestId}
                onChange={(event) => setContestId(event.target.value)}
                className={`w-full rounded-lg border bg-transparent px-4 py-2.5 text-sm focus:border-cg-green focus:outline-none ${
                  nightMode ? "border-gray-800 text-white" : "border-gray-300 text-gray-800"
                }`}
              >
                <option value="">Regular expression</option>
                {activeContests.map((contest) => (
                  <option key={contest.id} value={contest.id} className="bg-cg-dark text-white">
                    {contest.title} · max {contest.shortBlogMaxWords} words
                  </option>
                ))}
              </select>
              {contestId && (
                <p className="mt-1.5 text-xs text-cg-green">
                  Short-expression contest selected. Keep this entry within the contest word cap for ranking.
                </p>
              )}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || (sessionUserId !== null && sessionUserRole === "user")}
            className="w-full bg-cg-green text-black py-3 rounded-xl font-bold text-sm hover:bg-cg-green-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Send size={16} />
            {loading
              ? publishPhase === "scoring"
                ? "Scoring draft..."
                : publishPhase === "publishing"
                  ? "Publishing..."
                  : "Working..."
              : sessionUserRole === "user"
                ? "Activate Writer Profile to Publish"
                : "Deliver the Ball"}
          </button>
          {!isValidLength && currentWordCount > 0 && (
            <p className={`text-center text-xs ${currentWordCount < 50 ? "text-amber-400" : "text-red-400"}`}>
              {currentWordCount < 50
                ? `${50 - currentWordCount} more words needed (minimum 50)`
                : `${currentWordCount - 2000} words over the 2000-word limit`}
            </p>
          )}
        </form>
      </div>

      {/* Writing Metrics Bar — fixed bottom */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${nightMode ? "bg-cg-dark-2/95 border-gray-800" : "bg-white/95 border-gray-200"} backdrop-blur-sm z-40`}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4">
            <span className={nightMode ? "text-gray-400" : "text-gray-600"}>
              📝 <span className="font-medium">{currentWordCount}</span> words
            </span>
            <span className={nightMode ? "text-gray-400" : "text-gray-600"}>
              Overs: <span className="font-bold text-cg-green">{overs}</span>
            </span>
            <span className={`hidden sm:inline ${nightMode ? "text-gray-500" : "text-gray-400"}`}>
              {oversMessage}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className={nightMode ? "text-gray-400" : "text-gray-600"}>
              📊 Stats: <span className="font-medium">{statsDetected}</span>
            </span>
            <span className={nightMode ? "text-gray-400" : "text-gray-600"}>
              🎯 Quality: <span className={`font-bold ${qualityEstimate >= 70 ? "text-cg-green" : qualityEstimate >= 40 ? "text-yellow-400" : "text-red-400"}`}>{qualityEstimate}/100</span>
            </span>
          </div>
        </div>
        {/* Over counter bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-gradient-to-r from-cg-green to-cg-green-light transition-all duration-300"
            style={{ width: `${oversProgress}%` }}
          />
        </div>
      </div>

      </div>
    </div>
  );
}

function WriteBlogPageFallback() {
  return (
    <div className="min-h-screen bg-cg-dark-1 text-white px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-4 animate-pulse">
        <div className="h-10 w-1/3 rounded bg-cg-dark-2" />
        <div className="h-12 w-full rounded bg-cg-dark-2" />
        <div className="h-80 w-full rounded bg-cg-dark-2" />
      </div>
    </div>
  );
}

export default function WriteBlogPage() {
  return (
    <Suspense fallback={<WriteBlogPageFallback />}>
      <WriteBlogPageContent />
    </Suspense>
  );
}
