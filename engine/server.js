/*
 * CortesAI · Motor local (Node.js)
 * ------------------------------------------------------------
 * Corre en tu Mac y hace el trabajo pesado que el panel UXP no puede:
 *   1) FFmpeg extrae el audio del video (cualquier tamaño/formato)
 *   2) Groq transcribe el audio (Whisper)
 *   3) Groq analiza y calcula los cortes (LLM)
 * El panel de Premiere se conecta a http://localhost:8765
 *
 * Requisitos: Node.js 18+  y  FFmpeg instalados.
 * Arranque:   node server.js   (o doble clic en start-mac.command)
 */

const http = require("http");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 8765;
const VIDEO_EXT = ["mp4","mov","m4v","avi","mkv","mxf","mts","wmv","webm","flv"];
const GROQ = "https://api.groq.com/openai/v1";
const MODEL_STT = "whisper-large-v3-turbo";
const MODEL_LLM = "openai/gpt-oss-120b";   // modelo grande de Groq (gratis) → mejor selección

// ---- Visión IA (Gemini) ----
// Analiza fotogramas del video para elegir el mejor momento visual (videos sin diálogo).
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_VISION = "gemini-flash-lite-latest";   // respaldo: lite = más cuota diaria y por minuto
const VISION_FRAMES_DEFAULT = 5;                   // fotogramas analizados por video (calidad vs. cuota)

// El nombre exacto del modelo cambia con el tiempo (2.5, 3, etc.). En vez de
// hardcodearlo, preguntamos a la cuenta del usuario qué modelos tiene y elegimos
// el mejor de visión disponible. Se resuelve una vez y se guarda en caché.
let RESOLVED_VISION_MODEL = null;
async function resolveVisionModel(key) {
  if (RESOLVED_VISION_MODEL) return RESOLVED_VISION_MODEL;
  try {
    const r = await fetch(GEMINI + "?key=" + encodeURIComponent(key) + "&pageSize=200");
    if (r.ok) {
      const data = await r.json();
      const models = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => (m.name || "").replace(/^models\//, ""));
      // Orden de preferencia: "lite" primero (mucha más cuota diaria/min, calidad de visión casi igual
      // para elegir frames); si no hay lite, cae a los flash completos.
      const prefer = ["gemini-flash-lite-latest", "gemini-3-flash-lite", "gemini-2.5-flash-lite",
                      "gemini-flash-latest", "gemini-3-flash", "gemini-2.5-flash"];
      for (const p of prefer) if (models.includes(p)) { RESOLVED_VISION_MODEL = p; break; }
      // Si ninguno coincide exacto, cualquier "flash" apto para visión (evita thinking/audio/tts/image-gen).
      if (!RESOLVED_VISION_MODEL) {
        const flash = models.find(m => /flash/.test(m) && !/(thinking|audio|tts|image|embedding|live)/.test(m));
        if (flash) RESOLVED_VISION_MODEL = flash;
      }
      if (RESOLVED_VISION_MODEL) { console.log("  🔎 Visión IA · modelo elegido: " + RESOLVED_VISION_MODEL); return RESOLVED_VISION_MODEL; }
      console.log("  ⚠️  No hallé modelo de visión en la lista; uso respaldo " + MODEL_VISION);
    } else {
      console.log("  ⚠️  ListModels " + r.status + "; uso respaldo " + MODEL_VISION);
    }
  } catch (e) { /* sin lista → respaldo */ }
  RESOLVED_VISION_MODEL = MODEL_VISION;   // respaldo alias
  return RESOLVED_VISION_MODEL;
}

// Marca de "límite diario alcanzado" para poder avisar y caer al método normal.
class QuotaError extends Error { constructor(m){ super(m); this.name = "QuotaError"; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Localizar FFmpeg ----
function findFfmpeg() {
  const cands = ["ffmpeg","/opt/homebrew/bin/ffmpeg","/usr/local/bin/ffmpeg","/usr/bin/ffmpeg",
                 "C:\\ffmpeg\\bin\\ffmpeg.exe","ffmpeg.exe"];
  for (const c of cands) {
    try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch (e) {}
  }
  return null;
}
const FFMPEG = findFfmpeg();

// ---- Extraer audio (mono 16kHz mp3, pequeño) ----
function extractAudio(input, output) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error("FFmpeg no está instalado. Instálalo con: brew install ffmpeg"));
    const args = ["-y","-i",input,"-vn","-ac","1","-ar","16000","-b:a","64k",output];
    const p = spawn(FFMPEG, args);
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg falló: " + err.slice(-400))));
  });
}

// ---- Groq: transcripción ----
async function transcribe(audioPath, apiKey, lang) {
  const buf = fs.readFileSync(audioPath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), path.basename(audioPath));
  fd.append("model", MODEL_STT);
  fd.append("response_format", "verbose_json");
  if (lang && lang !== "auto") fd.append("language", lang);
  const r = await fetch(GROQ + "/audio/transcriptions", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey }, body: fd
  });
  if (!r.ok) throw new Error("Transcripción " + r.status + ": " + (await r.text()).slice(0,300));
  return await r.json();
}

// ---- Groq: análisis (cortes) ----
async function analyze(tr, profile, settings, apiKey) {
  const p = profile || {};
  const dur = settings.duration === "auto"
    ? "libre, solo lo mejor"
    : (settings.duration + (String(settings.duration).includes(":") ? "" : " segundos"));
  const sys = [
    "Eres un editor de video experto. Analiza de forma MULTIMODAL, CONTEXTUAL y ORIENTADA AL OBJETIVO: combina lo que se DICE (transcripción), CÓMO se dice (tono, énfasis, emoción, pausas) y —cuando esté disponible— lo que se VE, para elegir los fragmentos más relevantes de ESTE video y construir una edición coherente, dinámica y atractiva.",
    "1) TIPO Y OBJETIVO: este video es de tipo '" + (p.label || settings.videoType) + "'. Adapta el criterio de relevancia a ese objetivo (NO uses el mismo criterio para todos los tipos). Criterio del perfil: " + (p.scoringPrompt || "prioriza lo más relevante e interesante.") + (p.keep ? (" Prioriza: " + p.keep.join(", ") + ".") : "") + (p.remove ? (" Evita: " + p.remove.join(", ") + ".") : ""),
    "2) AUDIO/TEXTO: identifica frases importantes, información nueva, cambios de tono, énfasis, emoción, preguntas y respuestas, picos de energía. Descarta silencios, muletillas, repeticiones, errores y relleno.",
    "3) FUNCIÓN: cada corte debe tener una función concreta hacia el objetivo. No conserves un segmento solo porque suene interesante; determina qué aporta y cómo se conecta con lo demás.",
    "4) DURACIÓN: cada corte entre 2 y 6 segundos (2-3s si dice/muestra algo puntual y relevante; NUNCA más de 6s).",
    "5) PUNTOS DE CORTE naturales y precisos: no cortes a mitad de palabra, frase, idea, gesto o acción; usa pausas naturales y finales de frase.",
    "6) SÉ EXIGENTE pero NO descartes el habla con contenido: si la persona DICE algo con sentido (una frase, una idea, una emoción), elige al menos ese mejor momento hablado. Solo devuelve vacío si de verdad no hay NADA aprovechable ni dicho ni mostrado.",
    (p.respectSentences ? "Respeta frases completas; no cortes ideas a la mitad." : ""),
    p.structure ? ("Asigna a cada corte un rol según la estructura " + p.structure + ": hook (atención inmediata), gancho (curiosidad/promesa), cuerpo (desarrollo/contenido), cta (cierre/acción).") : "",
    "7) PUNTÚA cada corte de 0 a 1 evaluando: relevancia para el objetivo, relevancia del audio/texto, impacto/retención, energía/ritmo y calidad técnica. En 'reason' explica breve por qué se conserva.",
    "Devuelve SOLO JSON: { \"cuts\": [ { \"start\": number_seg, \"end\": number_seg, \"role\": \"hook|gancho|cuerpo|cta\", \"score\": number_0a1, \"reason\": \"breve\" } ], \"notes\": \"breve\" }. Los start/end deben caer dentro de la transcripción."
  ].filter(Boolean).join("\n");
  const user = "Transcripción (segmentos, tiempos en segundos):\n" +
    (tr.segments || []).map(x => "[" + x.start.toFixed(1) + "-" + x.end.toFixed(1) + "] " + (x.text||"").trim()).join("\n");
  const r = await fetch(GROQ + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_LLM, temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [ { role: "system", content: sys }, { role: "user", content: user } ]
    })
  });
  if (!r.ok) throw new Error("Análisis " + r.status + ": " + (await r.text()).slice(0,300));
  const data = await r.json();
  let out; try { out = JSON.parse(data.choices[0].message.content); } catch (e) { out = { cuts: [], notes: "(respuesta no-JSON)" }; }
  out.cuts = (out.cuts || []).filter(c => typeof c.start === "number" && typeof c.end === "number" && c.end > c.start);
  return out;
}

// ---- Procesar una carpeta (por ahora: el primer video válido) ----
function isRealVideo(name) {
  if (name.startsWith(".")) return false;          // ignora ocultos y AppleDouble "._"
  return VIDEO_EXT.includes(name.split(".").pop().toLowerCase());
}
// Duración objetivo en segundos (soporta "60", "1:30", "25-35", "auto")
function targetSeconds(duration) {
  if (!duration || duration === "auto") return Infinity;
  let d = String(duration).trim();
  if (d.includes("-")) d = d.split("-").pop().trim();           // rango: usa el máximo
  if (d.includes(":")) { const [m, s] = d.split(":"); return (parseInt(m)||0)*60 + (parseInt(s)||0); }
  const n = parseFloat(d); return isNaN(n) ? Infinity : n;
}

// Ensambla el montaje: cada corte 2-6s (solo lo relevante), SIN repetir clips, estructura, dentro de la duración
const MINCUT = 2, MAXCUT = 6;
function assembleMontage(perClip, settings) {
  const target = targetSeconds(settings.duration);

  // 1) Normaliza cada candidato a 4-6s dentro de los límites de su clip
  let all = [];
  perClip.forEach(r => {
    const clipDur = r.duration || 0;
    (r.cuts || []).forEach(c => {
      let start = Math.max(0, c.start || 0);
      let end = c.end || 0;
      if (end - start > MAXCUT) end = start + MAXCUT;                 // recorta lo largo a 6s
      if (end - start < MINCUT) {                                     // extiende lo corto a 4s
        end = start + MINCUT;
        if (clipDur && end > clipDur) { end = clipDur; start = Math.max(0, clipDur - MINCUT); }
      }
      // El diálogo (audio) pesa más que una toma visual genérica
      let score = c.score || 0;
      if (c.source === "audio") score = Math.min(1, score + 0.15);
      if (end - start >= 1) all.push(Object.assign({}, c, { clip: r.video, start: +start.toFixed(2), end: +end.toFixed(2), score: score }));
    });
  });
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const len = (c) => c.end - c.start;

  const bestHook = all.find(c => c.role === "hook") || null;
  const bestCta  = all.find(c => c.role === "cta")  || null;
  const ctaLen   = bestCta ? len(bestCta) : 0;

  // 2) Selección en 2 pasadas: primero variedad (1 por video), luego RELLENA hasta la duración objetivo.
  const MIN_SCORE = 0.28;   // compuerta suave
  const MAX_PER_CLIP = 3;   // hasta 3 momentos DISTINTOS del mismo video si hacen falta para llenar
  const perClipCount = {}, chosen = []; let total = 0;
  const overlaps = (c) => chosen.some(x => x.clip === c.clip && !(c.end <= x.start || c.start >= x.end));
  const tryAdd = (c, role, reserve) => {
    if (!c) return false;
    if (overlaps(c)) return false;                                  // no encimar segmentos del mismo video
    if ((perClipCount[c.clip] || 0) >= MAX_PER_CLIP) return false;
    if (chosen.length && (total + len(c) + (reserve || 0)) > target) return false;
    perClipCount[c.clip] = (perClipCount[c.clip] || 0) + 1;
    chosen.push(Object.assign({}, c, { role: role }));
    total += len(c);
    return true;
  };

  tryAdd(bestHook, "hook", ctaLen);                 // hook al inicio
  // Pasada 1: lo mejor de CADA video (variedad)
  const usedOnce = {};
  for (const c of all) {
    if (c === bestHook || c === bestCta || usedOnce[c.clip]) continue;
    if ((c.score || 0) < MIN_SCORE) continue;
    if (tryAdd(c, "cuerpo", ctaLen)) usedOnce[c.clip] = true;
  }
  // Pasada 2: rellena hasta la duración objetivo con los siguientes mejores (distintos, sin encimar)
  for (const c of all) {
    if (total >= (target - ctaLen)) break;
    if (c === bestHook || c === bestCta) continue;
    if ((c.score || 0) < MIN_SCORE) continue;
    tryAdd(c, "cuerpo", ctaLen);
  }
  tryAdd(bestCta, "cta", 0);                        // cta al final

  return { cuts: chosen, totalDuration: total, target: (target === Infinity ? null : target) };
}

// ---- PASE DIRECTOR: una IA mira TODOS los candidatos y arma el montaje final ----
// A diferencia del ensamblaje mecánico, razona globalmente (gancho, variedad, ritmo, cierre).
async function directorPass(perClip, settings, profile, apiKey) {
  const target = targetSeconds(settings.duration);

  // 1) Pool de candidatos normalizados a 2-6s (igual criterio que assembleMontage)
  let pool = [];
  perClip.forEach(r => {
    const clipDur = r.duration || 0;
    (r.cuts || []).forEach(c => {
      let start = Math.max(0, c.start || 0), end = c.end || 0;
      if (end - start > MAXCUT) end = start + MAXCUT;
      if (end - start < MINCUT) { end = start + MINCUT; if (clipDur && end > clipDur) { end = clipDur; start = Math.max(0, clipDur - MINCUT); } }
      if (end - start >= 1) pool.push({ clip: r.video, start: +start.toFixed(2), end: +end.toFixed(2),
        role: c.role || "cuerpo", score: c.score || 0, source: c.source || "visual", reason: c.reason || "" });
    });
  });
  if (!pool.length) return null;
  pool.sort((a, b) => (b.score || 0) - (a.score || 0));
  pool = pool.slice(0, 80);                 // tope para el prompt
  pool.forEach((c, i) => { c.id = i; });

  // 2) Prompt de DIRECTOR
  const p = profile || {};
  const targetTxt = target === Infinity ? "libre (solo lo mejor, ~30-60s)" : (target + " segundos");
  const sys = [
    "Eres el DIRECTOR de una edición de video. Recibes CLIPS CANDIDATOS (fragmentos ya recortados de varios videos) con lo que se dice/ve, duración, rol tentativo y puntuación.",
    "Tu trabajo: ARMAR EL MONTAJE FINAL seleccionando y ORDENANDO los mejores candidatos para un video tipo '" + (p.label || settings.videoType) + "'.",
    "Objetivo del perfil: " + (p.scoringPrompt || "máximo impacto y retención."),
    p.structure ? ("Estructura " + p.structure + ": abre con un HOOK potente, desarrolla el CUERPO con variedad y cierra con CTA.") : "Abre fuerte, desarrolla con variedad y cierra bien.",
    "REGLAS: (1) duración total cercana a " + targetTxt + "; (2) el primer clip debe ser el mejor gancho; (3) evita redundancia y clips repetitivos; (4) prioriza variedad entre videos fuente distintos; (5) descarta relleno débil aunque sobre espacio; (6) ordena para que fluya con ritmo.",
    "Devuelve SOLO JSON: { \"cuts\": [ { \"id\": number, \"role\": \"hook|gancho|cuerpo|cta\" } ], \"notes\": \"breve\" }. Usa los id EXACTOS de la lista; el orden del arreglo ES el orden final del montaje."
  ].join("\n");
  const user = "CANDIDATOS:\n" + pool.map(c =>
    "id=" + c.id + " | " + c.clip + " | " + (c.end - c.start).toFixed(1) + "s | rol:" + c.role +
    " | " + c.source + " | score:" + (c.score || 0).toFixed(2) + " | " + (c.reason || "").slice(0, 90)
  ).join("\n");

  const r = await fetch(GROQ + "/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL_LLM, temperature: 0.3, response_format: { type: "json_object" },
      messages: [ { role: "system", content: sys }, { role: "user", content: user } ] })
  });
  if (!r.ok) throw new Error("Director " + r.status + ": " + (await r.text()).slice(0, 200));
  const data = await r.json();
  let out; try { out = JSON.parse(data.choices[0].message.content); } catch (e) { return null; }

  // 3) Reconstruye el montaje final desde los id elegidos (en su orden)
  const chosen = []; let total = 0;
  (out.cuts || []).forEach(sel => {
    const c = pool[sel.id];
    if (!c) return;
    if (chosen.some(x => x.clip === c.clip && x.start === c.start && x.end === c.end)) return;   // sin duplicados
    chosen.push(Object.assign({}, c, { role: sel.role || c.role }));
    total += (c.end - c.start);
  });
  if (!chosen.length) return null;
  return { cuts: chosen, totalDuration: +total.toFixed(2), target: (target === Infinity ? null : target),
           director: true, notes: out.notes || "" };
}

// ---- Análisis VISUAL (para video sin diálogo: anuncios, b-roll) ----
// Detecta cambios de escena con FFmpeg y devuelve tiempos + duración total.
function detectScenes(input) {
  return new Promise((resolve) => {
    if (!FFMPEG) return resolve({ times: [], duration: 0 });
    const args = ["-i", input, "-filter:v", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"];
    const p = spawn(FFMPEG, args);
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); });
    p.on("error", () => resolve({ times: [], duration: 0 }));
    p.on("close", () => {
      const times = [];
      const re = /pts_time:([0-9.]+)/g; let m;
      while ((m = re.exec(err))) times.push(parseFloat(m[1]));
      let dur = 0;
      const dm = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
      if (dm) dur = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]);
      resolve({ times, duration: dur });
    });
  });
}
// Convierte los cambios de escena en tomas (shots). Si no hay escenas, trocea.
function scenesToShots(times, duration, profile) {
  const maxC = (profile && profile.maxClip) ? profile.maxClip : 6;
  const clean = times.filter(t => t > 0.2 && t < duration).sort((a, b) => a - b);
  const bounds = [0].concat(clean).concat([duration]);
  let shots = [];
  for (let i = 0; i < bounds.length - 1; i++) shots.push({ start: bounds[i], end: bounds[i + 1] });
  if (shots.length <= 1 && duration > 0) {   // sin cambios de escena → trocear en tomas
    shots = [];
    for (let t = 0; t < duration; t += maxC) shots.push({ start: t, end: Math.min(t + maxC, duration) });
  }
  return shots;
}
// Puntúa las tomas y las recorta a la duración ideal del perfil.
function shotCandidates(shots, profile) {
  const minC = (profile && profile.minClip) ? profile.minClip : 1;
  const maxC = (profile && profile.maxClip) ? profile.maxClip : 6;
  const ideal = (minC + maxC) / 2;
  const out = [];
  for (const s of shots) {
    let len = s.end - s.start;
    if (len < 0.8) continue;                              // descarta parpadeos/transiciones
    const end = s.start + Math.min(len, maxC);            // recorta tomas largas
    len = end - s.start;
    // El diálogo real (audio) tiene prioridad, pero las tomas visuales deben poder entrar
    // (si no, videos sin diálogo quedarían fuera).
    const score = 0.4 + 0.2 * (1 - Math.min(1, Math.abs(len - ideal) / ideal)); // ~0.40–0.60
    out.push({ start: Number(s.start.toFixed(2)), end: Number(end.toFixed(2)), role: "cuerpo",
               score: Number(score.toFixed(2)), reason: "toma visual", source: "visual" });
  }
  return out;
}

// ---- Extrae UN fotograma del video en un instante dado (jpg pequeño) ----
function extractFrame(input, timeSec, output) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error("FFmpeg no está instalado."));
    // -ss antes de -i = búsqueda rápida; escala a 640px de ancho para gastar poco.
    const args = ["-y", "-ss", String(Math.max(0, timeSec)), "-i", input,
                  "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", output];
    const p = spawn(FFMPEG, args);
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", code => (code === 0 && fs.existsSync(output))
      ? resolve() : reject(new Error("No se pudo extraer el fotograma: " + err.slice(-200))));
  });
}

// ---- Gemini puntúa UN fotograma (0..1) según lo que se ve ----
async function geminiScoreFrame(imgPath, profile, settings) {
  const key = settings.geminiKey;
  const b64 = fs.readFileSync(imgPath).toString("base64");
  const p = profile || {};
  const prompt = [
    "Eres un editor de video que evalúa UN fotograma de un video tipo '" + (p.label || settings.videoType) + "'.",
    "Objetivo del perfil: " + (p.scoringPrompt || "elegir los momentos visualmente más fuertes y relevantes."),
    "Puntúa qué tan buen MOMENTO DE CORTE es este fotograma (0 a 1) valorando: caras/expresiones/personas, acción o movimiento interesante, nitidez (penaliza borroso o movido), producto u objeto principal claro, texto en pantalla legible, y buena composición/iluminación.",
    "Devuelve SOLO JSON: {\"score\": number_0a1, \"reason\": \"breve (máx 8 palabras)\"}."
  ].join("\n");
  const body = {
    contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: "image/jpeg", data: b64 } } ] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  };
  const model = await resolveVisionModel(key);
  const url = GEMINI + "/" + model + ":generateContent?key=" + encodeURIComponent(key);

  // Reintenta ante errores TEMPORALES (503 sobrecarga, 500, o 429 por minuto).
  // El 403 y el 429 de cuota DIARIA sí cortan (avisar + caer a método por escena).
  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    let r;
    try {
      r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (netErr) { lastErr = "red: " + (netErr.message || netErr); await sleep(700 * (attempt + 1)); continue; }

    if (r.ok) {
      const data = await r.json();
      let txt = ""; try { txt = data.candidates[0].content.parts[0].text; } catch (e) { txt = ""; }
      let out; try { out = JSON.parse(txt); } catch (e) { out = { score: 0.5, reason: "visión IA" }; }
      let sc = Number(out.score); if (isNaN(sc)) sc = 0.5;
      return { score: Math.max(0, Math.min(1, sc)), reason: out.reason || "visión IA" };
    }

    const full = await r.text();               // completo (para leer retryDelay)
    const t = full.slice(0, 300);
    if (r.status === 403) throw new QuotaError(t);
    if (r.status === 404) { RESOLVED_VISION_MODEL = null; throw new Error("Gemini 404 (modelo " + model + "): " + t); }
    if (r.status === 429) {
      // Google indica cuánto esperar en "retryDelay". Corto = límite por MINUTO (esperar y reintentar);
      // muy largo = cuota DIARIA agotada (no tiene sentido esperar → avisar y caer a método por escena).
      let delay = 0;
      try {
        const j = JSON.parse(full);
        const ri = ((j.error && j.error.details) || []).find(d => /RetryInfo/.test(d["@type"] || ""));
        if (ri && ri.retryDelay) delay = parseFloat(ri.retryDelay) || 0;   // p.ej. "31s"
      } catch (e) {}
      if (delay > 90) throw new QuotaError("cuota diaria agotada (retryDelay " + delay + "s)");
      lastErr = "429 " + t;
      await sleep(Math.max(2000 * (attempt + 1), delay * 1000));   // respeta el tiempo sugerido
      continue;
    }
    if (r.status === 503 || r.status === 500) {
      lastErr = r.status + " " + t;                       // sobrecarga temporal → reintentar
      await sleep(800 * Math.pow(2, attempt));            // 0.8s → 1.6s → 3.2s → 6.4s → 12.8s
      continue;
    }
    throw new Error("Gemini " + r.status + ": " + t);
  }
  // Agotados los reintentos: si fue 429 persistente lo tratamos como límite; si no, error normal (cae a escena)
  if (/^429/.test(lastErr)) throw new QuotaError(lastErr);
  throw new Error("Gemini no respondió tras varios reintentos: " + lastErr);
}

// Elige N elementos repartidos de forma pareja a lo largo del arreglo.
function pickEvenly(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [], step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

// ---- Análisis VISUAL con Gemini: saca pocos frames buenos y los puntúa 1 a 1 ----
// Devuelve candidatos con score real de visión. Lanza QuotaError si se acabó la cuota.
async function analyzeVisualGemini(input, profile, settings, shots, dur) {
  const n = Math.max(1, Math.min(12, settings.visionFrames || VISION_FRAMES_DEFAULT));
  const picks = pickEvenly(shots, n);
  const minC = (profile && profile.minClip) ? profile.minClip : 2;
  const maxC = (profile && profile.maxClip) ? profile.maxClip : 6;
  const out = [];
  for (let i = 0; i < picks.length; i++) {
    const s = picks[i];
    const mid = (s.start + s.end) / 2;
    const frame = path.join(os.tmpdir(), "caiframe_" + Date.now() + "_" + i + ".jpg");
    try {
      await extractFrame(input, mid, frame);
      const g = await geminiScoreFrame(frame, profile, settings);   // QuotaError sube y corta
      let st = Math.max(0, s.start);
      let en = Math.min(s.end, st + maxC);
      if (en - st < minC) { en = st + minC; if (dur && en > dur) { en = dur; st = Math.max(0, dur - minC); } }
      if (en - st >= 1) out.push({ start: +st.toFixed(2), end: +en.toFixed(2),
        role: "cuerpo", score: g.score, reason: g.reason, source: "vision" });
    } finally { try { fs.unlinkSync(frame); } catch (e) {} }
    if (i < picks.length - 1) await sleep(600);   // ritmo suave entre peticiones (evita 429 por minuto)
  }
  return out;
}

async function processFolder(folderPath, settings, profile) {
  const files = fs.readdirSync(folderPath).filter(isRealVideo).sort();
  if (!files.length) throw new Error("No se encontraron videos válidos en la carpeta.");
  const max = (settings.maxVideos && settings.maxVideos > 0) ? settings.maxVideos : files.length;
  const perClip = [], skipped = [];
  let visionUsed = 0, visionLimitReached = false;   // control de la Visión IA (Gemini)
  for (const name of files) {
    if (perClip.length >= max) break;
    const input = path.join(folderPath, name);
    const audio = path.join(os.tmpdir(), "cortesai_" + Date.now() + "_" + Math.floor(perClip.length) + ".mp3");
    try {
      // 1) Intento por AUDIO (diálogo): transcribir + analizar.
      //    En modo LOCAL (sin API) se salta: solo análisis visual, 100% en el equipo.
      let audioCuts = [], textLen = 0, dur = 0;
      const useApi = settings.transcription !== "local" && !!settings.apiKey;
      if (useApi) try {
        await extractAudio(input, audio);
        const tr = await transcribe(audio, settings.apiKey, settings.language);
        dur = tr.duration || 0;
        textLen = ((tr.text || "").trim()).length;
        if (textLen > 4) {   // hay diálogo real
          const plan = await analyze(tr, profile, settings, settings.apiKey);
          audioCuts = (plan.cuts || []).map(c => Object.assign({ source: "audio" }, c));
          // Plan B: hay habla con contenido pero la IA no eligió → saca su MEJOR momento hablado
          if (!audioCuts.length && textLen > 40) {
            const segs = (tr.segments || []).filter(s => (s.text || "").trim().length > 8)
              .sort((a, b) => (b.text || "").length - (a.text || "").length);
            if (segs.length) {
              let st = Math.max(0, segs[0].start), en = Math.min(segs[0].end, st + MAXCUT);
              if (en - st < MINCUT) en = st + MINCUT;
              audioCuts = [{ source: "audio", start: st, end: en, role: "cuerpo", score: 0.6, reason: "mejor momento hablado" }];
            }
          }
        }
      } catch (audioErr) { /* seguimos con visual */ }

      // 2) Si no hubo diálogo útil → análisis VISUAL
      let cuts = audioCuts;
      let mode = "audio";
      if (!cuts.length) {
        const sc = await detectScenes(input);
        if (!dur) dur = sc.duration;
        const shots = scenesToShots(sc.times, sc.duration || dur, profile);
        // 2a) Visión IA (Gemini) si está activada, hay key y no se agotó la cuota
        const useVision = settings.vision && settings.geminiKey && !visionLimitReached;
        if (useVision) {
          try {
            cuts = await analyzeVisualGemini(input, profile, settings, shots, sc.duration || dur);
            mode = "visión-IA";
            if (cuts.length) visionUsed++;
            else { cuts = shotCandidates(shots, profile); mode = "visual"; }   // sin frames útiles → normal
          } catch (ve) {
            cuts = shotCandidates(shots, profile);
            if (ve instanceof QuotaError) {
              visionLimitReached = true;                 // se acabó la cuota → avisar + seguir por escena
              mode = "visual (límite IA)";
              console.log("  ⚠️  Límite diario de Gemini alcanzado — sigo con el método por escena.");
            } else {
              mode = "visual";
              console.log("  ⚠️  Visión IA falló (" + (ve.message || ve).toString().slice(0, 80) + ") — método por escena.");
            }
          }
        } else {
          // 2b) Método normal (detección de escenas) — sin visión IA
          cuts = shotCandidates(shots, profile);
          mode = "visual";
        }
      }

      perClip.push({ video: name, duration: dur, cuts: cuts, mode: mode });
      console.log("  ✓ " + name + " (" + cuts.length + " tomas · " + mode + " · " + Math.round(dur) + "s · texto " + textLen + ")");
    } catch (e) {
      skipped.push({ video: name, error: e.message });
      console.log("  ✗ " + name + " (saltado: " + e.message.slice(0, 80) + ")");
    } finally {
      try { fs.unlinkSync(audio); } catch (e2) {}
    }
  }
  if (!perClip.length) {
    throw new Error("No se pudo procesar ningún video. Primer error: " + (skipped[0] ? skipped[0].error : "desconocido"));
  }
  // PASE DIRECTOR (si hay key de Groq): la IA arma el montaje final razonando globalmente.
  let montage = null;
  if (settings.apiKey) {
    try {
      montage = await directorPass(perClip, settings, profile, settings.apiKey);
      if (montage) console.log("  🎬 Director: montaje final con " + montage.cuts.length + " cortes (" + Math.round(montage.totalDuration) + "s).");
    } catch (e) {
      console.log("  ⚠️  Director falló (" + (e.message || e).toString().slice(0, 80) + ") — uso ensamblaje normal.");
    }
  }
  if (!montage) montage = assembleMontage(perClip, settings);   // respaldo mecánico
  return { totalVideos: files.length, processed: perClip.length, skipped, perClip, montage,
           visionUsed, visionLimitReached };
}

// ---- Genera un script ExtendScript (.jsx) que arma el timeline recortado ----
function buildJsx(folder, cuts, seqName) {
  const data = JSON.stringify(cuts);
  const F = JSON.stringify(folder);
  const N = JSON.stringify(seqName);
  return [
    "#target premierepro",
    "(function () {",
    "  var proj = app.project;",
    "  if (!proj) { alert('CortesAI: abre un proyecto en Premiere primero.'); return; }",
    "  var SEP = '/';",
    "  var FOLDER = " + F + ";",
    "  var CUTS = " + data + ";",
    "  function findByName(item, name) {",
    "    try {",
    "      var kids = item.children; if (!kids) return null;",
    "      for (var i = 0; i < kids.numItems; i++) {",
    "        var it = kids[i];",
    "        if (it && it.name === name) return it;",
    "        if (it && it.type === 2 && it.children) { var f = findByName(it, name); if (f) return f; }",
    "      }",
    "    } catch (e) {}",
    "    return null;",
    "  }",
    "  var toImport = [];",
    "  for (var i = 0; i < CUTS.length; i++) {",
    "    if (!findByName(proj.rootItem, CUTS[i].file)) toImport.push(FOLDER + SEP + CUTS[i].file);",
    "  }",
    "  if (toImport.length > 0) { try { proj.importFiles(toImport, true, proj.rootItem, false); } catch (e) {} }",
    "  try { proj.createNewSequence(" + N + ", 'cortesai_' + (new Date()).getTime()); } catch (e) {}",
    "  var seq = proj.activeSequence;",
    "  if (!seq) { alert('CortesAI: no se pudo crear la secuencia.'); return; }",
    "  var vTrack = seq.videoTracks[0];",
    "  var placed = 0, playhead = 0.0;",
    "  for (var i = 0; i < CUTS.length; i++) {",
    "    var item = findByName(proj.rootItem, CUTS[i].file);",
    "    if (!item) continue;",
    "    try { item.setInPoint(CUTS[i].inSec, 4); item.setOutPoint(CUTS[i].outSec, 4); } catch (e) {}",
    "    try { vTrack.overwriteClip(item, playhead); placed++; } catch (e) {}",
    "    playhead += (CUTS[i].outSec - CUTS[i].inSec);",
    "  }",
    "  alert('CortesAI: montaje listo. Cortes colocados: ' + placed + ' / ' + CUTS.length + '.');",
    "})();",
    ""
  ].join("\n");
}

// ---- Servidor HTTP local ----
function cors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  if (req.method === "POST" && req.url === "/jsx") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      try {
        const { folder, cuts, seqName } = JSON.parse(body);
        if (!folder || !cuts || !cuts.length) throw new Error("faltan datos");
        const jsxPath = path.join(folder, "CortesAI_montaje.jsx");
        fs.writeFileSync(jsxPath, buildJsx(folder, cuts, seqName || "CortesAI montaje"));
        console.log("\n[JSX] Script generado: " + jsxPath + " (" + cuts.length + " cortes)\n");
        res.end(JSON.stringify({ ok: true, path: jsxPath }));
      } catch (e) {
        res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      console.log("\n───────── DIAGNÓSTICO DEL PANEL ─────────");
      console.log(body);
      console.log("─────────────────────────────────────────\n");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, ffmpeg: !!FFMPEG, version: "0.11.2" }));
  }
  if (req.method === "POST" && req.url === "/process") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      res.setHeader("Content-Type", "application/json");
      try {
        const { folderPath, settings, profile } = JSON.parse(body);
        if (!folderPath) throw new Error("Falta la carpeta.");
        if (settings && settings.transcription !== "local" && !settings.apiKey) throw new Error("Falta la API key de Groq (o usa modo Local).");
        const out = await processFolder(folderPath, settings, profile);
        res.end(JSON.stringify({
          ok: true,
          totalVideos: out.totalVideos,
          processed: out.processed,
          skipped: out.skipped,
          montage: out.montage,          // { cuts:[{clip,start,end,role,score,reason}], totalDuration, target }
          perClip: out.perClip,
          visionUsed: out.visionUsed,             // nº de videos analizados con Visión IA
          visionLimitReached: out.visionLimitReached   // true si se agotó la cuota diaria de Gemini
        }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.statusCode = 404; res.end("CortesAI engine");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("========================================");
  console.log(" CortesAI · Motor local en marcha");
  console.log(" URL:    http://localhost:" + PORT);
  console.log(" FFmpeg: " + (FFMPEG || "NO ENCONTRADO (instala con: brew install ffmpeg)"));
  console.log(" Node:   " + process.version);
  console.log("========================================");
  console.log("Deja esta ventana abierta mientras usas el panel en Premiere.");
});
