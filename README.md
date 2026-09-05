# Urban Scratch-off

Test it here [http://chriswhong.github.io/urbanscratchoff/](http://chriswhong.github.io/urbanscratchoff/)

## Development

This is a [Vite](https://vitejs.dev/) app.

```
npm install
npm run dev      # local dev server with hot reload
npm run build    # production build, output to dist/
npm run preview  # serve the production build locally
```

Source lives under `src/`:

- `main.js` -- entry point, wires everything together
- `constants.js` -- shared tuning constants
- `scratchLayer.js` -- the custom WebGL layer that renders and erases the scratchable top imagery
- `border.js` / `workers/borderWorker.js` -- the vector "torn edge" border tracing the scratched area, computed off the main thread
- `labels.js` -- place/street labels from OpenFreeMap vector tiles
- `mapLayers.js` -- wires the raster layers, scratch layer, border, and labels together, and handles swapping them
- `interaction.js` -- drag-to-scratch and pan-modifier input handling
- `ui.js` -- sidebar/navbar DOM wiring (jQuery + Bootstrap)

## About

Near where I live in Brooklyn, the BQE runs through a trench in the ground. I've always read and heard about the condemned buildings and displaced people that used to live where our urban highways run, so I thought it would be a good visual to allow the user to manually "Reveal" the urban highway by "Scratching" or mousing over a historic aerial photo.

### Methodology

Thanks to Dave Riordan for pointing me to [NYPL Mapwarper](http://maps.nypl.org/warper/), where I was able to rectify a 1924 aerial photo of Brooklyn.

Once I had the rectified png and a KML file with the bounds of the image, I needed to get it into a canvas overlay in leaflet.

[Leaflet.CanvasLayer](https://github.com/CartoDB/Leaflet.CanvasLayer) plugin adds a canvas overlay to a leaflet map, and gives you the bounds of the current view to use when transforming whatever you are going to render.

Code below is basically an adaptation of leaflet's native `imageOverlay` method, providing a size and offset based on the current map view. These are passed into canvas `drawImage()` to draw the overlay from the png.

```
function drawingOnCanvas(canvasOverlay, params) {
          var ctx = params.canvas.getContext('2d');

          ctx.fillCircle = fillCircle;


          ctx.clearRect(0, 0, params.canvas.width, params.canvas.height);

          var bounds = new L.Bounds(
            map.latLngToContainerPoint(imgBounds.getNorthWest()),
            map.latLngToContainerPoint(imgBounds.getSouthEast()));

          var size = bounds.getSize();

          ctx.drawImage(img,bounds.min.x,bounds.min.y,size.x,size.y);
}
```

"erasing" parts of the canvas overlay is done by setting a circle under the mouse to trasnparent, [this process.](http://jsfiddle.net/ArtBIT/WUXDb/1/)

## TODO

- I would like to make this a "story" platform where people can highlight areas of the city that are interesting scratch-offs". Immindent domain, transit projects, landfill development, etc all make for interesting changes to explore.
- Vector Overlays - User could add vector overlays to an area, saying "scratch here to reveal an urban highway" or whatever, with a blurb or narrative about the history of what they are highlighting.
