let deferredPrompt = null;

window.addEventListener("load", () => {
  const splash = document.getElementById("splash");

  setTimeout(() => {
    splash?.classList.add("hidden");
    setTimeout(() => splash?.remove(), 500);
  }, 1050);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;

  const button = document.getElementById("installButton");
  if (button) button.hidden = false;
});

document.getElementById("installButton")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById("installButton").hidden = true;
});

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    if (page === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    alert("「" + button.textContent.trim() + "」はPhase2で現在のGASと接続します。");
  });
});

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

if (isIos && !isStandalone) {
  const iosHelpButton = document.getElementById("iosHelpButton");
  if (iosHelpButton) iosHelpButton.hidden = false;
}

document.getElementById("iosHelpButton")?.addEventListener("click", () => {
  document.getElementById("iosGuide").hidden = false;
});

document.getElementById("closeIosGuide")?.addEventListener("click", () => {
  document.getElementById("iosGuide").hidden = true;
});

document.getElementById("iosGuide")?.addEventListener("click", event => {
  if (event.target.id === "iosGuide") {
    event.currentTarget.hidden = true;
  }
});
