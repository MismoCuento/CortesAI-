# CortesAI · Instalación de la Fase 1 (panel en Premiere)

> Esta es la **Fase 1**: el panel con su interfaz. Aún **no hace cortes reales** (eso llega en la Fase 2). Sirve para que veas y pruebes la herramienta dentro de tu Premiere.

## Antes de empezar necesitas
- **Premiere Pro 26.3.2** (o 25+).
- **Adobe UXP Developer Tool (UDT)** — gratis, desde la app de Creative Cloud.

*(No necesitas Node.js todavía: esta fase no requiere instalar librerías.)*

## Pasos

### 1. Coloca la carpeta del plugin
Descomprime el ZIP y deja la carpeta `plugin/` (renómbrala si quieres a `CortesAI/`) en un lugar estable, por ejemplo:
```
/Users/mismotion/Documents/CortesAI/Working Directory/plugin/
```

### 2. Abre el UXP Developer Tool
1. Abre **Premiere Pro**.
2. Abre **UXP Developer Tool**.
3. Clic en **Add Plugin**.
4. Selecciona el archivo **`manifest.json`** dentro de la carpeta `plugin/`.

### 3. Carga el panel
1. En la fila de CortesAI, clic en **Load**.
2. En Premiere, ve a **Ventana → Extensiones → CortesAI** (o **Plugins**).
3. El panel aparece. 🎉

### 4. Pruébalo
- Clic en **Elegir** y selecciona una carpeta con videos → verás cuántos detecta.
- Ajusta tipo, duración, formato, idioma.
- Clic en **▶ Iniciar** → verás el flujo con barra de progreso y un resumen.

> En esta fase el progreso es una **simulación** del flujo. La Fase 2 conecta el motor real (FFmpeg + transcripción + IA) que produce los cortes en el timeline.

## Si algo falla
- **No aparece el panel** → confirma que elegiste el `manifest.json` correcto y que Premiere es 25+.
- **Error al cargar** → en UDT clic en **⋯ → View Logs** y **mándame el texto**; te doy el arreglo.
- **El selector de carpeta no abre** → asegúrate de que el panel corre dentro de Premiere (no en un navegador).

## Estructura del proyecto
```
plugin/
├── manifest.json      · identidad y permisos del panel
├── index.html         · interfaz
├── styles.css         · estilos
├── index.js           · lógica de la interfaz
├── package.json       · (para dependencias futuras)
├── icons/             · iconos del panel
└── profiles/          · perfiles por tipo de video (editables)
    ├── reel.json
    ├── deporte.json
    ├── educativo.json
    ├── politico.json
    ├── anuncios.json
    ├── ecommerce.json
    └── entrevista.json
```
