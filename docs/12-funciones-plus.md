# 12 · Funciones "plus" (valor agregado)

Más allá de lo esencial (elegir carpeta, duración, formato, tipo → cortar y organizar), estas funciones hacen a CorteIA notablemente más útil. Se priorizan por fase (ver [07 · Roadmap](./07-roadmap.md)).

## Incluidas en el plan v1

| Función | Qué aporta | Se apoya en |
|---------|-----------|-------------|
| 🖼️ **Reencuadre automático** al formato (9:16, 1:1…) | Adapta material horizontal a vertical manteniendo al sujeto centrado | Análisis visual (caras/movimiento) |
| ⏱️ **Ajuste a duración objetivo** | Entrega el video en la duración pedida priorizando lo mejor | Planificador + scoring |
| 🧩 **Estructura Hook → Gancho → Cuerpo → CTA** | Montaje que retiene y convierte | [10 · Estructura](./10-estructura-narrativa.md) |
| 🎯 **Marcadores de sección** en el timeline | Ves la anatomía del video (🔴🟠🟢🔵) y editas rápido | API de markers UXP |
| 🔇 **Eliminación de silencios/muletillas** | Quita tiempos muertos automáticamente | FFmpeg + transcripción |
| 👁️ **Mejor frame de apertura (hook visual)** | Elige el arranque que frena el scroll | Análisis visual |
| 📝 **Resumen del proceso** | Cuántos cortes, duración, qué se descartó | Reporte final |
| ✅ **Revisar antes de construir** | Apruebas/descartas cortes antes del montaje | Paso opcional en UI |

## Extras de alto valor (recomendados, fase posterior)

| Función | Qué aporta |
|---------|-----------|
| 💬 **Subtítulos automáticos** | Genera subtítulos desde la transcripción (quemados o como pista editable). Clave para social (se ve sin sonido) |
| 🔊 **Normalización de audio (loudness)** | Nivela el volumen para un sonido consistente entre clips |
| 🖼️ **Sugerencia de portada/thumbnail** | Propone el mejor frame como miniatura (`exportFramePng`) |
| 🎞️ **Multi-formato en un clic** | Genera varias secuencias (9:16 + 1:1 + 16:9) del mismo montaje |
| 💾 **Preajustes del usuario** | Guarda "mi carpeta + mi formato + mi tipo favorito" para repetir con un clic |
| 🔁 **Reordenar cortes** (drag & drop) en la revisión | Ajuste manual antes de construir |
| 🗣️ **Detección de hablantes (diarización)** | Distingue quién habla (útil en entrevistas/podcast) |
| 🎵 **Sincronía con música/beats** | Alinea cortes al ritmo de una pista (reels) |
| 🌐 **Presets de exportación por plataforma** | Ajustes listos para TikTok/YouTube/Instagram |

## Ideas exploratorias (futuro lejano)

- **Aprender tu estilo:** ajustar el scoring según qué cortes sueles conservar o descartar.
- **B-roll inteligente:** sugerir dónde insertar planos de apoyo.
- **Detección de logos/marcas** para anuncios.
- **Guiones/hooks sugeridos** por IA a partir del contenido.

## Principio para priorizar

> Primero **lo esencial** funcionando de punta a punta (carpeta → cortes → timeline), luego los "plus" que multipliquen el ahorro de tiempo sin volver la herramienta frágil. Cada extra se activa/desactiva para no saturar la interfaz.
