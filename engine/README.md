# CortesAI · Motor local

Este programita corre en tu Mac y hace lo que el panel de Premiere no puede: extraer el audio con **FFmpeg** (cualquier peso de video) y llamar a **Groq** para transcribir y calcular los cortes. El panel se conecta a `http://localhost:8765`.

## Requisitos (instalar una vez)

### 1. Node.js 18 o superior
Descárgalo de **https://nodejs.org** (versión **LTS**) e instálalo.
Verifica en Terminal: `node --version` (debe decir v18 o más).

### 2. FFmpeg
- **Mac (con Homebrew):**
  ```bash
  brew install ffmpeg
  ```
  Si no tienes Homebrew, instálalo desde **https://brew.sh** y luego corre el comando de arriba.
- **Windows:** descarga FFmpeg desde https://ffmpeg.org/download.html y añádelo al PATH.

## Iniciar el motor

- **Mac:** doble clic en **`start-mac.command`**
  *(La primera vez, si macOS lo bloquea: clic derecho → Abrir → Abrir.)*
- **Windows:** doble clic en **`start-windows.bat`**
- **O desde Terminal:** `node server.js`

Verás algo como:
```
 CortesAI · Motor local en marcha
 URL:    http://localhost:8765
 FFmpeg: /opt/homebrew/bin/ffmpeg
```

**Deja esa ventana abierta** mientras usas el panel en Premiere. Para detenerlo, cierra la ventana o pulsa `Ctrl + C`.

## Cómo funciona

```
Panel (Premiere)  →  http://localhost:8765/process  →  FFmpeg (audio) → Groq (transcribe + analiza) → cortes
```

- No hay límite de tamaño de video (FFmpeg saca solo el audio, que es pequeño).
- Tu API key viaja del panel al motor **en tu propia máquina** (localhost); no se guarda en el código.

## Endpoints (para referencia técnica)

- `GET /health` → `{ ok, ffmpeg, version }`
- `POST /process` → body `{ folderPath, settings:{apiKey,language,duration,videoType,...}, profile }` → `{ cuts, video, language, duration, ... }`

## Problemas comunes

| Síntoma | Solución |
|---------|----------|
| "FFmpeg no está instalado" | `brew install ffmpeg` (Mac) |
| "command not found: node" | Instala Node.js LTS desde nodejs.org |
| El panel dice "motor no conectado" | Asegúrate de que esta ventana esté abierta y corriendo |
| macOS bloquea el .command | Clic derecho → Abrir → Abrir |
