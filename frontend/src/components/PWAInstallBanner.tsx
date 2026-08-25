"use client";

import { useEffect, useState } from "react";

export function PWAInstallBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);

      // Show banner after 30 seconds
      const timer = setTimeout(() => {
        setShowBanner(true);
      }, 30000);

      return () => clearTimeout(timer);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      console.log("PWA installed successfully");
      setShowBanner(false);
      setCanInstall(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log("User install choice:", outcome);
      setShowBanner(false);
      setDeferredPrompt(null);
    } catch (error) {
      console.error("Install prompt failed:", error);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
  };

  if (!showBanner || !canInstall) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg shadow-xl p-4 flex items-center justify-between gap-4 sm:bottom-6 sm:left-6 sm:right-6 sm:max-w-sm">
      <div className="flex-1">
        <h3 className="font-bold text-sm">Install AgriFi</h3>
        <p className="text-xs text-green-100">
          Add to home screen for quick access
        </p>
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={handleDismiss}
          className="px-3 py-2 rounded text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
        >
          Not now
        </button>
        <button
          onClick={handleInstall}
          className="px-3 py-2 rounded text-xs font-bold bg-white text-green-600 hover:bg-gray-50 transition-colors"
        >
          Install
        </button>
      </div>
    </div>
  );
}
