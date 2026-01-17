import { useEffect, useState } from 'react';
import logo from '@/assets/logo.png';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, 2000);

    const completeTimer = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, 2500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-background via-primary/10 to-background transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className={`flex flex-col items-center gap-6 transition-all duration-700 ${
        fadeOut ? 'opacity-0 scale-95' : 'opacity-100 scale-105'
      }`}>
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-primary blur-3xl opacity-40 animate-pulse"></div>
          <img 
            src={logo} 
            alt="SoulSync" 
            className="relative w-32 h-32 object-contain drop-shadow-2xl"
          />
        </div>
        <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent tracking-tight">
          SoulSync
        </h1>
      </div>
    </div>
  );
}
