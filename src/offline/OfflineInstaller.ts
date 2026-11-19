const CACHE_NAME = 'dream-flight-offline-v2';
const INSTALL_FLAG_KEY = 'dream_flight_installed_v2';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export class OfflineInstaller {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isCachedLocal = false;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
    });
  }

  public canPromptPwaInstall(): boolean {
    return this.deferredPrompt !== null;
  }

  public isRunningFromLocalCache(): boolean {
    return this.isCachedLocal;
  }

  public async promptPwaInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    await this.deferredPrompt.prompt();
    const res = await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    return res.outcome === 'accepted';
  }

  /**
   * Registers the Service Worker and pre-installs all game assets into Browser CacheStorage
   * on first visit so subsequent runs launch 100% locally with zero network lag.
   */
  public async ensureInstalledToBrowser(): Promise<void> {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const alreadyFlagged = localStorage.getItem(INSTALL_FLAG_KEY) === '1';
    if (alreadyFlagged && 'caches' in window) {
      try {
        const hasCache = await caches.has(CACHE_NAME);
        if (hasCache) {
          this.isCachedLocal = true;
          return;
        }
      } catch {
        // Proceed to install
      }
    }

    if (!('caches' in window)) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'installer-overlay';
    overlay.innerHTML = `
      <div class="installer-card">
        <div class="installer-badge">LOCAL BROWSER STORAGE</div>
        <h2 class="installer-title">DREAM FLIGHT</h2>
        <p class="installer-desc" id="inst-status">Preparing offline game package for zero-lag flight...</p>
        <div class="installer-bar-track">
          <div class="installer-bar-fill" id="inst-bar"></div>
        </div>
        <div class="installer-meta">
          <span id="inst-step">Caching runtime assets</span>
          <span id="inst-pct">0%</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('#inst-status') as HTMLElement;
    const barEl = overlay.querySelector('#inst-bar') as HTMLElement;
    const stepEl = overlay.querySelector('#inst-step') as HTMLElement;
    const pctEl = overlay.querySelector('#inst-pct') as HTMLElement;

    const setProgress = (pct: number, step: string) => {
      const clamped = Math.min(100, Math.max(0, Math.round(pct)));
      barEl.style.width = `${clamped}%`;
      pctEl.textContent = `${clamped}%`;
      stepEl.textContent = step;
    };

    try {
      const urls = new Set<string>(['/', '/index.html', '/manifest.json']);
      document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]').forEach((el) => {
        const raw = el.getAttribute('src') || el.getAttribute('href');
        if (!raw) return;
        try {
          const parsed = new URL(raw, window.location.origin);
          if (parsed.origin === window.location.origin) {
            urls.add(parsed.pathname + parsed.search);
          }
        } catch {
          // Ignore malformed
        }
      });

      const cache = await caches.open(CACHE_NAME);
      const list = Array.from(urls);
      let done = 0;

      for (const u of list) {
        setProgress((done / Math.max(1, list.length)) * 90 + 5, `Saving ${u.split('/').pop() || 'index.html'}`);
        try {
          const resp = await fetch(u, { cache: 'reload' });
          if (resp.ok) {
            await cache.put(u, resp.clone());
          }
        } catch {
          // Non-fatal if offline dev
        }
        done++;
      }

      setProgress(100, 'Installed locally — ready for zero-lag launch');
      statusEl.textContent = 'Game files saved to browser storage.';
      localStorage.setItem(INSTALL_FLAG_KEY, '1');
      this.isCachedLocal = true;

      await new Promise((r) => window.setTimeout(r, 340));
    } catch {
      // Non-fatal fallback
    } finally {
      overlay.classList.add('fade-out');
      window.setTimeout(() => overlay.remove(), 260);
    }
  }
}
