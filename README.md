# Mi Launcher

Launcher de Minecraft 1.21.1 con Fabric.

## Primera vez (o si algo no funciona después de actualizar)
    npm install minecraft-launcher-core msmc
    npm install --save-dev electron electron-builder

## Probar sin generar el .exe
    npm start

## Generar el .exe
    npm run build
Los archivos quedan en la carpeta `dist` (instalador y versión portable).

## Poner la fuente (Fixedsys)
1. Descomprime el zip de la fuente.
2. Dentro busca el archivo .ttf (en Fixedsys Excelsior suele llamarse FSEX302.ttf).
3. Cópialo a la carpeta `renderer/assets/fonts/` de este proyecto.
4. Cámbiale el nombre a `fixedsys.ttf` (exactamente así, en minúsculas).
5. Ejecuta `npm start` para verla. Para el .exe, vuelve a ejecutar `npm run build`.
(También funcionan `fixedsys.otf` y `fixedsys.woff2`.)

## Cambiar cómo se ve
- Título, subtítulo y color principal: `config.js` (sección `branding`).
- Colores, bordes y tamaños: `renderer/style.css` (bloque "AJUSTES RÁPIDOS" arriba).
- Botón Jugar: imagen `renderer/assets/ui/btn-play.png` (52x24 px, se estira por el centro).
- Botones de la barra lateral: imagen `renderer/assets/ui/btn-nav.png` (52x24 px).
- Fondo propio: guarda una captura como `renderer/assets/background.jpg` (reemplaza la escena animada).
- Logo (opcional): `renderer/assets/logo.png`.
- Icono del .exe: `build/icon.ico` (256x256).

## Skin y capa
- La barra lateral muestra un busto 3D estático de tu skin.
- Click en el busto = panel para cambiar skin (PNG 64x64) y capa. En el panel, "Frente / Espalda" muestra tu capa.
- Ya no se necesita la librería `skinview3d` (puedes quitarla con: npm uninstall skinview3d).
