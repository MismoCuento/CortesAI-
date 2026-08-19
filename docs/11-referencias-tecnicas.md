# 11 · Referencias técnicas (hallazgos verificados)

Notas de investigación sobre la extensibilidad de Premiere Pro 26.x, para fundamentar las decisiones de construcción. Fecha de investigación: **2026-08-19**.

## UXP es el estándar (CEP obsoleto)

- Desde **Premiere 25.6**, CEP quedó **superado por UXP**. Adobe mantiene ambos ~1 año más y luego **elimina CEP**.
- Recomendación oficial: *"If you are starting new development, start in UXP."*
- **Conclusión para CorteIA:** construir en **UXP**.

## Paquete y estructura del plugin UXP

- Paquete oficial: **`@adobe/premierepro`** (npm), con **tipos TypeScript**. Versión de referencia en samples: `^26.5.0-beta.73`.
- Estructura mínima de un plugin:
  - `manifest.json` — identidad, permisos, dónde aparece el panel.
  - `index.html` — interfaz (usa componentes Spectrum `sp-*`: `sp-button`, `sp-body`, etc.).
  - `index.js` / TypeScript — lógica.
- Flujo de desarrollo: **UXP Developer Tool** (UDT) → Add Plugin → Load → Watch (hot-reload).
- **Importante:** en UXP las llamadas a la API son **asíncronas** y **no bloquean** la UI (en CEP/ExtendScript eran síncronas y congelaban Premiere).

## APIs UXP relevantes (del sample oficial `premiere-api`)

El panel de referencia `premiere-api` ejercita:
- **Projects** y **Sequences** (crear, leer).
- **Timeline:** insertar/overwrite/append de clips; **in/out points**.
- **Markers** (marcadores — los usaremos para las secciones Hook/Gancho/Cuerpo/CTA).
- **Metadata** de clips.
- **Effects, transitions, keyframes**.
- **Source monitor**.
- **Import/Export** y **Encoder**.
- **Transcripts** (transcripciones/subtítulos — Premiere tiene STT nativo, opción extra de transcripción).
- Conversión de proyecto: **AAF, FCPXML, OTIO** (¡útil! podríamos generar FCPXML como plan B para el timeline).

## Frames / imagen

- Premiere expone **`exportFramePng`** (desde 25.3+) para exportar un frame a PNG. Bien para **thumbnails/previews**, no para escanear miles de frames.
- Para análisis visual a escala → **FFmpeg** (detección de escenas + muestreo) + **modelo de visión**. Ver [09 · Análisis visual](./09-analisis-visual.md).

## Permisos del manifest que necesitaremos

| Permiso | Para qué |
|---------|----------|
| `localFileSystem` | Leer la carpeta de videos, escribir temporales |
| `launchProcess` | Ejecutar FFmpeg / Whisper / motor local |
| `network` | Modo API (transcripción / IA / visión) |

> El sample `oauth-workflow-sample` demuestra `network` + `launchProcess` y un broker Node.js — patrón reutilizable para llamadas externas seguras.

## Sobre ukramedia (recurso de aprendizaje)

- Canal de **Sergei Prokhnevskiy** (ukramedia). Fuerte en **expresiones de After Effects** y en construir **extensiones CEP** (puente **CSInterface** + **ExtendScript**).
- Es material **era-CEP**: los conceptos (panel HTML/JS ↔ host) son válidos, pero la implementación concreta (CSInterface, ExtendScript síncrono) **no aplica a UXP**. Se usa como referencia conceptual, no como código a copiar.

## Fuentes

- UXP Premiere plugins (Adobe): https://developer.adobe.com/premiere-pro/uxp/plugins/
- Referencia de API UXP: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- Samples UXP oficiales: https://github.com/AdobeDocs/uxp-premiere-pro-samples
- PProPanel (CEP, legacy): https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/ReadMe.md
- UXP en Premiere 2026 (Hyper Brew): https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/
- Building Adobe Extensions (Hyper Brew): https://hyperbrew.co/blog/building-adobe-extensions/
