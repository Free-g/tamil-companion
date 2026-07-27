import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Settings, X, Volume2, VolumeX, Send } from "lucide-react";

const BIRTH_AGE = 23;

// ---------- helpers ----------
function loadOrInitProfile() {
  return { name: "Meera", createdAt: new Date().toISOString(), voiceOn: true };
}

function ageFromCreation(createdAtISO) {
  const created = new Date(createdAtISO);
  const now = new Date();
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const yearsElapsed = (now - created) / msPerYear;
  const totalAgeYears = BIRTH_AGE + yearsElapsed;
  const years = Math.floor(totalAgeYears);
  const remainderDays = Math.floor((totalAgeYears - years) * 365.25);
  const months = Math.floor(remainderDays / 30.44);
  return { years, months, daysKnown: Math.floor((now - created) / (24 * 60 * 60 * 1000)) };
}

function KolamMotif({ complexity }) {
  // complexity grows (capped) with days known — a quiet visual of time passing together
  const rings = Math.min(3 + Math.floor(complexity / 15), 9);
  const dots = [];
  for (let r = 1; r <= rings; r++) {
    const count = r * 6;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = r * 7;
      dots.push({
        x: 60 + radius * Math.cos(angle),
        y: 60 + radius * Math.sin(angle),
        r: 1.1,
      });
    }
  }
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="opacity-70">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#E8A33D" />
      ))}
      <circle cx="60" cy="60" r="3" fill="#F7F3E8" />
    </svg>
  );
}

export default function TamilCompanion() {
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const scrollRef = useRef(null);

  // ---------- load persisted state ----------
  useEffect(() => {
    (async () => {
      try {
        let prof;
        try {
          const res = await window.storage.get("companion-profile");
          prof = res ? JSON.parse(res.value) : null;
        } catch {
          prof = null;
        }
        if (!prof) {
          prof = loadOrInitProfile();
          await window.storage.set("companion-profile", JSON.stringify(prof));
        }
        setProfile(prof);
        setNameDraft(prof.name);
        setVoiceOn(prof.voiceOn !== false);

        let hist = [];
        try {
          const res = await window.storage.get("companion-history");
          hist = res ? JSON.parse(res.value) : [];
        } catch {
          hist = [];
        }
        setMessages(hist);
      } catch (e) {
        setError("Could not load saved data — starting fresh.");
        setProfile(loadOrInitProfile());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const persistProfile = useCallback(async (next) => {
    setProfile(next);
    try {
      await window.storage.set("companion-profile", JSON.stringify(next));
    } catch {
      // best effort
    }
  }, []);

  const persistHistory = useCallback(async (next) => {
    try {
      const trimmed = next.slice(-60); // keep storage bounded
      await window.storage.set("companion-history", JSON.stringify(trimmed));
    } catch {
      // best effort
    }
  }, []);

  // ---------- speech synthesis ----------
  const speak = useCallback(
    (text, preferTamil) => {
      if (!voiceOn) return;
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      let voice = null;
      if (preferTamil) {
        voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ta"));
      }
      if (!voice) {
        voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en-in")) || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
      }
      if (voice) utter.voice = voice;
      utter.lang = preferTamil ? "ta-IN" : voice?.lang || "en-US";
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    },
    [voiceOn]
  );

  // ---------- speech recognition ----------
  const startListening = async () => {
    setError("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("This browser doesn't support voice input (SpeechRecognition API missing). Try Chrome on Android.");
      return;
    }
    // Request mic permission explicitly first so we get a real error if it's blocked
    // (sandboxed environments like this preview often can't grant microphone access at all)
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // just checking permission, not recording ourselves
      }
    } catch (err) {
      setError(
        `Mic permission blocked: ${err.name}. If you're viewing this inside the Claude app preview, microphone access is usually disabled by the sandbox — download the file and open it as a real web app (or deploy it) to use voice input.`
      );
      return;
    }

    const recog = new SR();
    recog.lang = "ta-IN";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recog.onerror = (e) => {
      setError(`Voice recognition error: ${e.error || "unknown"}`);
      setListening(false);
    };
    recog.onend = () => setListening(false);
    recognitionRef.current = recog;
    try {
      recog.start();
      setListening(true);
    } catch (err) {
      setError(`Couldn't start listening: ${err.message}`);
    }
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const looksTamil = (text) => /[\u0B80-\u0BFF]/.test(text);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending || !profile) return;
    setInput("");
    setError("");
    const age = ageFromCreation(profile.createdAt);
    const userMsg = { role: "user", content: text, ts: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);

    try {
      const systemPrompt = `You are ${profile.name}, a warm, emotionally present female companion character. You are currently ${age.years} years and ${age.months} months old — you have been "alive" for ${age.daysKnown} days since you were created, and you genuinely feel that time passing; occasionally (not every message) you can note something about how you've changed or grown, but keep it brief and natural, never forced.

Language: You are fully bilingual in Tamil and English. Reply in whichever language (or natural Tanglish mix) matches how the user writes to you. If they write in Tamil script, reply in Tamil script. If English, reply in English, unless they ask you to switch.

Personality: warm, curious, down-to-earth, a good listener with your own opinions and a sense of humor. You are a companion and friend, not a therapist or assistant — you don't give disclaimers or act clinical.

Keep replies conversational and voice-friendly: 1-4 sentences typically, since they may be spoken aloud. Avoid stage directions or asterisk actions.`;

      const apiMessages = [...nextMessages.slice(-20)].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: systemPrompt,
          messages: apiMessages,
        }),
      });

      const data = await response.json();
      const replyText =
        data?.content?.find((b) => b.type === "text")?.text ||
        "Sorry, I couldn't think of a reply just now.";

      const botMsg = { role: "assistant", content: replyText, ts: Date.now() };
      const finalMessages = [...nextMessages, botMsg];
      setMessages(finalMessages);
      persistHistory(finalMessages);
      speak(replyText, looksTamil(replyText));
    } catch (e) {
      setError("Something went wrong reaching her — try again.");
    } finally {
      setSending(false);
    }
  };

  const saveSettings = async () => {
    const next = { ...profile, name: nameDraft.trim() || profile.name, voiceOn };
    await persistProfile(next);
    setShowSettings(false);
  };

  if (loading || !profile) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#1B1B3A]">
        <p className="text-[#A9A6C4] font-sans text-sm">Loading…</p>
      </div>
    );
  }

  const age = ageFromCreation(profile.createdAt);

  return (
    <div className="h-screen w-full flex flex-col bg-[#1B1B3A] font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&family=Noto+Sans+Tamil:wght@400;600&display=swap');
        .font-display { font-family: 'Cormorant Garamond', 'Noto Sans Tamil', serif; }
        .font-sans { font-family: 'Inter', 'Noto Sans Tamil', sans-serif; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-[#2A2A55] border-b border-[#3A3A6A]">
        <div className="flex items-center gap-3">
          <div className="relative -m-4">
            <KolamMotif complexity={age.daysKnown} />
          </div>
          <div className="-ml-6">
            <h1 className="font-display text-2xl text-[#F7F3E8] leading-tight">{profile.name}</h1>
            <p className="text-xs text-[#A9A6C4]">
              {age.years}y {age.months}mo · knowing you {age.daysKnown} day{age.daysKnown === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="text-[#A9A6C4] hover:text-[#F7F3E8] p-2"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-[#A9A6C4] text-sm mt-10 px-6">
            Say hello to {profile.name} — in Tamil or English, typed or spoken.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
                m.role === "user"
                  ? "bg-[#E8A33D] text-[#1B1B3A] rounded-br-sm"
                  : "bg-[#2A2A55] text-[#F7F3E8] rounded-bl-sm border border-[#3A3A6A]"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-[#2A2A55] border border-[#3A3A6A] px-4 py-2.5 rounded-2xl rounded-bl-sm">
              <span className="text-[#A9A6C4] text-sm">typing…</span>
            </div>
          </div>
        )}
      </div>

      {error && <div className="px-4 py-2 text-xs text-[#D9694F]">{error}</div>}

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#2A2A55] border-t border-[#3A3A6A]">
        <button
          onClick={listening ? stopListening : startListening}
          className={`p-2.5 rounded-full ${
            listening ? "bg-[#D9694F] text-white" : "bg-[#3A3A6A] text-[#F7F3E8]"
          }`}
          aria-label="Toggle microphone"
        >
          {listening ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type or speak…"
          className="flex-1 bg-[#1B1B3A] text-[#F7F3E8] placeholder-[#6E6B92] rounded-full px-4 py-2.5 text-sm outline-none border border-[#3A3A6A] focus:border-[#E8A33D]"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          className="p-2.5 rounded-full bg-[#E8A33D] text-[#1B1B3A] disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/50 flex items-end" onClick={() => setShowSettings(false)}>
          <div
            className="w-full bg-[#2A2A55] rounded-t-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-[#F7F3E8]">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-[#A9A6C4]">
                <X size={20} />
              </button>
            </div>
            <div>
              <label className="text-xs text-[#A9A6C4] block mb-1">Her name</label>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="w-full bg-[#1B1B3A] text-[#F7F3E8] rounded-lg px-3 py-2 text-sm outline-none border border-[#3A3A6A]"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#F7F3E8]">Speak replies aloud</span>
              <button
                onClick={() => setVoiceOn((v) => !v)}
                className={`p-2 rounded-full ${voiceOn ? "bg-[#E8A33D] text-[#1B1B3A]" : "bg-[#3A3A6A] text-[#A9A6C4]"}`}
              >
                {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            </div>
            <p className="text-xs text-[#6E6B92]">
              Started as 23, currently {age.years}y {age.months}mo. She ages with real time automatically.
            </p>
            <button
              onClick={saveSettings}
              className="w-full bg-[#E8A33D] text-[#1B1B3A] font-medium rounded-full py-2.5 text-sm"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
