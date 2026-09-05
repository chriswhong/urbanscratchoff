import $ from "jquery";

// Bootstrap 3's JS (the `.modal()` plugin used for the About dialog) is a
// plain UMD build that expects a global jQuery to attach itself to, not an
// ES module import -- so it has to be exposed on window before the plugin
// script runs. A dynamic import (rather than a static one) is required
// here: static imports are hoisted above all other code in a module
// regardless of where they're written, so the window assignment below
// would otherwise still run *after* bootstrap's own module already
// executed and found no global jQuery.
window.jQuery = window.$ = $;
await import("bootstrap/dist/js/bootstrap.js");

// ---- UI wiring ----------------------------------------------------
//
// Pure DOM/jQuery glue: no map or scratch logic lives here, just wiring
// the sidebar controls to the callbacks the caller supplies.
export function setupUI({ onModeChange, onSwap }) {
  $("#modePanAndZoom").click(function () {
    $(".btn-mode").removeClass("active");
    $(this).addClass("active");
    onModeChange(false);
  });

  $("#modeScratchoff").click(function () {
    $(".btn-mode").removeClass("active");
    $(this).addClass("active");
    onModeChange(true);
  });

  $("#swap").click(function () {
    onSwap();
  });

  $("#about-btn").click(function () {
    $("#aboutModal").modal("show");
    return false;
  });

  return {
    setLayerNames: function (bottomName, topName) {
      $("#bottomLayerButton").text(bottomName);
      $("#topLayerButton").text(topName);
    },
  };
}
