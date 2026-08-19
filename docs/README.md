# CorteIA — Extensión de edición automática para Premiere Pro

> Panel dentro de Premiere Pro que, a partir de una carpeta de videos y un **tipo de contenido** (reel, política, deporte, ecommerce…), analiza lo más importante, calcula los cortes y entrega una **secuencia ya editada** en tu línea de tiempo.

---

## 📑 Índice de la documentación

| Documento | De qué trata |
|-----------|--------------|
| [01 · Visión y alcance](./01-vision-y-alcance.md) | Qué problema resuelve, qué hace y qué NO hace (v1) |
| [02 · Arquitectura técnica](./02-arquitectura-tecnica.md) | UXP, backend, FFmpeg, transcripción, cómo se conecta todo |
| [03 · Perfiles de video](./03-perfiles-de-video.md) | Reglas de corte por tipo de contenido (el "cerebro") |
| [04 · Flujo de usuario](./04-flujo-de-usuario.md) | Pantallas, botones y experiencia paso a paso |
| [05 · Transcripción y análisis IA](./05-transcripcion-y-analisis.md) | Modo local gratis vs API, idiomas, cómo se decide lo importante |
| [06 · Instalación (Mac y Windows)](./06-instalacion.md) | Requisitos y pasos para instalar el panel |
| [07 · Roadmap y fases](./07-roadmap.md) | En qué orden se construye, hito por hito |
| [08 · Glosario](./08-glosario.md) | Términos técnicos explicados en simple |
| [09 · Análisis visual (frame a frame)](./09-analisis-visual.md) | El "ojo" de la herramienta: mejor gancho visual, cortes limpios |
| [10 · Estructura narrativa](./10-estructura-narrativa.md) | Hook → Gancho → Cuerpo → CTA |
| [11 · Referencias técnicas](./11-referencias-tecnicas.md) | Hallazgos verificados de APIs UXP + fuentes |
| [12 · Funciones plus](./12-funciones-plus.md) | Valor agregado: subtítulos, reencuadre, multi-formato… |
| [13 · Lenguajes y stack](./13-lenguajes-y-stack.md) | Qué lenguajes se usan (HTML/CSS/JS/TS, Node, Python) |
| [14 · Guía VS Code paso a paso](./14-guia-vscode-paso-a-paso.md) | Instalar todo y ejecutar, para no-programadores |
| [15 · Cómo trabajamos juntos](./15-como-trabajamos-juntos.md) | Modelo de colaboración y tema del acceso a tu PC |

---

## 🎯 Resumen en una frase

**CorteIA** convierte material en bruto en un primer montaje ("rough cut") automático dentro de Premiere Pro, adaptando los criterios de corte al tipo de video que estás editando.

## ⚙️ Datos base del proyecto

| Dato | Valor |
|------|-------|
| **App objetivo** | Adobe Premiere Pro **26.3.2** (Premiere 2026) |
| **Tecnología del panel** | **UXP** (Unified Extensibility Platform) — estándar en Premiere 2026 |
| **Plataformas** | macOS y Windows |
| **Transcripción** | Local (gratis) **o** por API — elegible por el usuario |
| **Análisis** | Audio + texto **+ visión (frame a frame)** |
| **Estructura** | Organiza en Hook → Gancho → Cuerpo → CTA |
| **Duración final** | Elegible por el usuario (15s / 30s / 60s / personalizada / auto) |
| **Formato** | Elegible: 9:16, 16:9, 1:1, 4:5 u original (con reencuadre automático) |
| **Idiomas** | Español e Inglés (objetivo principal) · Alemán y Francés (deseables) |
| **Entrega final** | Secuencia editada en el timeline de Premiere |

## 🚦 Estado actual

- ✅ Documentación de diseño (este set)
- ⬜ Aprobación del diseño por el usuario
- ⬜ Prototipo del panel UXP (UI + botón iniciar)
- ⬜ Motor de transcripción + análisis
- ⬜ Generación de cortes en el timeline
- ⬜ Empaquetado e instalación (Mac/Win)

> Ver detalle en [07 · Roadmap y fases](./07-roadmap.md).
