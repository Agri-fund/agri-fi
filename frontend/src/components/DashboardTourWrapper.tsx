'use client';

import { useState, useCallback } from 'react';
import { useLocale } from 'next-intl';
import { DashboardTour, isTourCompletedStatic, resetTour } from './DashboardTour';

interface DashboardTourWrapperProps {
  userRole: string;
}

export function DashboardTourWrapper({ userRole }: DashboardTourWrapperProps) {
  const locale = useLocale();
  const [forceRestart, setForceRestart] = useState(false);

  const handleTourComplete = useCallback(() => {
    setForceRestart(false);
  }, []);

  const handleRestartTour = useCallback(() => {
    resetTour();
    setForceRestart(true);
  }, []);

  return (
    <>
      <DashboardTour
        locale={locale}
        userRole={userRole}
        onTourComplete={handleTourComplete}
        forceRestart={forceRestart}
      />
      {isTourCompletedStatic() && (
        <button
          onClick={handleRestartTour}
          className="fixed bottom-4 right-4 z-40 bg-emerald-600 text-white px-4 py-2 rounded-xl shadow-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
          data-tour="restart-tour"
        >
          {locale === 'fr' ? 'Redémarrer la Visite' :
           locale === 'pt' ? 'Reiniciar Tour' :
           locale === 'sw' ? 'Anza Upya Ziara' :
           locale === 'es' ? 'Reiniciar Recorrido' :
           'Restart Tour'}
        </button>
      )}
    </>
  );
}
