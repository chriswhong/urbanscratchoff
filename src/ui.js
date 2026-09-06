// ---- UI wiring ----------------------------------------------------
//
// Pure DOM glue: no map or scratch logic lives here, just wiring the
// floating panel/modal controls to the callbacks the caller supplies.
export function setupUI({ onSwap }) {
  const swapBtn = document.getElementById("swap");
  const aboutBtn = document.getElementById("about-btn");
  const aboutModal = document.getElementById("aboutModal");
  const modKey = document.getElementById("mod-key");
  const topLayerRow = document.getElementById("topLayerRow");
  const bottomLayerRow = document.getElementById("bottomLayerRow");
  const panelToggle = document.getElementById("panel-toggle");
  const panelMore = document.getElementById("panel-more");
  const panelToggleLabel = document.getElementById("panel-toggle-label");
  const panelToggleIcon = document.getElementById("panel-toggle-icon");

  const isMac = /mac|iphone|ipad|ipod/i.test(
    navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent,
  );
  modKey.textContent = isMac ? "⌘" : "Ctrl";

  const SWAP_ANIMATION_MS = 220;

  // Slide the two layer rows past each other, then swap their text (via
  // onSwap, which updates the DOM synchronously) right as they land back
  // in place -- reads as the two layers trading positions.
  function animateSwap() {
    const distance = bottomLayerRow.offsetTop - topLayerRow.offsetTop;

    topLayerRow.style.transition = bottomLayerRow.style.transition =
      `transform ${SWAP_ANIMATION_MS}ms ease, opacity ${SWAP_ANIMATION_MS}ms ease`;
    topLayerRow.style.transform = `translateY(${distance}px)`;
    bottomLayerRow.style.transform = `translateY(${-distance}px)`;
    topLayerRow.style.opacity = bottomLayerRow.style.opacity = "0.4";

    window.setTimeout(function () {
      onSwap();

      topLayerRow.style.transition = bottomLayerRow.style.transition = "none";
      topLayerRow.style.transform = bottomLayerRow.style.transform = "";
      topLayerRow.style.opacity = bottomLayerRow.style.opacity = "";
      // Force a reflow so the transition removal above takes effect
      // before it's re-enabled for the next swap.
      void topLayerRow.offsetHeight;
      topLayerRow.style.transition = bottomLayerRow.style.transition = "";
    }, SWAP_ANIMATION_MS);
  }

  swapBtn.addEventListener("click", animateSwap);

  // Mobile-only: the rest of the panel (pitch, layer order, links) starts
  // collapsed behind this toggle so the panel doesn't dominate a small
  // screen -- see the "sm:block" override in index.html that keeps it
  // permanently open on wider screens regardless of this state.
  panelToggle.addEventListener("click", function () {
    const expanded = panelMore.classList.toggle("hidden") === false;
    panelToggleLabel.textContent = expanded ? "Less" : "More";
    panelToggleIcon.classList.toggle("rotate-180", expanded);
  });

  function showAboutModal() {
    aboutModal.classList.remove("hidden");
    aboutModal.classList.add("flex");
  }

  function hideAboutModal() {
    aboutModal.classList.add("hidden");
    aboutModal.classList.remove("flex");
  }

  aboutBtn.addEventListener("click", function (e) {
    e.preventDefault();
    showAboutModal();
  });

  aboutModal.querySelectorAll(".about-modal-close").forEach((btn) => {
    btn.addEventListener("click", hideAboutModal);
  });

  // Click on the backdrop (not the dialog itself) closes the modal.
  aboutModal.addEventListener("click", function (e) {
    if (e.target === aboutModal) hideAboutModal();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !aboutModal.classList.contains("hidden")) {
      hideAboutModal();
    }
  });

  return {
    setLayerNames: function (bottomName, topName) {
      document.getElementById("bottomLayerButton").textContent = bottomName;
      document.getElementById("topLayerButton").textContent = topName;
    },
  };
}
