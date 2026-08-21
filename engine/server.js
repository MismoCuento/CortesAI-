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
const MODEL_LLM = "openai/gpt-oss-20b";

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
    "Eres un editor de video viral experto. Recibes la transcripción con marcas de tiempo de UN video y eliges sus MEJORES momentos para un montaje que ENGANCHE.",
    "OBJETIVO: el resultado debe captar la atención al instante y mantenerla (contenido 'dopamínico'). Prioriza momentos con ENERGÍA, EMOCIÓN, SORPRESA, ACCIÓN, INTERACCIÓN entre personas, reacciones, o frases con gancho. Evita momentos planos, lentos, silencios o relleno.",
    "REGLA CLAVE: elige SOLO momentos donde se DICE algo con contenido (una frase que aporta, una reacción, una emoción) o se MUESTRA algo claramente relevante. NO elijas cortes sin sentido, ambiguos, de transición o de relleno.",
    "Duración de cada corte: entre 2 y 6 segundos. Un corte de 2-3s está perfecto si muestra algo relevante; nunca más de 6s.",
    "Sé exigente: mejor 5 cortes con sentido que 15 vacíos. Si un video no tiene nada relevante, no elijas nada de él.",
    "Tipo de video: " + (p.label || settings.videoType) + ".",
    "Criterio: " + (p.scoringPrompt || "Prioriza los momentos más relevantes e interesantes."),
    p.keep ? ("Prioriza: " + p.keep.join(", ") + ".") : "",
    p.remove ? ("Elimina: " + p.remove.join(", ") + ".") : "",
    (p.respectSentences ? "Respeta frases completas; no cortes a mitad de una idea." : "Puedes hacer cortes ágiles."),
    p.structure ? ("Roles posibles: hook, gancho, cuerpo, cta (según " + p.structure + ").") : "",
    "Devuelve VARIOS segmentos candidatos de este video, cada uno coherente, ordenados por score. No intentes llenar una duración fija: solo marca lo bueno (varios clips distintos se combinarán después).",
    'Devuelve SOLO JSON: { "cuts": [ { "start": number_segundos, "end": number_segundos, "role": "hook|gancho|cuerpo|cta", "score": number_0a1, "reason": "breve" } ], "notes": "breve" }.',
    "Los start/end deben caer dentro de la transcripción y en orden."
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
      if (end - start >= 1) all.push(Object.assign({}, c, { clip: r.video, start: +start.toFixed(2), end: +end.toFixed(2) }));
    });
  });
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const len = (c) => c.end - c.start;

  const bestHook = all.find(c => c.role === "hook") || null;
  const bestCta  = all.find(c => c.role === "cta")  || null;
  const ctaLen   = bestCta ? len(bestCta) : 0;

  // 2) Selecciona: máximo 1 segmento por clip (no repetir tomas), hasta la duración objetivo
  const usedClip = {}, chosen = []; let total = 0;
  const tryAdd = (c, role, reserve) => {
    if (!c || usedClip[c.clip]) return false;
    if (chosen.length && (total + len(c) + (reserve || 0)) > target) return false;
    usedClip[c.clip] = true;
    chosen.push(Object.assign({}, c, { role: role }));
    total += len(c);
    return true;
  };

  const MIN_SCORE = 0.4;   // compuerta de calidad: descarta segmentos mediocres
  tryAdd(bestHook, "hook", ctaLen);
  for (const c of all) {
    if (c === bestHook || c === bestCta) continue;
    if ((c.score || 0) < MIN_SCORE) continue;   // "¿sirve o no?": solo lo bueno
    tryAdd(c, "cuerpo", ctaLen);
  }
  tryAdd(bestCta, "cta", 0);

  return { cuts: chosen, totalDuration: total, target: (target === Infinity ? null : target) };
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
    // Puntaje bajo a las tomas puramente visuales: el diálogo real (audio) tiene prioridad,
    // y la compuerta de calidad descarta las tomas "porque sí".
    const score = 0.3 + 0.15 * (1 - Math.min(1, Math.abs(len - ideal) / ideal)); // ~0.30–0.45
    out.push({ start: Number(s.start.toFixed(2)), end: Number(end.toFixed(2)), role: "cuerpo",
               score: Number(score.toFixed(2)), reason: "toma visual", source: "visual" });
  }
  return out;
}

async function processFolder(folderPath, settings, profile) {
  const files = fs.readdirSync(folderPath).filter(isRealVideo).sort();
  if (!files.length) throw new Error("No se encontraron videos válidos en la carpeta.");
  const max = (settings.maxVideos && settings.maxVideos > 0) ? settings.maxVideos : files.length;
  const perClip = [], skipped = [];
  for (const name of files) {
    if (perClip.length >= max) break;
    const input = path.join(folderPath, name);
    const audio = path.join(os.tmpdir(), "cortesai_" + Date.now() + "_" + Math.floor(perClip.length) + ".mp3");
    try {
      // 1) Intento por AUDIO (diálogo): transcribir + analizar
      let audioCuts = [], textLen = 0, dur = 0;
      try {
        await extractAudio(input, audio);
        const tr = await transcribe(audio, settings.apiKey, settings.language);
        dur = tr.duration || 0;
        textLen = ((tr.text || "").trim()).length;
        if (textLen > 4) {   // hay diálogo real
          const plan = await analyze(tr, profile, settings, settings.apiKey);
          audioCuts = (plan.cuts || []).map(c => Object.assign({ source: "audio" }, c));
        }
      } catch (audioErr) { /* seguimos con visual */ }

      // 2) Si no hubo diálogo útil → análisis VISUAL (tomas por cambio de escena)
      let cuts = audioCuts;
      let mode = "audio";
      if (!cuts.length) {
        const sc = await detectScenes(input);
        if (!dur) dur = sc.duration;
        const shots = scenesToShots(sc.times, sc.duration || dur, profile);
        cuts = shotCandidates(shots, profile);
        mode = "visual";
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
  const montage = assembleMontage(perClip, settings);
  return { totalVideos: files.length, processed: perClip.length, skipped, perClip, montage };
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
    return res.end(JSON.stringify({ ok: true, ffmpeg: !!FFMPEG, version: "0.6.1" }));
  }
  if (req.method === "POST" && req.url === "/process") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      res.setHeader("Content-Type", "application/json");
      try {
        const { folderPath, settings, profile } = JSON.parse(body);
        if (!folderPath) throw new Error("Falta la carpeta.");
        if (!settings || !settings.apiKey) throw new Error("Falta la API key de Groq.");
        const out = await processFolder(folderPath, settings, profile);
        res.end(JSON.stringify({
          ok: true,
          totalVideos: out.totalVideos,
          processed: out.processed,
          skipped: out.skipped,
          montage: out.montage,          // { cuts:[{clip,start,end,role,score,reason}], totalDuration, target }
          perClip: out.perClip
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
