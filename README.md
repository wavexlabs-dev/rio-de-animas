# Río de Ánimas

Un río de Día de Muertos en 3D que corre en tiempo real en el navegador. Una trajinera remonta el valle a golpe de garrocha: pasa por el embarcadero del pueblo, las catrinas de cartonería, el panteón y el lirio acuático, hasta la cañada y la cascada. El día avanza hacia la noche, cuando se encienden las veladoras y salen las ánimas, y vuelve a amanecer antes de la tormenta.

El recorrido cuenta el Día de Muertos en tres actos: por la tarde los vivos preparan (una ofrenda, una niña que marca el camino con pétalos de cempasúchil), de noche los muertos llegan de visita (las campanas, la tumba de una familia) y al amanecer se vuelven mariposas monarca que suben por la cascada. Las ánimas que el visitante junta en el camino son las que suben al final.

Hecho con [three.js](https://threejs.org) y un pipeline de post-proceso propio (HDR, bloom, rayos de luz, FXAA). La página no lleva texto: solo un cargador gráfico de cempasúchil y, la primera vez, una mano que indica dónde tocar.

## Controles

| Acción | Cómo |
| --- | --- |
| Remar / girar (sin tocar nada va en piloto automático) | `W` `A` `S` `D` o flechas |
| Adelantar el tiempo (mientras la mantienes) | `Espacio` |
| Silenciar / activar sonido | `M` |
| Mirar alrededor | Arrastrar con el mouse o el dedo |
| Poner una veladora en el río (de ella sale un ánima que acompaña a la trajinera) | Clic o toque sobre el agua |
| Activar lo que brilla en las orillas (ofrenda, niña con pétalos, campanas, alebrijes, tumba, árbol de monarcas) | Clic o toque |

El audio empieza con la primera interacción, como piden los navegadores.

## Correrlo en local

Necesitas Node 20 o más reciente.

```bash
npm install
npm run build      # genera public/ (index.html + assets/)
npm run serve      # http://localhost:8080
```

`npm run build:all` además genera en `dist/` una versión de un solo archivo (`dist/index.html`, ~30 MB, con todo embebido) que abre sin servidor.

## Publicación

Vercel construye el sitio en cada push a `main` con la configuración de `vercel.json`: corre `npm run build` y publica la carpeta `public/`. `netlify.toml` deja lista la misma configuración por si algún día se mueve a Netlify.

## Estructura

- `src/`: la escena. `world.js` arma todo y dibuja cada cuadro; `story.js` las escenas de las orillas, las veladoras y las ánimas que acompañan a la trajinera; `water.js` es el shader del río; `boat.js` la trajinera y el trajinero; `sky.js` y `timeofday.js` el ciclo de día, tormenta y noche; `post.js` el post-proceso.
- `tex/final/`: texturas ya procesadas (WebP). `tex/*.py` son los scripts que las generaron, incluidos los mapas normales FFT del agua (`waterfft.py`).
- `tex/models/`: modelos optimizados (mallas en `.bin` con LODs, texturas en WebP). Salen de `tools/models.mjs`, que toma los modelos originales de una carpeta `ph/` que no está en el repo.
- `tools/`: utilidades de desarrollo (capturas, perfiles, conteo de triángulos) con Playwright.

## Créditos

- Modelos 3D escaneados y texturas: [Poly Haven](https://polyhaven.com) (CC0).
- La Catrina, el Catrín, el alebrije, el trajinero y la textura de lirio se generaron con IA en Figma Weave (GPT Image y Rodin).
- Todo lo demás (terreno, arquitectura, vegetación procedural, agua, cielo, audio) es código de este repo.
