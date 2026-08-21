# CortesAI · Estado del proyecto

_Actualizado: 2026-08-21 · Panel v0.9.0 · Motor v0.6.7_

## 🎯 Resumen
CortesAI ya es una **herramienta usable de verdad**: eliges una carpeta de videos, un tipo y una duración, y en **un clic dentro de Premiere** obtienes una **secuencia editada** (clips recortados 2-6s, pegados sin huecos, en el formato elegido). Gratis (Groq) o 100% local.

---

## ✅ Fases completadas

| Fase | Estado | Qué hace |
|------|--------|----------|
| **0 · Documentación** | ✅ | 16 documentos de diseño en `docs/` |
| **1 · Panel UXP** | ✅ | Interfaz dentro de Premiere 26 (carpeta, tipo, duración, formato, idioma). Con colores y scroll. |
| **2 · Motor de análisis** | ✅ | Node local + FFmpeg + Groq: transcribe (Whisper) y analiza con IA (modelo grande `gpt-oss-120b`, gratis) |
| **3 · Timeline real** | ✅ | Crea la secuencia y coloca los cortes **recortados 2-6s, pegados, sin huecos**, en un clic |
| **4 · Análisis visual (básico)** | 🟡 | Detección de escenas (FFmpeg) para video sin diálogo. Falta la **visión IA** real. |

## ✅ Logros clave (lo que funciona hoy)
- 🎬 **Flujo completo en 1 clic** dentro de Premiere (sin salir, sin importar).
- 🧠 **Análisis inteligente por tipo de video** (perfiles: anuncios, deporte, educativo, etc.) con criterio multimodal.
- 🗣️ **Captura el habla**: transcribe y elige el mejor momento hablado; el diálogo pesa más que una toma genérica.
- ✂️ **Cortes 2-6s**, sin repetir tomas, estructura **Hook → Cuerpo → CTA**.
- 📏 **Rellena la duración objetivo** (~60s) combinando lo mejor de varios videos.
- 🖼️ **Formato 9:16 / 16:9 / 1:1 / 4:5**.
- 🔒 **Modo Local (gratis, privado, offline)** y **Modo API (Groq, gratis, mejor calidad)**.
- ⚙️ **Motor se inicia solo** desde el panel.
- 🎨 Interfaz con **colores y scroll**.
- 🐙 Todo en **GitHub** con actualización de 1 comando.

---

## ⏳ Lo que falta / por mejorar (priorizado)

| Prioridad | Mejora | Qué aporta |
|-----------|--------|-----------|
| ⭐⭐⭐ | **👁️ Visión IA** (frames → modelo de visión, ej. Gemini gratis) | Elegir el mejor momento por **lo que se VE** (caras, acción, gente, producto, texto en pantalla), no por cambio de escena. **El mayor salto para contenido visual.** |
| ⭐⭐⭐ | **🎬 "Director"** (pasada global de IA) | Ordena la secuencia final y hace una **2ª pasada** (continuidad, ritmo, hook). Tu brief completo. |
| ⭐⭐ | **💬 Subtítulos automáticos** | Genera subtítulos desde la transcripción (clave para social) |
| ⭐⭐ | **✂️ Quitar silencios/muletillas** dentro de cada clip | Cortes más limpios en video hablado |
| ⭐⭐ | **🖼️ Auto-reframe con caras** | Reencuadre inteligente al pasar a 9:16 manteniendo al sujeto |
| ⭐ | **🗣️ Whisper local** (habla sin API) | Transcripción local para modo 100% offline con audio |
| ⭐ | **📦 Instalador `.ccx` de un clic** | Compartir con colegas sin UXP Developer Tool ni Terminal |
| ⭐ | **🎞️ Multi-formato en un clic** | Generar 9:16 + 1:1 + 16:9 del mismo montaje |

## 🧭 Ruta sugerida
1. **Visión IA (Gemini gratis)** — el salto grande de calidad para tus videos.
2. **"Director"** — orden narrativo + 2ª pasada.
3. Subtítulos → auto-reframe → quitar silencios.
4. Empaquetado `.ccx` para compartir fácil.

## ⚠️ Notas honestas
- La **visión** hoy es solo detección de escenas; "qué se ve" real necesita el modelo de visión (próximo paso).
- ExtendScript quedó descartado (Premiere 26 no lo corre fácil); todo se hace vía UXP (`lockedAccess`).
- La calidad depende del modelo: hoy Groq `gpt-oss-120b` (gratis). Claude/GPT (pago) darían un plus opcional.
