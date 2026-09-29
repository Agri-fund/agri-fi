'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';

const TOUR_STORAGE_KEY = 'agri-fi-dashboard-tour-completed';
const TOUR_VERSION = '1.1.0';

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

/**
 * Accessibility-guided onboarding tour for new investors (#1020).
 * Keyboard-first Shepherd.js tour with ARIA live announcements,
 * focus management, and WCAG 2.1 AA contrast on highlights.
 */
export function DashboardTour({
  locale: _locale,
  userRole: _userRole,
  onTourComplete,
  forceRestart = false,
}: DashboardTourProps) {
  const t = useTranslations('tour');
  const tourRef = useRef<Shepherd.Tour | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [isTourActive, setIsTourActive] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

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
      JSON.stringify({
        completed: true,
        version: TOUR_VERSION,
        completedAt: new Date().toISOString(),
      }),
    );
  }, []);

  const announceStep = useCallback(
    (index: number, title: string, text: string, total: number) => {
      setCurrentStepIndex(index + 1);
      setTotalSteps(total);
      setLiveAnnouncement(
        `Onboarding step ${index + 1} of ${total}: ${title}. ${text}`,
      );
    },
    [],
  );

  const restoreFocus = useCallback(() => {
    const target = triggerRef.current;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }, []);

  const getSteps = useCallback((): Shepherd.Step.StepOptions[] => {
    return [
      {
        id: 'welcome',
        title: t('welcome.title'),
        text: `<div id="shepherd-step-description">${t('welcome.text')}</div>`,
        buttons: [
          {
            text: t('buttons.skip'),
            classes: 'shepherd-button-secondary',
            action() {
              tourRef.current?.cancel();
            },
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.next();
            },
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 8,
        when: {
          show() {
            announceStep(0, t('welcome.title'), t('welcome.text'), 6);
            const el = document.querySelector(
              '.shepherd-element',
            ) as HTMLElement | null;
            el?.setAttribute('role', 'dialog');
            el?.setAttribute('aria-modal', 'true');
            el?.setAttribute('aria-labelledby', 'shepherd-step-title');
            el?.setAttribute(
              'aria-describedby',
              'shepherd-step-description',
            );
            const titleEl = el?.querySelector('.shepherd-title');
            titleEl?.setAttribute('id', 'shepherd-step-title');
            const primary = el?.querySelector(
              '.shepherd-button-primary',
            ) as HTMLElement | null;
            primary?.focus();
          },
        },
      },
      {
        id: 'browse-deals',
        title: t('browseDeals.title'),
        text: `<div id="shepherd-step-description">${t('browseDeals.text')}</div>`,
        attachTo: { element: '[data-tour="nav-marketplace"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action() {
              tourRef.current?.back();
            },
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.next();
            },
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
        when: {
          show() {
            announceStep(1, t('browseDeals.title'), t('browseDeals.text'), 6);
          },
        },
      },
      {
        id: 'connect-wallet',
        title: t('connectWallet.title'),
        text: `<div id="shepherd-step-description">${t('connectWallet.text')}</div>`,
        attachTo: { element: '[data-tour="wallet-button"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action() {
              tourRef.current?.back();
            },
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.next();
            },
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
        when: {
          show() {
            announceStep(
              2,
              t('connectWallet.title'),
              t('connectWallet.text'),
              6,
            );
          },
        },
      },
      {
        id: 'portfolio-stats',
        title: t('portfolioStats.title'),
        text: `<div id="shepherd-step-description">${t('portfolioStats.text')}</div>`,
        attachTo: { element: '[data-tour="portfolio-stats"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action() {
              tourRef.current?.back();
            },
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.next();
            },
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
        when: {
          show() {
            announceStep(
              3,
              t('portfolioStats.title'),
              t('portfolioStats.text'),
              6,
            );
          },
        },
      },
      {
        id: 'notification-bell',
        title: t('notificationBell.title'),
        text: `<div id="shepherd-step-description">${t('notificationBell.text')}</div>`,
        attachTo: { element: '[data-tour="notification-bell"]', on: 'bottom' },
        buttons: [
          {
            text: t('buttons.back'),
            classes: 'shepherd-button-secondary',
            action() {
              tourRef.current?.back();
            },
          },
          {
            text: t('buttons.next'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.next();
            },
          },
        ],
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 4,
        when: {
          show() {
            announceStep(
              4,
              t('notificationBell.title'),
              t('notificationBell.text'),
              6,
            );
          },
        },
      },
      {
        id: 'tour-complete',
        title: t('complete.title'),
        text: `<div id="shepherd-step-description">${t('complete.text')}</div>`,
        buttons: [
          {
            text: t('buttons.finish'),
            classes: 'shepherd-button-primary',
            action() {
              tourRef.current?.complete();
            },
          },
        ],
        cancelIcon: { enabled: true },
        when: {
          show() {
            announceStep(5, t('complete.title'), t('complete.text'), 6);
          },
        },
      },
    ];
  }, [t, announceStep]);

  const startTour = useCallback(() => {
    if (tourRef.current) {
      tourRef.current.destroy();
    }

    // Preserve tour content under reduced motion — only disable animations via CSS
    triggerRef.current = document.activeElement as HTMLElement | null;

    const tour = new Shepherd.Tour({
      defaultStepOptions: {
        cancelIcon: { enabled: true },
        classes: `shepherd-theme-arrows agri-fi-tour${hasReducedMotion() ? ' agri-fi-tour--reduced-motion' : ''}`,
        arrow: true,
        modalOverlayOpeningPadding: 8,
        highlightClass: 'shepherd-highlight agri-fi-tour-highlight',
        scrollTo: hasReducedMotion() ? false : { behavior: 'smooth', block: 'center' },
        canClickTarget: false,
      },
      useModalOverlay: true,
      keyboardNavigation: true,
      exitOnEsc: true,
    });

    const steps = getSteps();
    setTotalSteps(steps.length);
    for (const step of steps) {
      tour.addStep(step);
    }

    tour.on('complete', () => {
      markTourCompleted();
      setIsTourActive(false);
      setLiveAnnouncement('Onboarding tour completed.');
      restoreFocus();
      onTourComplete?.();
    });

    tour.on('cancel', () => {
      markTourCompleted();
      setIsTourActive(false);
      setLiveAnnouncement('Onboarding tour dismissed.');
      restoreFocus();
      onTourComplete?.();
    });

    tourRef.current = tour;
    setIsTourActive(true);
    tour.start();
  }, [getSteps, markTourCompleted, onTourComplete, restoreFocus]);

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

  return (
    <>
      {/* Persistent polite live region for step progress (#1020) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="tour-live-region"
      >
        {liveAnnouncement}
      </div>
      {isTourActive && (
        <div
          className="sr-only"
          data-testid="tour-progress"
          aria-hidden="true"
        >
          {currentStepIndex}/{totalSteps}
        </div>
      )}
    </>
  );
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
