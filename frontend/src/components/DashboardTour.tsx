'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';

const TOUR_STORAGE_KEY = 'agri-fi-dashboard-tour-completed';
const TOUR_VERSION = '1.0.0';

function hasReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface DashboardTourProps {
  locale: string;
  userRole: string;
  onTourComplete?: () => void;
  forceRestart?: boolean;
}

export function DashboardTour({
  locale,
  userRole,
  onTourComplete,
  forceRestart = false,
}: DashboardTourProps) {
  const t = useTranslations('tour');
  const tourRef = useRef<Shepherd.Tour | null>(null);
  const [isTourActive, setIsTourActive] = useState(false);

  const isTourCompleted = useCallback((): boolean => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      return parsed.version === TOUR_VERSION && parsed.completed === true;
    } catch {
      return false;
    }
  }, []);

  const markTourCompleted = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({ completed: true, version: TOUR_VERSION, completedAt: new Date().toISOString() }),
    );
  }, []);

  const getSteps = useCallback((): Shepherd.Step.StepOptions[] => {
    const accentColor = '#059669';

    return [
      {
        id: 'welcome',
        title: t('welcome.title'),
        text: t('welcome.text'),
        buttons: [
          {
            text: t('buttons.skip'),
            classes: 'shepherd-button-secondary',
            action: () => tourRef.current?.cancel(),
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.next(),
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 8,
      },
      {
        id: 'browse-deals',
        title: t('browseDeals.title'),
        text: t('browseDeals.text'),
        attachTo: { element: '[data-tour="nav-marketplace"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action: () => tourRef.current?.back(),
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.next(),
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
      },
      {
        id: 'connect-wallet',
        title: t('connectWallet.title'),
        text: t('connectWallet.text'),
        attachTo: { element: '[data-tour="wallet-button"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action: () => tourRef.current?.back(),
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.next(),
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
      },
      {
        id: 'portfolio-stats',
        title: t('portfolioStats.title'),
        text: t('portfolioStats.text'),
        attachTo: { element: '[data-tour="portfolio-stats"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action: () => tourRef.current?.back(),
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.next(),
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
      },
      {
        id: 'notification-bell',
        title: t('notificationBell.title'),
        text: t('notificationBell.text'),
        attachTo: { element: '[data-tour="notification-bell"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action: () => tourRef.current?.back(),
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.next(),
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
      },
      {
        id: 'tour-complete',
        title: t('complete.title'),
        text: t('complete.text'),
        buttons: [
          {
            text: t('buttons.finish'),
            classes: 'shepherd-button-primary',
            action: () => tourRef.current?.complete(),
          },
        ],
        cancelIcon: { enabled: true },
      },
    ];
  }, [t]);

  const startTour = useCallback(() => {
    if (tourRef.current) {
      tourRef.current.destroy();
    }

    if (hasReducedMotion()) {
      markTourCompleted();
      onTourComplete?.();
      return;
    }

    const tour = new Shepherd.Tour({
      defaultStepOptions: {
        cancelIcon: { enabled: true },
        classes: 'shepherd-theme-arrows agri-fi-tour',
        arrow: true,
        modalOverlayOpeningPadding: 8,
        highlightClass: 'shepherd-highlight',
        title: undefined,
        text: undefined,
      },
      useEffectOverlay: true,
      keyboardNavigation: true,
      exitOnEsc: true,
    });

    tour.steps = getSteps();

    tour.on('complete', () => {
      markTourCompleted();
      setIsTourActive(false);
      onTourComplete?.();
    });

    tour.on('cancel', () => {
      markTourCompleted();
      setIsTourActive(false);
      onTourComplete?.();
    });

    tourRef.current = tour;
    setIsTourActive(true);
    tour.start();
  }, [getSteps, markTourCompleted, onTourComplete]);

  useEffect(() => {
    if (forceRestart) {
      startTour();
      return;
    }

    if (!isTourCompleted()) {
      const timer = setTimeout(() => {
        startTour();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [forceRestart, isTourCompleted, startTour]);

  useEffect(() => {
    return () => {
      if (tourRef.current) {
        tourRef.current.destroy();
      }
    };
  }, []);

  return null;
}

export function isTourCompletedStatic(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    return parsed.version === TOUR_VERSION && parsed.completed === true;
  } catch {
    return false;
  }
}

export function resetTour(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOUR_STORAGE_KEY);
}
