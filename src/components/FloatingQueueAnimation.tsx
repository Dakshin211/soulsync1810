import React, { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';

interface FloatingQueueAnimationProps {
  song: {
    title: string;
    artist: string;
    thumbnail: string;
  } | null;
  show: boolean;
  onComplete: () => void;
}

export default function FloatingQueueAnimation({ song, show, onComplete }: FloatingQueueAnimationProps) {
  const [animationState, setAnimationState] = useState<'idle' | 'floating' | 'done'>('idle');

  useEffect(() => {
    if (show && song) {
      setAnimationState('floating');
      
      // Animation duration
      const timer = setTimeout(() => {
        setAnimationState('done');
        onComplete();
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [show, song, onComplete]);

  if (!show || !song || animationState === 'done') return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
      {/* Floating song card */}
      <div
        className="absolute left-1/2 -translate-x-1/2 animate-float-to-bottom"
        style={{
          top: '30%',
        }}
      >
        <div className="flex items-center gap-3 bg-card/95 backdrop-blur-xl border border-primary/50 rounded-2xl p-3 pr-6 shadow-glow-combined">
          {/* Thumbnail with glow */}
          <div className="relative">
            <div className="absolute -inset-1 bg-primary/30 rounded-xl blur-md animate-pulse" />
            <img
              src={song.thumbnail}
              alt=""
              className="relative w-14 h-14 rounded-xl object-cover"
            />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-primary/20 to-transparent" />
          </div>
          
          {/* Song info */}
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate max-w-[150px]">
              {song.title}
            </p>
            <p className="text-xs text-muted-foreground truncate max-w-[150px]">
              {song.artist}
            </p>
          </div>
          
          {/* Music icon */}
          <Music2 className="w-5 h-5 text-primary animate-bounce" />
        </div>
        
        {/* Trail particles */}
        <div className="absolute inset-0 flex justify-center">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-primary/50 rounded-full animate-trail"
              style={{
                animationDelay: `${i * 0.1}s`,
                left: `${45 + i * 2}%`,
              }}
            />
          ))}
        </div>
      </div>
      
      {/* "Added to queue" text */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-32 animate-fade-in-up"
        style={{ animationDelay: '0.8s' }}
      >
        <div className="bg-primary/90 text-primary-foreground px-4 py-2 rounded-full text-sm font-medium shadow-glow-pink">
          ✓ Added to room queue
        </div>
      </div>
    </div>
  );
}
