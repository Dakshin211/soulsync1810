import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, ListMusic, Radio, Users, LogOut, X, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import logo from '@/assets/logo.png';
import { realtimeDb } from '@/lib/firebaseRealtime';
import { ref, onValue, get, set, remove } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { useRoomPersistence } from '@/hooks/useRoomPersistence';

interface RoomInvite {
  id: string;
  roomId: string;
  roomName: string;
  roomCode: string;
  fromUser: string;
  timestamp: number;
}

const navItems = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: ListMusic, label: 'Playlists', path: '/playlists' },
  { icon: Radio, label: 'Rooms', path: '/rooms' },
  { icon: Users, label: 'Friends', path: '/friends' },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, currentUser } = useAuth();
  const { saveRoom } = useRoomPersistence();
  
  // Global room invites
  const [roomInvites, setRoomInvites] = useState<RoomInvite[]>([]);
  
  // Black screen overlay state for background listening
  const [blackScreenActive, setBlackScreenActive] = useState(false);
  const lastTapRef = useRef<number>(0);
  
  // Global room invite listener
  useEffect(() => {
    if (!currentUser) {
      setRoomInvites([]);
      return;
    }
    
    const invitesRef = ref(realtimeDb, `roomInvites/${currentUser.uid}`);
    const unsubscribe = onValue(invitesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const invitesList = Object.entries(data).map(([id, invite]: [string, any]) => ({
          id,
          ...invite,
        }));
        // Only show invites from last 2 minutes
        const recentInvites = invitesList.filter(inv => Date.now() - inv.timestamp < 120000);
        setRoomInvites(recentInvites);
      } else {
        setRoomInvites([]);
      }
    });
    
    return () => unsubscribe();
  }, [currentUser]);
  
  const acceptInvite = async (invite: RoomInvite) => {
    if (!currentUser) return;
    
    try {
      const roomRef = ref(realtimeDb, `rooms/${invite.roomId}`);
      const snapshot = await get(roomRef);
      
      if (!snapshot.exists()) {
        toast.error('Room no longer exists');
        await remove(ref(realtimeDb, `roomInvites/${currentUser.uid}/${invite.id}`));
        return;
      }
      
      const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
      const userName = userDoc.data()?.username || currentUser.email?.split('@')[0] || 'User';
      
      await set(ref(realtimeDb, `rooms/${invite.roomId}/users/${currentUser.uid}`), userName);
      
      const roomData = snapshot.val();
      saveRoom(invite.roomId, roomData.name, roomData.code);
      
      // Remove invite
      await remove(ref(realtimeDb, `roomInvites/${currentUser.uid}/${invite.id}`));
      toast.success(`Joined ${invite.roomName}!`);
      
      // Navigate to rooms page
      navigate('/rooms');
    } catch (error) {
      console.error('Error accepting invite:', error);
      toast.error('Failed to join room');
    }
  };
  
  const declineInvite = async (invite: RoomInvite) => {
    if (!currentUser) return;
    await remove(ref(realtimeDb, `roomInvites/${currentUser.uid}/${invite.id}`));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
  };

  // Handle double tap on header
  const handleHeaderDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected
      setBlackScreenActive(true);
    }
    lastTapRef.current = now;
  };

  // Handle double tap on black screen to exit
  const handleBlackScreenDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected
      setBlackScreenActive(false);
    }
    lastTapRef.current = now;
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Black screen overlay for background listening */}
      {blackScreenActive && (
        <div 
          className="fixed inset-0 z-[9999] bg-black cursor-pointer flex items-center justify-center"
          onClick={handleBlackScreenDoubleTap}
          style={{ opacity: 0.98 }}
        >
          <p className="text-white/10 text-xs select-none">Double tap to exit</p>
        </div>
      )}

      {/* Mobile Header */}
      <header 
        className="bg-sidebar border-b border-sidebar-border p-3 flex items-center justify-between"
        onClick={handleHeaderDoubleTap}
      >
        <div className="flex items-center gap-2">
          <img src={logo} alt="SoulSync" className="w-8 h-8 object-contain" />
          <h1 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            SoulSync
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleLogout();
          }}
          className="text-sidebar-foreground hover:text-destructive"
        >
          <LogOut className="w-5 h-5" />
        </Button>
      </header>

      {/* Main Content - Reduced bottom padding for smaller nav */}
      <main className="flex-1 overflow-y-auto pb-36">
        {children}
      </main>

      {/* Global Room Invite Notifications */}
      {roomInvites.length > 0 && location.pathname !== '/rooms' && (
        <div className="fixed top-16 right-2 left-2 md:left-auto md:w-80 z-50 space-y-2">
          {roomInvites.slice(0, 2).map(invite => (
            <Card 
              key={invite.id}
              className="bg-card/95 backdrop-blur border-primary/30 p-3 shadow-lg shadow-primary/10 animate-fade-in"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
                  🎵
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Room Invite</p>
                  <p className="text-xs text-muted-foreground truncate">
                    <span className="text-primary">{invite.fromUser}</span> invited you to <span className="font-medium">{invite.roomName}</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  onClick={() => acceptInvite(invite)}
                  className="flex-1 bg-primary hover:bg-primary/90"
                >
                  <Check className="w-3 h-3 mr-1" />
                  Join
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => declineInvite(invite)}
                  className="px-2"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Bottom Navigation - Reduced height on mobile */}
      <nav className="fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border z-40">
        <div className="flex items-center justify-around px-1 py-1.5 md:py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all ${
                  isActive
                    ? 'text-primary'
                    : 'text-sidebar-foreground hover:text-primary'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'fill-primary' : ''}`} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
};