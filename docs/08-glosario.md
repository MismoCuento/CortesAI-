# 08 · Glosario

Términos técnicos explicados en simple.

| Término | Qué significa |
|---------|---------------|
| **UXP** | *Unified Extensibility Platform.* La tecnología oficial de Adobe (desde Premiere 2026) para crear paneles/plugins con HTML, CSS y JavaScript. Reemplaza a CEP. |
| **CEP** | *Common Extensibility Platform.* La tecnología **antigua** de paneles de Adobe. Quedó obsoleta en Premiere 2026; por eso NO la usamos. |
| **Panel / Extensión** | La ventana de la herramienta dentro de Premiere (como el panel de Efectos o Proyecto). |
| **`@adobe/premierepro`** | Librería oficial de Adobe (vía npm) que permite al panel controlar Premiere: crear secuencias, importar clips, insertar cortes. |
| **`manifest.json`** | Archivo que describe el plugin UXP (nombre, permisos, dónde aparece). Es la "identidad" del panel. |
| **FFmpeg** | Herramienta libre para procesar audio/video. Aquí extrae el audio y mide silencios/volumen. |
| **Whisper** | Modelo de IA (open source, de OpenAI) que convierte voz en texto. Es la opción de transcripción **local y gratis**. |
| **Transcripción** | Convertir el audio hablado en texto, con marcas de tiempo (cuándo se dice cada cosa). |
| **LLM** | *Large Language Model.* Modelo de IA que "entiende" texto. Aquí decide qué segmentos son importantes según el tipo de video. |
| **Perfil (de video)** | Conjunto de reglas de corte para un tipo de contenido (reel, política, deporte…). Editable sin programar. |
| **Scoring / puntaje** | Nota de 0 a 1 que la IA da a cada segmento según su importancia. |
| **Segmento** | Un trozo de video entre un tiempo de inicio y uno de fin. |
| **Corte** | Un segmento que se decide **conservar** en la edición final. |
| **EDL** | *Edit Decision List.* Lista de decisiones de edición (qué clip, desde dónde, hasta dónde). Es el "plano" de la secuencia. |
| **Rough cut** | Primer montaje aproximado. Lo que entrega CorteIA para que tú lo refines. |
| **Timeline / Secuencia** | La línea de tiempo de Premiere donde se arma la edición. |
| **`.ccx`** | Formato de archivo para instalar extensiones de Adobe con doble clic. |
| **UXP Developer Tool (UDT)** | App de Adobe para cargar y probar el panel durante el desarrollo, sin empaquetarlo. |
| **API (modo de transcripción/IA)** | Usar un servicio externo por internet (más rápido/preciso, con costo y API key), en vez de correr todo local. |
| **API key** | Clave secreta que autoriza el uso de un servicio por API. |
| **Diarización** | Distinguir quién habla (hablante 1, hablante 2…). Idea para fases futuras. |
| **RMS / picos de audio** | Medida del volumen. Útil para detectar momentos de acción o energía (ej. deporte). |
| **Modelo de visión (multimodal)** | IA que "mira" imágenes y las describe/puntúa. Aquí evalúa la calidad e impacto de cada frame. |
| **Detección de escenas** | Encontrar dónde cambia el plano en un video. FFmpeg lo hace; sirve para cortar en límites naturales. |
| **`exportFramePng`** | Función de Premiere (UXP) que exporta un frame concreto a PNG. Se usa para thumbnails/previews. |
| **OCR** | *Optical Character Recognition.* Leer el texto que aparece en pantalla (rótulos, precios, CTAs). |
| **Hook visual** | El frame/plano de apertura que "frena el scroll" en los primeros segundos. |
| **CTA** | *Call To Action.* Llamado a la acción (suscríbete, compra, link abajo). |
| **FCPXML / AAF / OTIO** | Formatos de intercambio de edición. Premiere UXP puede convertirlos; posible plan B para generar el timeline. |
