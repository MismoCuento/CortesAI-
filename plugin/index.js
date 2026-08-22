/*
 * CortesAI · Panel UXP para Premiere Pro
 * Fase 2 — Motor real (transcripción + análisis con Groq).
 *
 * Modo API (Groq): lee un video, lo transcribe con Whisper y calcula los
 * cortes con un LLM. Muestra los cortes REALES (aún no los inserta en el
 * timeline — eso es la Fase 3).
 * Modo Local: por ahora sigue simulado (se implementa en una fase posterior).
 */

// --- Acceso al sistema de archivos de UXP (con protección si no está) ---
let fs = null, formats = null;
try {
  const uxp = require("uxp");
  fs = uxp.storage.localFileSystem;
  formats = uxp.storage.formats;
} catch (e) { /* fuera de Premiere */ }

const ENGINE = "http://localhost:8765";
const GROQ_BASE = "https://api.groq.com/openai/v1";
const MODEL_STT = "whisper-large-v3-turbo";
const MODEL_LLM = "openai/gpt-oss-20b";
const MAX_BYTES = 24 * 1024 * 1024; // límite práctico de la API para el prototipo
const VIDEO_EXT = ["mp4", "mov", "m4v", "avi", "mkv", "mxf", "mts", "wmv", "webm"];
const MIME = { mp4:"video/mp4", mov:"video/quicktime", m4v:"video/x-m4v", webm:"video/webm",
               avi:"video/x-msvideo", mkv:"video/x-matroska", mpeg:"video/mpeg", wav:"audio/wav", m4a:"audio/mp4" };

// Perfiles de respaldo (si no se puede leer la carpeta /profiles)
const FALLBACK_PROFILES = [
  { id:"reel", label:"Reel / Social", desc:"Cortes rápidos, engancha en los primeros segundos.", respectSentences:false, structure:"hook-gancho-cuerpo-cta", scoringPrompt:"Prioriza momentos con gancho, emoción o sorpresa; penaliza intros lentas." },
  { id:"deporte", label:"Deportivo", desc:"Detecta acción y picos de audio.", respectSentences:false, structure:"hook-cuerpo", scoringPrompt:"Prioriza energía y momentos de acción o narración intensa." },
  { id:"educativo", label:"Educativo / Tutorial", desc:"Explicaciones claras y pasos ordenados.", respectSentences:true, structure:"hook-cuerpo-cta", scoringPrompt:"Prioriza explicaciones claras, pasos y ejemplos; mantén el orden lógico." },
  { id:"politico", label:"Político", desc:"Respeta frases completas y declaraciones clave.", respectSentences:true, structure:"hook-cuerpo", scoringPrompt:"Prioriza declaraciones claras, cifras y respuestas directas; nunca cortes una frase a la mitad." },
  { id:"anuncios", label:"Anuncios / Publicidad", desc:"Mensaje directo, marca visible y CTA potente.", respectSentences:false, structure:"hook-gancho-cuerpo-cta", scoringPrompt:"Prioriza un gancho fuerte al inicio, la propuesta de valor y un cierre con llamado a la acción." },
  { id:"ecommerce", label:"Ecommerce / Producto", desc:"Producto, beneficios y CTA.", respectSentences:false, structure:"hook-gancho-cuerpo-cta", scoringPrompt:"Prioriza claridad del producto, beneficios concretos y el llamado a la acción final." },
  { id:"entrevista", label:"Entrevista / Podcast", desc:"Mantiene el hilo de la conversación.", respectSentences:true, structure:"hook-cuerpo", scoringPrompt:"Prioriza respuestas con contenido, historias y opiniones claras; mantén el hilo." }
];

let PROFILES = FALLBACK_PROFILES;
let selectedFolder = null;
let videoEntries = [];
let cancelRequested = false;
let lastMontage = null;   // { folder, cuts:[{clip,start,end,role,...}], name }

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
function showView(name) {
  ["config","progress","done"].forEach(v => $("view-"+v).classList.add("hidden"));
  $("view-"+name).classList.remove("hidden");
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function fmt(t){ t=Math.max(0,Math.round(t||0)); const m=Math.floor(t/60), s=t%60; return m+":"+String(s).padStart(2,"0"); }
function extOf(name){ return name.split(".").pop().toLowerCase(); }

// ---------- Perfiles ----------
async function loadProfiles() {
  try {
    if (!fs) throw new Error("no fs");
    const pf = await fs.getPluginFolder();
    const pdir = await pf.getEntry("profiles");
    const entries = await pdir.getEntries();
    const loaded = [];
    for (const e of entries) {
      if (e.isFile && e.name.endsWith(".json")) {
        try { loaded.push(JSON.parse(await e.read())); } catch(_){}
      }
    }
    if (loaded.length) PROFILES = loaded;
  } catch(e){ PROFILES = FALLBACK_PROFILES; }
  const sel = $("videoType"); sel.innerHTML = "";
  PROFILES.forEach(p => { const o=document.createElement("option"); o.value=p.id; o.textContent=p.label; sel.appendChild(o); });
  updateTypeDesc();
}
function currentProfile(){ return PROFILES.find(p=>p.id===$("videoType").value) || PROFILES[0]; }
function updateTypeDesc(){ const p=currentProfile(); $("typeDesc").textContent = p ? (p.desc||"") : ""; }

// ---------- Carpeta ----------
async function pickFolder() {
  if (!fs) { showConfigError("El selector de carpetas solo funciona dentro de Premiere."); return; }
  try {
    const folder = await fs.getFolder();
    if (!folder) return;
    selectedFolder = folder;
    $("folderPath").value = folder.nativePath || folder.name;
    const entries = await folder.getEntries();
    videoEntries = entries.filter(e => e.isFile && !e.name.startsWith(".") && VIDEO_EXT.includes(extOf(e.name)));
    $("folderInfo").textContent = videoEntries.length ? ("✓ "+videoEntries.length+" video(s) encontrados") : "⚠️ No se encontraron videos en esta carpeta";
    hideConfigError();
  } catch(e){ showConfigError("No se pudo abrir la carpeta: "+e.message); }
}

// ---------- Ajustes ----------
function gatherSettings() {
  let duration = $("duration").value;
  if (duration === "custom") duration = ($("durationCustom").value||"").trim() || "auto";
  return {
    videoType: $("videoType").value,
    duration,
    format: $("format").value,
    language: $("language").value,
    transcription: document.querySelector('input[name="transcribe"]:checked').value,
    apiKey: ($("apiKey").value||"").trim(),
    maxVideos: parseInt($("maxVideos").value, 10),
    vision: document.querySelector('input[name="vision"]:checked').value === "on",
    geminiKey: ($("geminiKey").value||"").trim()
  };
}

// ---------- INICIAR ----------
async function start() {
  hideConfigError();
  const s = gatherSettings();
  if (!selectedFolder || !videoEntries.length) { showConfigError("Primero elige una carpeta con videos."); return; }
  if (s.transcription === "api" && !s.apiKey) { showConfigError("Pega tu API key de Groq (o cambia a modo Local)."); return; }
  if (s.vision && !s.geminiKey) { showConfigError("Activaste la Visión IA pero falta la API key de Gemini. Pégala o desactiva la Visión IA."); return; }
  if (s.transcription === "api") localStorage.setItem("groqKey", s.apiKey);
  localStorage.setItem("visionOn", s.vision ? "1" : "0");
  if (s.geminiKey) localStorage.setItem("geminiKey", s.geminiKey);
  return realProcess(s);  // Local y API usan el motor. Local = solo visual (sin API); API = audio + visual.
}

// ---------- Motor real (API / Groq) ----------
const STEPS_API = ["Conectando con el motor local", "Extrayendo audio (FFmpeg)", "Transcribiendo con Groq", "Analizando con IA (cortes)"];

async function realProcess(s) {
  cancelRequested = false;
  showView("progress");
  buildSteps(STEPS_API);
  hideProgressError();

  // 1) ¿Está corriendo el motor local? (soporta cualquier tamaño de video)
  stepState(0, "active"); setProgress(8);
  let engineOk = await engineReachable();

  // 2) Si no está, intentar arrancarlo automáticamente (sin abrir Terminal a mano)
  if (!engineOk) {
    const li = $("step-0"); if (li) { li.className = "active"; li.textContent = "⟳ Iniciando el motor local…"; }
    const started = await tryStartEngine();
    if (started) {
      for (let i = 0; i < 25 && !engineOk; i++) {   // espera hasta ~25s a que levante
        if (cancelRequested) return showView("config");
        await wait(1000);
        engineOk = await engineReachable();
        setProgress(8 + Math.min(20, i));
      }
    }
  }

  if (engineOk) return processViaEngine(s);

  // Motor no disponible: mensaje claro y accionable (no usar modo directo con videos grandes)
  let script = "";
  try { script = await engineScriptPath(); } catch (e) {}
  showProgressError("No pude conectar con el motor local.\n" +
    "1) Debió abrirse una ventana de Terminal (el motor). Si dice 'Motor local en marcha', espera 3s y pulsa Iniciar otra vez.\n" +
    "2) Si muestra un error, o no se abrió, ábrelo a mano: doble clic en:\n" + (script || "repo/engine/start-mac.command") +
    "\n\n[diag] " + (lastEngineLaunch || "no se intentó arrancar"));
}

async function engineReachable() {
  try {
    const r = await fetch(ENGINE + "/health", { method: "GET" });
    const j = await r.json();
    return !!(j && j.ok);
  } catch (e) { return false; }
}

// Ruta al lanzador del motor (junto a la carpeta del plugin: ../engine/start-*)
async function engineScriptPath() {
  const uxp = require("uxp");
  const pf = await uxp.storage.localFileSystem.getPluginFolder();
  const p = pf.nativePath;
  const sep = p.indexOf("\\") >= 0 ? "\\" : "/";
  const repo = p.substring(0, p.lastIndexOf(sep));       // sube de /plugin a /repo
  const isWin = sep === "\\";
  return repo + sep + "engine" + sep + (isWin ? "start-windows.bat" : "start-mac.command");
}

// Arranca el motor automáticamente (abre el lanzador). Devuelve diagnóstico.
let lastEngineLaunch = "";
async function tryStartEngine() {
  try {
    const uxp = require("uxp");
    const script = await engineScriptPath();
    const res = await uxp.shell.openPath(script, "Iniciar el motor local de CortesAI");
    lastEngineLaunch = "openPath('" + script + "') → " + (res === "" ? "OK" : ("respuesta: " + res));
    return true;
  } catch (e) {
    lastEngineLaunch = "openPath error: " + ((e && e.message) ? e.message : String(e));
    return false;
  }
}

// Muestra el estado del motor en la pantalla de config
async function refreshEngineStatus() {
  const el = $("engineStatus"); if (!el) return;
  const ok = await engineReachable();
  el.textContent = ok ? "🟢 Motor conectado (listo para procesar cualquier tamaño)"
                      : "⚪ Motor apagado — se iniciará solo al pulsar Iniciar";
}

// Camino principal: motor local (Node + FFmpeg + Groq) — cualquier tamaño
async function processViaEngine(s) {
  try {
    stepState(0, "done"); stepState(1, "active"); setProgress(30);
    const body = JSON.stringify({
      folderPath: selectedFolder.nativePath,
      settings: s,
      profile: currentProfile()
    });
    stepState(2, "active"); setProgress(55);
    const r = await fetch(ENGINE + "/process", {
      method: "POST", headers: { "Content-Type": "application/json" }, body
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || ("Motor respondió " + r.status));
    stepState(1, "done"); stepState(2, "done"); stepState(3, "done"); setProgress(100);
    await wait(150);
    showMontage(data, s);
  } catch (err) {
    showProgressError((err && err.message) ? err.message : String(err));
  }
}

// Montaje combinado (varios videos)
function showMontage(data, s) {
  const m = data.montage || { cuts: [] };
  const cuts = m.cuts || [];
  lastMontage = { folder: (selectedFolder && selectedFolder.nativePath) || "", cuts: cuts, name: currentProfile().label };
  let html = "";
  // Aviso claro si Gemini se quedó sin cuota diaria (siguió con el método por escena)
  if (data.visionLimitReached) {
    html += "<div style='background:#3a2a00;border:1px solid #b8860b;padding:10px;border-radius:8px;margin-bottom:12px'>" +
            "⚠️ <b>Límite diario de la API de Gemini alcanzado.</b><br/>" +
            "Los videos restantes se analizaron con el método normal (por cambio de escena). " +
            "Para volver a usar la Visión IA hoy, pega otra API key de Gemini (de otro correo) en la configuración." +
            "</div>";
  }
  html += "<b>✅ Montaje calculado (real)</b><br/>";
  html += "Videos procesados: <b>" + data.processed + "</b> de " + data.totalVideos +
          (data.skipped && data.skipped.length ? (" · " + data.skipped.length + " saltado(s)") : "") + "<br/>";
  if (typeof data.visionUsed === "number" && data.visionUsed > 0) {
    html += "👁️ Visión IA usada en: <b>" + data.visionUsed + "</b> video(s)<br/>";
  }
  html += "Cortes en el montaje: <b>" + cuts.length + "</b> · Duración total: <b>" + fmt(m.totalDuration) + "</b>" +
          (m.target ? (" (objetivo " + fmt(m.target) + ")") : "") + "<br/><br/>";
  html += "<b>Línea de tiempo propuesta:</b><br/>";
  cuts.forEach((c, i) => {
    html += (i + 1) + ". <b>" + esc(c.clip || "") + "</b> " + fmt(c.start) + "→" + fmt(c.end) + " " +
            (c.role ? ("[" + c.role + "] ") : "") +
            (typeof c.score === "number" ? ("(" + Math.round(c.score * 100) + "%)") : "") + "<br/>" +
            "<span style='color:#9a9a9a'>" + esc(c.reason || "") + "</span><br/>";
  });
  if (data.skipped && data.skipped.length) {
    html += "<br/><span style='color:#8f8f8f'>Saltados: " + data.skipped.map(x => esc(x.video)).join(", ") + "</span>";
  }
  html += "<br/><br/><i>Pulsa \"Construir en el timeline\" para crear esta secuencia en Premiere.</i>";
  $("doneSummary").innerHTML = html;
  showView("done");
}

// Respaldo directo (sin motor): envía el video a Groq. Solo clips pequeños.
async function processDirect(s) {
  try {
    const entry = videoEntries[0];
    const ext = extOf(entry.name);
    stepState(0, "done"); stepState(1, "done"); // sin FFmpeg en este camino
    stepState(2, "active"); setProgress(20);
    const buf = await entry.read({ format: formats.binary });
    if (buf.byteLength > MAX_BYTES) {
      throw new Error("El video \"" + entry.name + "\" pesa " + (buf.byteLength/1048576).toFixed(1) +
        " MB. Para videos grandes debes abrir el MOTOR LOCAL (start-mac.command): así se extrae solo el audio y se acepta cualquier tamaño. " +
        "El modo directo (sin motor) solo admite clips menores de " + (MAX_BYTES/1048576) + " MB.");
    }
    const tr = await groqTranscribe(buf, entry.name, ext, s);
    stepState(2, "done"); stepState(3, "active"); setProgress(70);
    const plan = await groqAnalyze(tr, s);
    stepState(3, "done"); setProgress(100);
    await wait(150);
    showResults(entry.name, tr, plan, s);
  } catch (err) {
    showProgressError((err && err.message) ? err.message : String(err));
  }
}

// Transcripción con Groq (multipart)
async function groqTranscribe(arrayBuffer, name, ext, s) {
  const blob = new Blob([arrayBuffer], { type: MIME[ext] || "application/octet-stream" });
  const fd = new FormData();
  fd.append("file", blob, name);
  fd.append("model", MODEL_STT);
  fd.append("response_format", "verbose_json");
  if (s.language && s.language !== "auto") fd.append("language", s.language);
  const res = await fetch(GROQ_BASE + "/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + s.apiKey },
    body: fd
  });
  if (!res.ok) throw new Error("Transcripción falló ("+res.status+"): " + await safeText(res));
  const data = await res.json();
  const segs = (data.segments || []).map(x => ({ start:x.start, end:x.end, text:(x.text||"").trim() }));
  return { language: data.language, duration: data.duration, text: data.text, segments: segs };
}

// Análisis con Groq (LLM → JSON de cortes)
async function groqAnalyze(tr, s) {
  const p = currentProfile();
  const sys = [
    "Eres un editor de video experto. Recibes la transcripción con marcas de tiempo de un video y debes elegir los MEJORES segmentos para un montaje.",
    "Tipo de video: " + p.label + ".",
    "Criterio (perfil): " + (p.scoringPrompt || "Prioriza los momentos más relevantes e interesantes."),
    p.keep ? ("Prioriza: " + p.keep.join(", ") + ".") : "",
    p.remove ? ("Elimina: " + p.remove.join(", ") + ".") : "",
    (p.respectSentences ? "Respeta frases completas; no cortes a mitad de una idea." : "Puedes hacer cortes ágiles."),
    "Duración objetivo del montaje final: " + (s.duration==="auto" ? "libre, solo lo mejor" : (s.duration + (String(s.duration).includes(":")?"":" segundos")) ) + ".",
    p.structure ? ("Estructura deseada por roles: " + p.structure + " (usa role: hook, gancho, cuerpo o cta).") : "",
    "Devuelve SOLO JSON válido con esta forma: { \"cuts\": [ { \"start\": number(segundos), \"end\": number(segundos), \"role\": \"hook|gancho|cuerpo|cta\", \"score\": number(0-1), \"reason\": \"breve\" } ], \"finalDuration\": number, \"notes\": \"breve\" }.",
    "Los start/end deben caer dentro de los tiempos de la transcripción y en orden."
  ].filter(Boolean).join("\n");

  const user = "Transcripción (segmentos con tiempos en segundos):\n" +
    tr.segments.map(x => "["+x.start.toFixed(1)+"-"+x.end.toFixed(1)+"] "+x.text).join("\n");

  const res = await fetch(GROQ_BASE + "/chat/completions", {
    method: "POST",
    headers: { "Authorization":"Bearer "+s.apiKey, "Content-Type":"application/json" },
    body: JSON.stringify({
      model: MODEL_LLM,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [ { role:"system", content:sys }, { role:"user", content:user } ]
    })
  });
  if (!res.ok) throw new Error("Análisis falló ("+res.status+"): " + await safeText(res));
  const data = await res.json();
  let out; try { out = JSON.parse(data.choices[0].message.content); } catch(e){ out = { cuts:[], notes:"(respuesta no-JSON)" }; }
  out.cuts = (out.cuts||[]).filter(c => typeof c.start==="number" && typeof c.end==="number" && c.end>c.start);
  return out;
}

async function safeText(res){ try { return await res.text(); } catch(e){ return ""; } }

// ---------- Resultados ----------
function showResults(name, tr, plan, s) {
  const total = (plan.cuts||[]).reduce((a,c)=>a+(c.end-c.start),0);
  let html = "<b>✅ Cortes calculados (reales)</b><br/>";
  html += "Video: <b>"+name+"</b><br/>";
  html += "Idioma detectado: <b>"+(tr.language||"?")+"</b> · Duración original: <b>"+fmt(tr.duration)+"</b><br/>";
  html += "Cortes propuestos: <b>"+(plan.cuts||[]).length+"</b> · Duración del montaje: <b>"+fmt(total)+"</b><br/>";
  if (plan.notes) html += "<br/><i>"+esc(plan.notes)+"</i>";
  html += "<br/><br/><b>Lista de cortes:</b><br/>";
  (plan.cuts||[]).forEach((c,i) => {
    html += (i+1)+". <b>"+fmt(c.start)+" → "+fmt(c.end)+"</b> "+
            (c.role?("["+c.role+"] "):"")+
            (typeof c.score==="number"?("("+Math.round(c.score*100)+"%) "):"")+
            "<br/><span style='color:#9a9a9a'>"+esc(c.reason||"")+"</span><br/>";
  });
  html += "<br/><i>Fase 2 lista: estos son cortes reales calculados por IA. La Fase 3 los insertará como secuencia en tu timeline.</i>";
  $("doneSummary").innerHTML = html;
  showView("done");
}
function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// ---------- Progreso (UI) ----------
function buildSteps(list){
  const el = $("progressSteps"); el.innerHTML = "";
  list.forEach((t,i)=>{ const li=document.createElement("li"); li.id="step-"+i; li.textContent="○ "+t; el.appendChild(li); });
}
function stepState(i, state){
  const li = $("step-"+i); if(!li) return;
  const label = li.textContent.replace(/^[○⟳✓]\s*/,"").replace(/…$/,"");
  if (state==="active"){ li.className="active"; li.textContent="⟳ "+label+"…"; }
  else if (state==="done"){ li.className="done"; li.textContent="✓ "+label; }
}
function setProgress(pct){ $("progressFill").style.width=pct+"%"; $("progressPct").textContent=pct+"%"; }

// ---------- Modo local (simulado por ahora) ----------
async function simulate(s) {
  cancelRequested = false;
  showView("progress"); hideProgressError();
  const steps = ["Leyendo videos","Extrayendo audio (FFmpeg)","Transcribiendo (local)","Analizando importancia","Calculando cortes","Construyendo timeline"];
  buildSteps(steps);
  for (let i=0;i<steps.length;i++){
    if (cancelRequested) return showView("config");
    stepState(i,"active"); setProgress(Math.round(i/steps.length*100));
    await wait(600); stepState(i,"done");
  }
  setProgress(100); await wait(200);
  $("doneSummary").innerHTML = "<b>Modo Local (aún simulado)</b><br/>El modo local (Whisper en tu equipo) se implementa en una fase posterior. Por ahora usa el modo <b>API (Groq)</b> para cortes reales.";
  showView("done");
}

// ---------- Errores ----------
function showConfigError(m){ const e=$("configError"); e.textContent=m; e.classList.remove("hidden"); }
function hideConfigError(){ $("configError").classList.add("hidden"); }
function showProgressError(m){
  let e=$("progressError");
  if(!e){ e=document.createElement("div"); e.id="progressError"; e.className="error-msg"; $("view-progress").appendChild(e); }
  e.textContent = "Error: " + m; e.classList.remove("hidden");
}
function hideProgressError(){ const e=$("progressError"); if(e) e.classList.add("hidden"); }

// Recolecta TODOS los project items recursivamente (raíz + subcarpetas)
async function collectAllItems(node, out) {
  let kids = null;
  try { kids = await node.getItems(); } catch (e) { kids = null; }
  if (kids && kids.length) {
    for (const c of kids) { out.push(c); await collectAllItems(c, out); }
  }
  return out;
}
// Variantes de un nombre para hacer coincidencia flexible
function nameKeys(name) {
  const n = String(name || "");
  const noExt = n.replace(/\.[^.]+$/, "");
  return [n, n.toLowerCase(), noExt, noExt.toLowerCase()];
}

// Re-obtiene un ProjectItem FRESCO por nombre SIN recursión profunda
// (la recursión invalida referencias -> 'script object is no longer valid').
// Devuelve el item en el MISMO getItems donde se encuentra, sin llamadas posteriores.
function normName(s) { return String(s || "").toLowerCase().replace(/\.[^.]+$/, ""); }
async function freshResolve(project, clipName) {
  const target = normName(clipName);
  const root = await project.getRootItem();
  const roots = await root.getItems();
  // 1) buscar en la raíz (sin más llamadas si se encuentra)
  for (const it of roots) { let nm = null; try { nm = it.name; } catch (e) {} if (nm && normName(nm) === target) return it; }
  // 2) buscar un nivel dentro de cada carpeta; devolver en cuanto se encuentra
  for (const it of roots) {
    let kids = null;
    try { kids = await it.getItems(); } catch (e) { kids = null; }
    if (kids && kids.length) {
      for (const k of kids) { let nm = null; try { nm = k.name; } catch (e) {} if (nm && normName(nm) === target) return k; }
    }
  }
  return null;
}

// ---------- FASE 3: construir el montaje en el timeline de Premiere ----------
async function buildTimeline() {
  const st = $("buildStatus");
  const setSt = (t) => { st.textContent = t; };
  if (!lastMontage || !lastMontage.cuts.length) { setSt("No hay montaje para construir."); return; }

  let ppro;
  try { ppro = require("premierepro"); }
  catch (e) { setSt("Esta función solo funciona dentro de Premiere."); return; }

  $("btnBuild").disabled = true;
  let stage = "inicio";
  try {
    stage = "getActiveProject";
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Abre o crea un proyecto en Premiere primero (Archivo → Nuevo → Proyecto).");

    const folder = lastMontage.folder;
    const sep = folder.indexOf("\\") >= 0 ? "\\" : "/";

    // Quita solo cortes IDÉNTICOS (mismo video + mismo in/out). Permite varios momentos distintos del mismo video.
    const seenCut = {};
    const cuts = lastMontage.cuts.filter(c => {
      const k = normName(c.clip) + "|" + c.start + "|" + c.end;
      if (seenCut[k]) return false;
      seenCut[k] = true;
      return true;
    });

    const uniqueNames = [];
    cuts.forEach(c => { if (uniqueNames.indexOf(c.clip) < 0) uniqueNames.push(c.clip); });
    const paths = uniqueNames.map(n => folder + sep + n);

    // 1) Importar solo los clips que NO estén ya en el proyecto (evita duplicados)
    setSt("1/4 Importando clips…");
    stage = "importFiles";
    const root = await project.getRootItem();
    let existing = {};
    try {
      const rootItems = await root.getItems();
      for (const it of rootItems) { let nm = null; try { nm = it.name; } catch (e) {} if (nm) existing[normName(nm)] = true; }
    } catch (e) {}
    const toImport = uniqueNames.filter(n => !existing[normName(n)]).map(n => folder + sep + n);
    let importedOk = true;
    if (toImport.length) importedOk = await project.importFiles(toImport, true, root, false);
    // Sonda directa: ¿getItems del root funciona?
    let probeCount = -1, probeErr = "";
    try { const probe = await (await project.getRootItem()).getItems(); probeCount = probe ? probe.length : -2; }
    catch (e) { probeErr = (e && e.message) ? e.message : String(e); }

    // 2) Localizar los ProjectItems (recursivo + flexible, con reintentos)
    setSt("2/4 Localizando clips…");
    stage = "getItems";
    let byName = {}, sampleNames = [];
    const resolve = (nm) => { for (const k of nameKeys(nm)) { if (byName[k]) return byName[k]; } return null; };
    for (let attempt = 0; attempt < 12; attempt++) {
      const all = await collectAllItems(await project.getRootItem(), []);
      byName = {}; sampleNames = [];
      for (const it of all) {
        let nm = null;
        try { nm = it.name; } catch (e) {}        // ProjectItem usa la PROPIEDAD .name (no getName())
        if (!nm) continue;
        sampleNames.push(nm);
        for (const k of nameKeys(nm)) { if (!byName[k]) byName[k] = it; }
      }
      if (uniqueNames.every(n => resolve(n))) break;
      await wait(400);
    }
    const missing = uniqueNames.filter(n => !resolve(n));
    if (missing.length) {
      throw new Error("importFiles=" + importedOk + " · sonda getItems=" + probeCount + (probeErr ? (" (err: " + probeErr + ")") : "") +
        " · recolectados=" + sampleNames.length +
        " · 1a ruta: " + (paths[0] || "?") +
        (sampleNames.length ? (" · ej: " + sampleNames.slice(0, 6).join(", ")) : ""));
    }

    const T = (s2) => ppro.TickTime.createWithSeconds(s2);
    const seqName = "CortesAI montaje " + new Date().toLocaleTimeString();
    let notes = [];

    // 3) Reunir los ClipProjectItem (await ANTES del lock)
    setSt("3/5 Preparando cortes…");
    stage = "gather";
    const gathered = [];
    for (let i = 0; i < cuts.length; i++) gathered.push(await freshResolve(project, cuts[i].clip));

    // 4) Crear SUBCLIPS ya recortados (dentro de lockedAccess, síncrono) → sin huecos al montarlos
    setSt("4/5 Recortando cortes…");
    stage = "subclips";
    const subNames = [];
    try {
      project.lockedAccess(() => {
        project.executeTransaction((cp) => {
          for (let i = 0; i < cuts.length; i++) {
            const item = gathered[i];
            if (!item) { notes.push("sin item: " + cuts[i].clip); continue; }
            const clip = ppro.ClipProjectItem.cast(item);
            const nm = "CAI_" + String(i + 1).padStart(3, "0") + "_" + cuts[i].clip.replace(/\.[^.]+$/, "");
            cp.addAction(clip.createSubClipAction(nm, T(cuts[i].start), T(cuts[i].end), true, { takeVideo: true, takeAudio: true }));
            subNames.push(nm);
          }
        }, "CortesAI subclips");
      });
    } catch (e) { notes.push("subTx: " + ((e && e.message) ? e.message : String(e))); }

    // 5) Localizar subclips y armar la secuencia (pegados, sin huecos)
    setSt("5/5 Armando secuencia…");
    stage = "findSubs";
    let subByName = {};
    for (let attempt = 0; attempt < 15; attempt++) {
      const all = await collectAllItems(await project.getRootItem(), []);
      subByName = {};
      for (const it of all) { let nm = null; try { nm = it.name; } catch (e) {} if (nm) subByName[nm] = it; }
      if (subNames.length && subNames.every(n => subByName[n])) break;
      await wait(300);
    }
    const subItems = subNames.map(n => subByName[n]).filter(Boolean).map(it => ppro.ClipProjectItem.cast(it));

    stage = "createSequence";
    let media = subItems, trimmed = true;
    if (!subItems.length) {  // respaldo: clips completos si el recorte falló
      trimmed = false;
      media = gathered.filter(Boolean).map(it => ppro.ClipProjectItem.cast(it));
    }
    const seq = await project.createSequenceFromMedia(seqName, media);
    if (!seq) throw new Error("createSequenceFromMedia vacío (media=" + media.length + ", nota=" + (notes[0] || "-") + ")");
    try { await project.openSequence(seq); } catch (e) {}

    let placed = "?";
    try { const vt = await seq.getVideoTrack(0); let tis; try { tis = await vt.getTrackItems(1, false); } catch (e) { tis = await vt.getTrackItems(); } placed = (tis && tis.length != null) ? String(tis.length) : "?"; } catch (e) {}

    const resumen = "Secuencia · " + placed + " clips · " + (trimmed ? "recortados, sin huecos" : "completos (respaldo)") +
          (notes.length ? (" · nota: " + notes[0]) : "");
    setSt("✅ " + resumen);
    try { await fetch(ENGINE + "/log", { method: "POST", headers: { "Content-Type": "text/plain" },
      body: "CONSTRUIR\n" + resumen + (notes.length ? ("\n" + notes.slice(0, 3).join("\n")) : "") }); } catch (e) {}
  } catch (err) {
    setSt("Error en [" + stage + "]: " + ((err && err.message) ? err.message : String(err)));
  } finally {
    $("btnBuild").disabled = false;
  }
}

// Genera un script ExtendScript (.jsx) que arma el timeline recortado de forma confiable
async function generateJsx() {
  const st = $("jsxStatus");
  const setJ = (t) => { st.textContent = t; };
  if (!lastMontage || !lastMontage.cuts.length) { setJ("No hay montaje para generar el script."); return; }

  // 1 corte por nombre de video (sin duplicados)
  const seen = {}, cuts = [];
  lastMontage.cuts.forEach(c => {
    const k = normName(c.clip);
    if (seen[k]) return; seen[k] = true;
    cuts.push({ file: c.clip, inSec: +(+c.start).toFixed(2), outSec: +(+c.end).toFixed(2) });
  });

  $("btnJsx").disabled = true;
  try {
    setJ("Generando script…");
    const r = await fetch(ENGINE + "/jsx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: lastMontage.folder, cuts: cuts, seqName: "CortesAI " + (lastMontage.name || "") })
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || ("motor respondió " + r.status));
    setJ("✅ Script creado (" + cuts.length + " cortes):\n" + data.path +
         "\n\nEn Premiere:\nArchivo → Comandos/Scripts → Ejecutar archivo de script → elige ese .jsx\n(Debe tener un proyecto abierto.)");
  } catch (e) {
    setJ("Error: " + ((e && e.message) ? e.message : String(e)) + "\n(¿El motor local está corriendo?)");
  } finally {
    $("btnJsx").disabled = false;
  }
}

// ---------- Eventos ----------
function toggleApiKey(){
  const isApi = document.querySelector('input[name="transcribe"]:checked').value === "api";
  $("apiKeyRow").classList.toggle("hidden", !isApi);
}
function toggleVision(){
  const on = document.querySelector('input[name="vision"]:checked').value === "on";
  $("geminiKeyRow").classList.toggle("hidden", !on);
}
function bind() {
  $("btnPickFolder").addEventListener("click", pickFolder);
  $("videoType").addEventListener("change", updateTypeDesc);
  $("duration").addEventListener("change", () => { $("durationCustom").classList.toggle("hidden", $("duration").value!=="custom"); });
  document.querySelectorAll('input[name="transcribe"]').forEach(r => r.addEventListener("change", toggleApiKey));
  document.querySelectorAll('input[name="vision"]').forEach(r => r.addEventListener("change", toggleVision));
  $("btnStart").addEventListener("click", start);
  $("btnCancel").addEventListener("click", ()=>{ cancelRequested = true; hideProgressError(); showView("config"); });
  $("btnBuild").addEventListener("click", buildTimeline);
  $("btnNew").addEventListener("click", ()=> { $("buildStatus").textContent = ""; showView("config"); });
}

// ---------- Arranque ----------
(async function init(){
  bind();
  await loadProfiles();
  const saved = localStorage.getItem("groqKey");
  if (saved) $("apiKey").value = saved;
  const savedGem = localStorage.getItem("geminiKey");
  if (savedGem) $("geminiKey").value = savedGem;
  if (localStorage.getItem("visionOn") === "1") {
    const on = document.querySelector('input[name="vision"][value="on"]');
    if (on) on.checked = true;
  }
  toggleApiKey();
  toggleVision();
  showView("config");
  refreshEngineStatus();
  setInterval(refreshEngineStatus, 5000);   // mantiene el estado del motor al día
})();
