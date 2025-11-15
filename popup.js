// Listener para o botão de download
document.getElementById("download").addEventListener("click", async () => {
  const bar = document.querySelector("#bar");
  const toast = document.querySelector("#toast");

  // Feedback inicial: zera a barra de progresso
  if (bar) {
    bar.style.width = "0%";
    bar.setAttribute("aria-valuenow", "0");
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Injeta o script na página
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        async function ensureDir(pathParts, root) {
          let current = root;
          for (const part of pathParts) {
            current = await current.getDirectoryHandle(part, { create: true });
          }
          return current;
        }

        try {
          // Cria uma pasta com timestamp
          const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
          const dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
          const sessionDir = await dirHandle.getDirectoryHandle(`site_${now}`, { create: true });
          console.log("📁 Directory chosen:", dirHandle.name, "Session folder:", `site_${now}`);

          // Coleta recursos da aba Sources
          const resources = new Set();

          // 1. Recursos via performance.getEntriesByType('resource')
          performance.getEntriesByType('resource').forEach(r => resources.add(r.name));

          // 2. Recursos do DOM (scripts, styles, images, etc.)
          const selectors = [
            'script[src]',
            'link[href][rel="stylesheet"]',
            'img[src]',
            'source[src]',
            'font[src]',
            'iframe[src]',
            'audio[src]',
            'video[src]',
            'track[src]',
          ];
          selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
              const url = el.src || el.href;
              if (url) resources.add(url);
            });
          });

          // 3. Adiciona a página atual (HTML)
          resources.add(window.location.href);

          const urls = Array.from(resources);
          let completed = 0;
          const total = urls.length;

          console.log(`📥 Total resources to download: ${total}`);

          for (const url of urls) {
            try {
              const res = await fetch(url, { mode: 'no-cors' });
              if (!res.ok && res.type !== 'opaque') continue; // Permite respostas opacas (CDNs)

              const blob = await res.blob();
              const urlObj = new URL(url);
              const path = urlObj.pathname.split('/').filter(Boolean);
              const fileName = path.pop() || `index${urlObj.pathname.endsWith('/') ? '.html' : ''}`;
              const folder = await ensureDir(path, sessionDir);

              const fileHandle = await folder.getFileHandle(fileName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();

              completed++;
              const percent = Math.round((completed / total) * 100);

              // Envia progresso para a popup
              chrome.runtime.sendMessage({
                type: 'progress',
                percent: percent,
              });

              console.log(`💾 Saved: ${url}`);
            } catch (err) {
              console.error(`⚠️ Error saving ${url}:`, err);
            }
          }

          // Envia mensagem de conclusão
          chrome.runtime.sendMessage({
            type: 'complete',
            total: total,
          });

          console.log("✅ Download completed successfully!");
        } catch (err) {
          console.error("⚠️ Error during download process:", err);
          chrome.runtime.sendMessage({
            type: 'error',
            message: err.message || "Failed to complete download",
          });
        }
      },
    });
  } catch (err) {
    console.error("⚠️ Error initiating download:", err);
    if (toast) {
      toast.textContent = `❌ Error: ${err.message || "Failed to start download"}`;
      toast.style.background = "#ff4444";
      toast.style.display = "block";
      setTimeout(() => (toast.style.opacity = "1"), 50);
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => (toast.style.display = "none"), 500);
      }, 4000);
    }
  }
});

// Listener para mensagens do script injetado
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const bar = document.querySelector("#bar");
  const toast = document.querySelector("#toast");

  if (message.type === 'progress' && bar) {
    bar.style.width = message.percent + "%";
    bar.setAttribute("aria-valuenow", message.percent);
  }

  if (message.type === 'complete' && toast) {
    toast.textContent = `✅ Download Complete — ${message.total} files saved`;
    toast.style.background = "#0078ff";
    toast.style.display = "block";
    setTimeout(() => (toast.style.opacity = "1"), 50);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => (toast.style.display = "none"), 500);
    }, 4000);
  }

  if (message.type === 'error' && toast) {
    toast.textContent = `❌ Error: ${message.message}`;
    toast.style.background = "#ff4444";
    toast.style.display = "block";
    setTimeout(() => (toast.style.opacity = "1"), 50);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => (toast.style.display = "none"), 500);
    }, 4000);
  }
});