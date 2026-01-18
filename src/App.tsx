import { useState, useEffect, Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { MusicPlayerProvider, useMusicPlayer } from "./contexts/MusicPlayerContext";
import { Layout } from "./components/Layout";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import SearchPage from "./pages/SearchPage";
import Playlists from "./pages/Playlists";
import PlaylistDetail from "./pages/PlaylistDetail";
import Rooms from "./pages/Rooms";
import Friends from "./pages/Friends";
import ArtistDetail from "./pages/ArtistDetail";
import NotFound from "./pages/NotFound";
import SharedPlaylistPage from "./pages/SharedPlaylistPage";
import NowPlaying from "./components/NowPlaying";
import FavoriteArtistsSelection from "./components/FavoriteArtistsSelection";
import SplashScreen from "./components/SplashScreen";
import FloatingQueueAnimation from "./components/FloatingQueueAnimation";
import ErrorBoundary from "./components/ErrorBoundary";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser, loading, needsFavoriteArtists, setNeedsFavoriteArtists } = useAuth();
  
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (needsFavoriteArtists && currentUser) {
    return <FavoriteArtistsSelection currentUser={currentUser} onComplete={() => setNeedsFavoriteArtists(false)} />;
  }
  
  return currentUser ? <Layout>{children}</Layout> : <Navigate to="/auth" />;
};

const AppContent = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [splashReady, setSplashReady] = useState(false);

  // Ensure splash screen doesn't cause black screen by adding a safety timeout
  useEffect(() => {
    // Force hide splash after 4 seconds maximum (safety net)
    const safetyTimer = setTimeout(() => {
      setShowSplash(false);
    }, 4000);

    // Normal splash duration
    const timer = setTimeout(() => {
      setSplashReady(true);
    }, 100);

    return () => {
      clearTimeout(safetyTimer);
      clearTimeout(timer);
    };
  }, []);

  if (showSplash && splashReady) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  // Show a minimal loading state if splash isn't ready yet
  if (showSplash && !splashReady) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
        <Route path="/playlists" element={<ProtectedRoute><Playlists /></ProtectedRoute>} />
        <Route path="/playlist/:id" element={<ProtectedRoute><PlaylistDetail /></ProtectedRoute>} />
        <Route path="/shared/:shareCode" element={<SharedPlaylistPage />} />
        <Route path="/rooms" element={<ProtectedRoute><Rooms /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="/artist/:artistName" element={<ProtectedRoute><ArtistDetail /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <NowPlaying />
      <FloatingQueueWrapper />
    </>
  );
};

// Wrapper component to use the MusicPlayer context for floating animation
const FloatingQueueWrapper = () => {
  const { floatingQueueSong, showFloatingAnimation, clearFloatingAnimation } = useMusicPlayer();
  
  return (
    <FloatingQueueAnimation
      song={floatingQueueSong}
      show={showFloatingAnimation}
      onComplete={clearFloatingAnimation}
    />
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <MusicPlayerProvider>
                <ErrorBoundary>
                  <AppContent />
                </ErrorBoundary>
              </MusicPlayerProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
