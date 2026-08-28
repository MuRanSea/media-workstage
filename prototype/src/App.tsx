import React, { useState, useEffect } from 'react';
import { PrototypeSwitcher } from './components/PrototypeSwitcher';
import { VariantA_ReactFlow } from './variants/VariantA_ReactFlow';
import { VariantB_LovartSpatial } from './variants/VariantB_LovartSpatial';
import { VariantC_StoryboardHybrid } from './variants/VariantC_StoryboardHybrid';

export const App: React.FC = () => {
  // Sync with ?variant= URL parameter
  const getInitialVariant = (): string => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('variant')?.toUpperCase();
    if (v === 'A' || v === 'B' || v === 'C') {
      return v;
    }
    return 'B'; // Default to B (Lovart Spatial) as recommended baseline
  };

  const [variant, setVariant] = useState<string>(getInitialVariant);

  const handleVariantChange = (newVariant: string) => {
    setVariant(newVariant);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', newVariant);
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('variant')?.toUpperCase();
      if (v === 'A' || v === 'B' || v === 'C') {
        setVariant(v);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden relative flex flex-col">
      <main className="flex-1 w-full h-full relative">
        {variant === 'A' && <VariantA_ReactFlow />}
        {variant === 'B' && <VariantB_LovartSpatial />}
        {variant === 'C' && <VariantC_StoryboardHybrid />}
      </main>

      <PrototypeSwitcher
        currentVariant={variant}
        onVariantChange={handleVariantChange}
      />
    </div>
  );
};

export default App;
