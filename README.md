#Urban Scratch-off

Test it here [http://chriswhong.github.io/urbanscratchoff/](http://chriswhong.github.io/urbanscratchoff/)

##About

Near where I live in Brooklyn, the BQE runs through a trench in the ground.  I've always read and heard about the condemned buildings and displaced people that used to live where our urban highways run, so I thought it would be a good visual to allow the user to manually "Reveal" the urban highway by "Scratching" or mousing over a historic aerial photo.  

###Methodology
Thanks to Dave Riordan for pointing me to [NYPL Mapwarper](http://maps.nypl.org/warper/), where I was able to rectify a 1924 aerial photo of Brooklyn.

Once I had the rectified png and a KML file with the bounds of the image, I needed to get it into a canvas overlay in leaflet.

[Leaflet.CanvasLayer](https://github.com/CartoDB/Leaflet.CanvasLayer) plugin adds a canvas overlay to a leaflet map, and gives you the bounds of the current view to use when transforming whatever you are going to render.

Code below is basically an adaptation of leaflet's native `imageOverlay` method, providing a size and offset based on the current map view.  These are passed into canvas `drawImage()` to draw the overlay from the png.

```
function drawingOnCanvas(canvasOverlay, params) {
          console.log('drawingOnCanvas')
          console.log(params);
          var ctx = params.canvas.getContext('2d');

          ctx.fillCircle = fillCircle;
      

          ctx.clearRect(0, 0, params.canvas.width, params.canvas.height); 

          var bounds = new L.Bounds(
            map.latLngToContainerPoint(imgBounds.getNorthWest()),
            map.latLngToContainerPoint(imgBounds.getSouthEast()));
          
          var size = bounds.getSize();
          console.log(size);

          ctx.drawImage(img,bounds.min.x,bounds.min.y,size.x,size.y);
}
```

"erasing" parts of the canvas overlay is done by setting a circle under the mouse to trasnparent, [this process.](http://jsfiddle.net/ArtBIT/WUXDb/1/)

## TODO
- I would like to make this a "story" platform where people can highlight areas of the city that are interesting scratch-offs".  Immindent domain, transit projects, landfill development, etc all make for interesting changes to explore.
- Vector Overlays - User could add vector overlays to an area, saying "scratch here to reveal an urban highway" or whatever, with a blurb or narrative about the history of what they are highlighting. 
