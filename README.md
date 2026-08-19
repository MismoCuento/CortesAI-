# CortesAI

**Edición automática por tipo de video para Adobe Premiere Pro 2026 (UXP).**

CortesAI es una extensión (panel UXP) para Premiere Pro que toma una carpeta de videos y un tipo de contenido (reel, deportivo, educativo, político, anuncios, ecommerce, entrevista…), analiza lo más importante (audio + visión), calcula los cortes, los organiza (Hook → Gancho → Cuerpo → CTA) y entrega una secuencia editada en el timeline.

## Estructura del repositorio

```
.
├── docs/        · Documentación completa del proyecto (16 documentos)
├── plugin/      · Código del panel UXP (Fase 1: interfaz)
│   ├── manifest.json
│   ├── index.html · styles.css · index.js
│   └── profiles/  · perfiles por tipo de video (editables)
└── README.md
```

## Empezar

- **Documentación:** abre [`docs/README.md`](docs/README.md) — es el índice de todo el diseño.
- **Instalar el panel (Fase 1):** ver [`plugin/INSTALAR.md`](plugin/INSTALAR.md).

## Estado

- ✅ Fase 0 — Documentación
- 🟡 Fase 1 — Panel + interfaz (construida)
- ⚪ Fase 2 — Motor de análisis (transcripción + IA)
- ⚪ Fase 3 — Cortes en el timeline
- ⚪ Fase 4+ — Análisis visual, estructura narrativa, empaquetado

Ver el plan completo en [`docs/07-roadmap.md`](docs/07-roadmap.md).

## Tecnología

Panel UXP (HTML/CSS/JavaScript) + `@adobe/premierepro`. Motor con Node.js + FFmpeg; transcripción local (Whisper) o por API. Ver [`docs/13-lenguajes-y-stack.md`](docs/13-lenguajes-y-stack.md).

---

Objetivo: Adobe Premiere Pro **26.3.2** · macOS y Windows.
