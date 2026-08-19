# 01 · Visión y alcance

## El problema

Editar video en bruto consume horas: hay que ver todo el material, identificar los momentos buenos, descartar silencios/errores y armar un primer montaje antes siquiera de empezar el trabajo creativo fino. Ese "primer corte" es repetitivo y mecánico.

## La solución

**CorteIA** automatiza ese primer montaje. El editor:

1. Le indica una **carpeta** con los videos.
2. Elige el **tipo de contenido** (reel, política, deporte, ecommerce, entrevista…).
3. Pulsa **Iniciar**.

La herramienta analiza el material, decide qué es lo importante **según el tipo de video**, calcula los cortes y deja una **secuencia editada lista para refinar** en el timeline de Premiere.

## Qué hace (v1)

- ✅ Lee todos los videos de una carpeta.
- ✅ Extrae el audio y lo **transcribe** (local gratis o por API).
- ✅ Detecta **silencios y pausas largas** para eliminarlos.
- ✅ Aplica un **perfil de corte** según el tipo de video elegido.
- ✅ Permite **elegir la duración** del video final (15s, 30s, 60s, personalizada o automática) y ajusta los cortes a ese objetivo.
- ✅ Permite **elegir el formato** (9:16, 16:9, 1:1, 4:5 u original) con **reencuadre automático** del sujeto.
- ✅ Usa **IA** para puntuar y seleccionar los segmentos más relevantes.
- ✅ Construye la **secuencia con los cortes** directamente en Premiere.
- ✅ Muestra **progreso** y un **resumen** de lo que hizo.

## Qué NO hace (en v1 — para no sobre-prometer)

- ❌ No hace color grading, música, transiciones creativas ni motion graphics.
- ❌ No decide el orden narrativo "perfecto"; entrega un **rough cut** que tú refinas.
- ❌ No sube nada a redes ni exporta el video final (se queda en el timeline).
- ❌ No reconoce caras/personas específicas (posible en fases futuras).

> **Principio clave:** CorteIA es un **asistente que te ahorra el 80% del trabajo mecánico**, no un reemplazo del editor. La última palabra siempre es tuya, sobre un timeline que puedes ajustar.

## Usuarios objetivo

- Editores y creadores de contenido que procesan **mucho material repetitivo**.
- Equipos de social media (reels, ecommerce) que necesitan **velocidad**.
- Periodistas / equipos políticos que arman piezas a partir de **declaraciones**.

## Criterios de éxito

| Métrica | Meta v1 |
|---------|---------|
| Tiempo de "material bruto → rough cut" | Reducirlo **≥70%** |
| Precisión de la transcripción (ES/EN) | Usable sin corrección mayor |
| Cortes útiles vs. cortes descartados por el editor | Mayoría aprovechables |
| Que el timeline abra sin errores en Premiere 26.3.2 | 100% |

## Alcance de plataformas e idiomas

- **Plataformas:** macOS y Windows (mismo código UXP, empaquetado por SO).
- **Idiomas de transcripción:**
  - **Prioridad 1:** Español e Inglés.
  - **Deseables:** Alemán y Francés (se activan si el motor los soporta con calidad suficiente; si no, quedan para una fase posterior).
