import { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { MusicPlayerProvider } from "./contexts/MusicPlayerContext";
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

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
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
    </>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <MusicPlayerProvider>
              <AppContent />
            </MusicPlayerProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
