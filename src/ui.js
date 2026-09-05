// ---- UI wiring ----------------------------------------------------
//
// Pure DOM glue: no map or scratch logic lives here, just wiring the
// sidebar/navbar controls to the callbacks the caller supplies.
export function setupUI({ onModeChange, onSwap }) {
  const panBtn = document.getElementById("modePanAndZoom");
  const scratchBtn = document.getElementById("modeScratchoff");
  const swapBtn = document.getElementById("swap");
  const aboutBtn = document.getElementById("about-btn");
  const aboutModal = document.getElementById("aboutModal");

  function setActiveModeButton(btn) {
    document.querySelectorAll(".btn-mode").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
  }

  panBtn.addEventListener("click", function () {
    setActiveModeButton(panBtn);
    onModeChange(false);
  });

  scratchBtn.addEventListener("click", function () {
    setActiveModeButton(scratchBtn);
    onModeChange(true);
  });

  swapBtn.addEventListener("click", function () {
    onSwap();
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
