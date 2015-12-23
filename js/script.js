//dem globals
var isDrawing,
currentOffset,
view=null,
scratchoffMode = true,
radius,
fillColor,
strokeColor,
canvasTiles,
baseTiles;

//if there's a hash
if (window.location.hash) {
  var hashValues = window.location.hash.split('#')[1].split('/');
  view = {
    zoom: hashValues[0],
    lat: hashValues[1],
    lng: hashValues[2]
  }
}


var map = L.map('map');

var geoSearch = new L.Control.GeoSearch({
  provider: new L.GeoSearch.Provider.Google(),
  showMarker: true
}).addTo(map);

if (view) {
  map.setView([view.lat,view.lng], view.zoom);
} else {
  //Default view over Lower Manhattan and Brooklyn
  map.setView([40.7,-73.99], 14);
}


var tileLayers = [
  {
    name: 'Present Day Aerials',
    url: 'http://otile1.mqcdn.com/tiles/1.0.0/sat/{z}/{x}/{y}.jpg'
  },
  {
    name: '1924 Aerials',
    url: 'http://tilecache.lolspec.com/tms/1924/{z}/{x}/{y}.png'
  }      
];

addTileLayers(tileLayers);

function addTileLayers(tileLayers) {
  var bottomLayer = tileLayers[0],
    topLayer = tileLayers[1];
 
  $('#bottomLayerButton').text(bottomLayer.name);
  $('#topLayerButton').text(topLayer.name);


  //bottom layer
  baseTiles = L.tileLayer(bottomLayer.url,{
    maxZoom: 20
  }).addTo(map);

  //add top (canvas tile) layer
  canvasTiles = L.tileLayer.canvas({tileSize:256,unloadInvisibleTiles:true});
  canvasTiles.drawTile = function(canvas, tilePoint, zoom) {
    var ctx = canvas.getContext('2d');
    var img = new Image()



    img.src = Mustache.render(topLayer.url.replace(/{/g, '{{').replace(/}/g,'}}'),{
      z: zoom,
      x:tilePoint.x,
      y:tilePoint.y
    })
    img.onload = function() {
      ctx.drawImage(img,0,0);
    };   
  };
  canvasTiles.addTo(map);
  setListeners();
}


// Event Handers

$('#searchbox').keypress(function(e){
  if(e.charCode==13) {
    e.preventDefault();
  }
  geoSearch._onKeyUp(e);
});


//this is lame.  calling setListeners on tileload does not seem to work either.  Need a fix for this.
map.on('viewreset',function(){
  setTimeout(function() {
    setListeners();
  },1000)
})

map.on('dragend', setLocation);
map.on('zoomend', setLocation);

canvasTiles.on('tileload',function() {
  setListeners();
})


//Button Group Click Handlers
$('#modePanAndZoom').click(function() {
  $('.btn-mode').removeClass('active');
  $(this).addClass('active');

  //Enable drag and zoom handlers.
  map.dragging.enable();
  map.touchZoom.enable();
  map.doubleClickZoom.enable();
  map.scrollWheelZoom.enable();

  scratchoffMode = false;
});

$('#modeScratchoff').click(function(){
  $('.btn-mode').removeClass('active');
  $(this).addClass('active');
  
  //Disable drag and zoom handlers.
  map.dragging.disable();
  map.touchZoom.disable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();

  scratchoffMode = true;
});

//fire the above once to kick things off...
$('#modeScratchoff').trigger('click');

$('#swap').click(function() {
  //rearrange the order in the layers array
  var temp = tileLayers[0];
  tileLayers[0] = tileLayers[1];
  tileLayers[1] = temp;

  map.removeLayer(canvasTiles);
  map.removeLayer(baseTiles);

  addTileLayers(tileLayers);

})

$("#about-btn").click(function() {
  $("#aboutModal").modal("show");
  // $(".navbar-collapse.in").collapse("hide");
  return false;
});

//when the canvaslayer adds new canvas tiles, these listeners need to be set again
function setListeners() {
  console.log('setListeners()')
  $("canvas").unbind()
    .mousemove(function(e) {
      if(scratchoffMode) {
        draw($(this),e);
      }
    })

    .mousedown(function(e) {
    if(scratchoffMode) {
        isDrawing=true;
        draw($(this),e);
      } 
    })

    .mouseup(function(e) {
    if(scratchoffMode) {
      isDrawing=false;
    }
  })   
}

//updates the URL hash based on the current view
function setLocation() {
  var zoom = map.getZoom();
  var center = map.getCenter();
  var hash = [zoom,center.lat.toFixed(3),center.lng.toFixed(3)].join('/');
  window.location.hash = hash;
}


var fillCircle = function(x, y, radius, fillColor, strokeColor  ) {
  this.moveTo(x, y);

  //draw the stroke
  this.globalCompositeOperation = 'source-over';
  this.lineWidth = 2;
  this.strokeStyle = strokeColor;
  this.arc(x, y, radius, 0, Math.PI * 2, false);
  this.stroke();

  //draw the fill
  this.globalCompositeOperation = 'destination-out';
  this.fillStyle = fillColor;
  this.arc(x, y, radius-5, 0, Math.PI * 2, false);
  this.fill();
};

function draw(element, e) {
  if(!isDrawing) {
    return
  }
  var x = e.offsetX;
  var y = e.offsetY;

  radius = 30; // or whatever
  fillColor = '#ff0000';
  strokeColor = '#ffffff';

  //check to see if the cursor is near the edge of a tile
  var buffer = { 
    top: (y < radius ? true : false),
    right: (x > (256-radius) ? true : false),
    left: (x < radius ? true : false),
    bottom: (y > (256-radius) ? true : false)
  }

  if( buffer.top || buffer.right || buffer.bottom || buffer.left ) {
    outerDraw(element, buffer,x,y);
  }
  
  var ctx = element[0].getContext('2d');

  ctx.fillCircle = fillCircle;
  ctx.fillCircle(x, y, radius, fillColor, strokeColor);
}

function outerDraw(element, buffer,drawX,drawY) {
  var origin = {
    top: element[0].offsetTop,
    left: element[0].offsetLeft
  }

  //build an array of tiles to be drawn into
  //set bounds of target based on which directions are true in buffer
  var range = {
    xMin: origin.left,
    xMax: origin.left+256,
    yMin: origin.top,
    yMax: origin.top+256
  }

  if (buffer.top) {
    range.yMin = origin.top - 256;
  }
  if (buffer.right) {
    range.xMax = origin.left + 512;
  }
  if (buffer.bottom) {
    range.yMax = origin.top + 512;
  }
  if (buffer.left) {
    range.xMin = origin.left - 256;
  }


  $('canvas').each(function(i) {
    var x = parseInt($(this).css('left')),
      y = parseInt($(this).css('top'));

    if(x==origin.left && y==origin.top) {
      return
    }

    if( x >= range.xMin && x < range.xMax ) {
      if( y >= range.yMin && y < range.yMax ) {
      
        var ctx = this.getContext('2d');

        ctx.fillCircle = fillCircle;
      
        var offsetX = origin.left - x,
        offsetY = origin.top - y;
  

        ctx.fillCircle(drawX + offsetX, drawY + offsetY, radius, fillColor, strokeColor);
      }
    }
  });
    }