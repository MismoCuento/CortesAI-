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
    "Eres un editor de video experto. Recibes la transcripción con marcas de tiempo de un video y eliges los MEJORES segmentos para un montaje.",
    "Tipo de video: " + (p.label || settings.videoType) + ".",
    "Criterio: " + (p.scoringPrompt || "Prioriza los momentos más relevantes e interesantes."),
    p.keep ? ("Prioriza: " + p.keep.join(", ") + ".") : "",
    p.remove ? ("Elimina: " + p.remove.join(", ") + ".") : "",
    (p.respectSentences ? "Respeta frases completas; no cortes a mitad de una idea." : "Puedes hacer cortes ágiles."),
    "Duración objetivo del montaje: " + dur + ".",
    p.structure ? ("Estructura por roles: " + p.structure + " (role: hook, gancho, cuerpo o cta).") : "",
    'Devuelve SOLO JSON: { "cuts": [ { "start": number_segundos, "end": number_segundos, "role": "hook|gancho|cuerpo|cta", "score": number_0a1, "reason": "breve" } ], "finalDuration": number, "notes": "breve" }.',
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

// ---- Procesar una carpeta (por ahora: el primer video) ----
async function processFolder(folderPath, settings, profile) {
  const files = fs.readdirSync(folderPath)
    .filter(f => VIDEO_EXT.includes(f.split(".").pop().toLowerCase()))
    .sort();
  if (!files.length) throw new Error("No se encontraron videos en la carpeta.");
  const limit = settings.limit || 1;                // prototipo: 1 video (escalable)
  const results = [];
  for (const name of files.slice(0, limit)) {
    const input = path.join(folderPath, name);
    const audio = path.join(os.tmpdir(), "cortesai_" + Date.now() + ".mp3");
    try {
      await extractAudio(input, audio);
      const tr = await transcribe(audio, settings.apiKey, settings.language);
      const plan = await analyze(tr, profile, settings, apiKey_of(settings));
      results.push({ video: name, language: tr.language, duration: tr.duration, cuts: plan.cuts, notes: plan.notes });
    } finally {
      try { fs.unlinkSync(audio); } catch (e) {}
    }
  }
  return { count: files.length, processed: results.length, results };
}
function apiKey_of(s){ return s.apiKey; }

// ---- Servidor HTTP local ----
function cors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, ffmpeg: !!FFMPEG, version: "0.3.0" }));
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
        // Compatibilidad: exponer el primer resultado en la raíz
        const first = out.results[0] || {};
        res.end(JSON.stringify({ ok: true, count: out.count, processed: out.processed,
          video: first.video, language: first.language, duration: first.duration,
          cuts: first.cuts || [], notes: first.notes || "", results: out.results }));
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
