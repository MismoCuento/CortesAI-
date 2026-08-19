/*
 * CortesAI · Panel UXP para Premiere Pro
 * Fase 1 — Interfaz y flujo (el motor de análisis llega en la Fase 2).
 *
 * Este archivo solo controla la interfaz: elegir carpeta, leer ajustes,
 * validar y mostrar el progreso. Aún NO hace cortes reales (eso es Fase 3).
 */

// --- Acceso al sistema de archivos de UXP (con protección si no está) ---
let fs = null;
try { fs = require("uxp").storage.localFileSystem; } catch (e) { /* fuera de Premiere */ }

// --- Extensiones de video reconocidas ---
const VIDEO_EXT = ["mp4", "mov", "m4v", "avi", "mkv", "mxf", "mts", "wmv", "webm"];

// --- Perfiles (respaldo embebido; se intenta cargar desde /profiles) ---
const FALLBACK_PROFILES = [
  { id: "reel",       label: "Reel / Social",        desc: "Cortes rápidos, engancha en los primeros segundos." },
  { id: "deporte",    label: "Deportivo",            desc: "Detecta acción y picos de audio (jugadas, goles)." },
  { id: "educativo",  label: "Educativo / Tutorial", desc: "Explicaciones claras y pasos ordenados." },
  { id: "politico",   label: "Político",             desc: "Respeta frases completas y declaraciones clave." },
  { id: "anuncios",   label: "Anuncios / Publicidad",desc: "Mensaje directo, marca visible y CTA potente." },
  { id: "ecommerce",  label: "Ecommerce / Producto", desc: "Producto, beneficios y llamado a la acción." },
  { id: "entrevista", label: "Entrevista / Podcast", desc: "Mantiene el hilo de la conversación." }
];

let PROFILES = FALLBACK_PROFILES;
let selectedFolder = null; // token de carpeta de UXP

// ---------- Utilidades de UI ----------
const $ = (id) => document.getElementById(id);
function showView(name) {
  ["config", "progress", "done"].forEach(v => $("view-" + v).classList.add("hidden"));
  $("view-" + name).classList.remove("hidden");
}

// ---------- Cargar perfiles desde la carpeta del plugin ----------
async function loadProfiles() {
  try {
    if (!fs) throw new Error("sin fs");
    const pluginFolder = await fs.getPluginFolder();
    const profilesFolder = await pluginFolder.getEntry("profiles");
    const entries = await profilesFolder.getEntries();
    const loaded = [];
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        const text = await entry.read();
        const p = JSON.parse(text);
        loaded.push({ id: p.id, label: p.label, desc: p.desc });
      }
    }
    if (loaded.length) PROFILES = loaded;
  } catch (e) {
    // Si falla, usamos los perfiles embebidos.
    PROFILES = FALLBACK_PROFILES;
  }
  const sel = $("videoType");
  sel.innerHTML = "";
  PROFILES.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
  updateTypeDesc();
}

function updateTypeDesc() {
  const p = PROFILES.find(x => x.id === $("videoType").value);
  $("typeDesc").textContent = p ? p.desc : "";
}

// ---------- Elegir carpeta y contar videos ----------
async function pickFolder() {
  if (!fs) { showError("El selector de carpetas solo funciona dentro de Premiere."); return; }
  try {
    const folder = await fs.getFolder();
    if (!folder) return; // el usuario canceló
    selectedFolder = folder;
    $("folderPath").value = folder.nativePath || folder.name;
    const entries = await folder.getEntries();
    const videos = entries.filter(e => {
      if (!e.isFile) return false;
      const ext = e.name.split(".").pop().toLowerCase();
      return VIDEO_EXT.includes(ext);
    });
    $("folderInfo").textContent = videos.length
      ? `✓ ${videos.length} video(s) encontrados`
      : "⚠️ No se encontraron videos en esta carpeta";
    hideError();
  } catch (e) {
    showError("No se pudo abrir la carpeta: " + e.message);
  }
}

// ---------- Recopilar ajustes ----------
function gatherSettings() {
  let duration = $("duration").value;
  if (duration === "custom") duration = $("durationCustom").value.trim() || "auto";
  return {
    folder: selectedFolder ? ($("folderPath").value) : null,
    videoType: $("videoType").value,
    duration,
    format: $("format").value,
    language: $("language").value,
    transcription: document.querySelector('input[name="transcribe"]:checked').value,
    review: $("optReview").checked,
    subtitles: $("optSubs").checked,
    reframe: $("optReframe").checked
  };
}

// ---------- Iniciar (Fase 1: simulación del flujo) ----------
const STEPS = [
  "Leyendo videos de la carpeta",
  "Extrayendo audio (FFmpeg)",
  "Transcribiendo",
  "Analizando importancia (IA)",
  "Analizando imagen (visión)",
  "Calculando cortes",
  "Construyendo la línea de tiempo"
];
let cancelRequested = false;

async function start() {
  hideError();
  const s = gatherSettings();
  if (!selectedFolder) { showError("Primero elige una carpeta de videos."); return; }

  showView("progress");
  cancelRequested = false;
  const stepsEl = $("progressSteps");
  stepsEl.innerHTML = "";
  STEPS.forEach((t, i) => {
    const li = document.createElement("li");
    li.textContent = "○ " + t;
    li.id = "step-" + i;
    stepsEl.appendChild(li);
  });

  for (let i = 0; i < STEPS.length; i++) {
    if (cancelRequested) { showView("config"); return; }
    const li = $("step-" + i);
    li.className = "active";
    li.textContent = "⟳ " + STEPS[i] + "…";
    setProgress(Math.round((i / STEPS.length) * 100));
    await wait(700); // Fase 1: simulado. Fase 2+ conecta el motor real.
    li.className = "done";
    li.textContent = "✓ " + STEPS[i];
  }
  setProgress(100);
  await wait(300);
  showDone(s);
}

function setProgress(pct) {
  $("progressFill").style.width = pct + "%";
  $("progressPct").textContent = pct + "%";
}

function showDone(s) {
  $("doneSummary").innerHTML =
    `<b>Ajustes usados</b><br/>` +
    `Tipo: <b>${labelOf(s.videoType)}</b><br/>` +
    `Duración: <b>${s.duration}</b><br/>` +
    `Formato: <b>${s.format}</b><br/>` +
    `Idioma: <b>${s.language}</b> · Transcripción: <b>${s.transcription}</b><br/><br/>` +
    `<i>Fase 1: la interfaz y el flujo funcionan. En la Fase 2 se conecta el motor ` +
    `que hace los cortes reales en el timeline.</i>`;
  showView("done");
}

function labelOf(id) { const p = PROFILES.find(x => x.id === id); return p ? p.label : id; }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function showError(msg) { const el = $("configError"); el.textContent = msg; el.classList.remove("hidden"); }
function hideError() { $("configError").classList.add("hidden"); }

// ---------- Enlaces de eventos ----------
function bind() {
  $("btnPickFolder").addEventListener("click", pickFolder);
  $("videoType").addEventListener("change", updateTypeDesc);
  $("duration").addEventListener("change", () => {
    $("durationCustom").classList.toggle("hidden", $("duration").value !== "custom");
  });
  $("btnStart").addEventListener("click", start);
  $("btnCancel").addEventListener("click", () => { cancelRequested = true; });
  $("btnNew").addEventListener("click", () => showView("config"));
}

// ---------- Arranque ----------
(async function init() {
  bind();
  await loadProfiles();
  showView("config");
})();
