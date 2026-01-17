import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Users, Copy, LogOut, Music2, UserPlus, Plus, Sparkles, Waves, ListMusic, SkipForward, Circle, Link2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useMusicPlayer } from '@/contexts/MusicPlayerContext';
import { realtimeDb } from '@/lib/firebaseRealtime';
import { ref, set, onValue, remove, push, get, update } from 'firebase/database';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { presenceService, UserPresence } from '@/services/presenceService';
import { roomPlaybackService } from '@/services/roomPlaybackService';
import { useRoomPersistence } from '@/hooks/useRoomPersistence';

interface FriendWithPresence {
  id: string;
  odacId: string;
  friendId: string;
  username: string;
  email?: string;
  presence?: UserPresence;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
}

interface Room {
  id: string;
  name: string;
  code: string;
  hostId: string;
  hostName: string;
  currentSong: Song | null;
  users: {
    [key: string]: string;
  };
  createdAt: number;
}

export default function Rooms() {
  const { currentUser } = useAuth();
  const {
    playSong,
    pauseSong,
    resumeSong,
    currentSong,
    isPlaying,
    seekTo,
    setVolume,
    volume,
    playerRef,
    setActiveRoom,
    roomQueue,
    nextSong,
    playRoomQueueItem
  } = useMusicPlayer();
  
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  
  // Friends for invite
  const [friendsWithPresence, setFriendsWithPresence] = useState<FriendWithPresence[]>([]);
  const [inviteCooldowns, setInviteCooldowns] = useState<{ [friendId: string]: number }>({});
  
  // Room invites received
  const [roomInvites, setRoomInvites] = useState<{ id: string; roomId: string; roomName: string; roomCode: string; fromUser: string; timestamp: number }[]>([]);
  
  const { persistedRoom, saveRoom, clearRoom } = useRoomPersistence();

  // Set active room in context when room changes
  useEffect(() => {
    if (currentRoom && currentUser) {
      setActiveRoom(currentRoom.id, currentUser.uid);
    } else {
      setActiveRoom(null, null);
    }
  }, [currentRoom?.id, currentUser?.uid, setActiveRoom]);

  // Auto-join room from URL params OR persisted room
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCodeParam = params.get('join');
    
    if (joinCodeParam && currentUser && !currentRoom) {
      setJoinCode(joinCodeParam);
      setJoinDialogOpen(true);
    } else if (persistedRoom && currentUser && !currentRoom) {
      console.log(`🔄 [Rooms] Auto-rejoining persisted room: ${persistedRoom.roomName}`);
      const autoRejoin = async () => {
        try {
          const roomRef = ref(realtimeDb, `rooms/${persistedRoom.roomId}`);
          const snapshot = await get(roomRef);
          
          if (snapshot.exists()) {
            const roomData = snapshot.val();
            const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
            const userName = userDoc.data()?.username || currentUser.email?.split('@')[0] || 'User';
            
            await set(ref(realtimeDb, `rooms/${persistedRoom.roomId}/users/${currentUser.uid}`), userName);
            
            setCurrentRoom({
              id: persistedRoom.roomId,
              ...roomData
            });
            console.log(`✅ [Rooms] Rejoined room: ${persistedRoom.roomName}`);
          } else {
            console.log(`⚠️ [Rooms] Persisted room no longer exists`);
            clearRoom();
          }
        } catch (error) {
          console.error('❌ [Rooms] Error rejoining room:', error);
          clearRoom();
        }
      };
      autoRejoin();
    }
  }, [currentUser, currentRoom, persistedRoom]);

  // Fetch friends with presence for invite dialog - use refs to avoid overwriting Friends page subscriptions
  const roomPresenceUnsubsRef = useRef<Map<string, () => void>>(new Map());
  
  useEffect(() => {
    if (!currentUser) return;
    
    const fetchFriendsWithPresence = async () => {
      const friendsQuery = query(collection(db, 'Friends'), where('userId', '==', currentUser.uid), where('status', '==', 'accepted'));
      const snapshot = await getDocs(friendsQuery);
      const ids = snapshot.docs.map(doc => doc.data().friendId);
      setFriendIds(ids);
      
      // Fetch friend details
      const friendsList: FriendWithPresence[] = [];
      for (const docSnap of snapshot.docs) {
        const friendData = docSnap.data();
        try {
          const friendDoc = await getDoc(doc(db, 'Users', friendData.friendId));
          if (friendDoc.exists()) {
            friendsList.push({
              id: docSnap.id,
              odacId: docSnap.id,
              friendId: friendData.friendId,
              username: friendDoc.data().username || friendDoc.data().email?.split('@')[0] || 'User',
              email: friendDoc.data().email || '',
            });
          }
        } catch (e) {
          console.error('Error fetching friend:', e);
        }
      }
      setFriendsWithPresence(friendsList);
      
      // Subscribe to presence for each friend - track separately from Friends page
      friendsList.forEach(friend => {
        // Skip if already subscribed in this component
        if (roomPresenceUnsubsRef.current.has(friend.friendId)) return;
        
        const unsub = presenceService.subscribeToUserPresence(friend.friendId, (presence) => {
          setFriendsWithPresence(prev => prev.map(f => 
            f.friendId === friend.friendId ? { ...f, presence: presence || undefined } : f
          ));
        });
        
        if (unsub) roomPresenceUnsubsRef.current.set(friend.friendId, unsub);
      });
    };
    
    fetchFriendsWithPresence();
    
    return () => {
      // Cleanup room-specific presence subscriptions
      roomPresenceUnsubsRef.current.forEach(unsub => unsub());
      roomPresenceUnsubsRef.current.clear();
    };
  }, [currentUser]);

  // Listen for room invites
  useEffect(() => {
    if (!currentUser) return;
    
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

  // Listen to all rooms
  useEffect(() => {
    const roomsRef = ref(realtimeDb, 'rooms');
    const unsubscribe = onValue(roomsRef, async snapshot => {
      const data = snapshot.val();
      if (data) {
        const roomsList = Object.entries(data).map(([id, room]: [string, any]) => ({
          id,
          ...room
        }));

        const now = Date.now();
        const INACTIVITY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

        // Auto-delete rooms with no users OR inactive for 24+ hours
        for (const room of roomsList) {
          const userCount = room.users ? Object.keys(room.users).length : 0;
          const createdAt = room.createdAt || 0;
          const lastActivity = room.lastActivity || createdAt;
          const isInactive = now - lastActivity > INACTIVITY_THRESHOLD;
          
          if (userCount === 0 || isInactive) {
            console.log(`🗑️ [Rooms] Deleting ${userCount === 0 ? 'empty' : 'inactive'} room: ${room.name || room.id}`);
            await remove(ref(realtimeDb, `rooms/${room.id}`));
          }
        }

        // Filter rooms
        const filteredRooms = roomsList.filter(room => {
          const userCount = room.users ? Object.keys(room.users).length : 0;
          const hasName = room.name && room.name.trim().length > 0;
          const createdAt = room.createdAt || 0;
          const lastActivity = room.lastActivity || createdAt;
          const isInactive = now - lastActivity > INACTIVITY_THRESHOLD;
          
          if (userCount === 0 || !hasName || isInactive) return false;

          const roomUserIds = room.users ? Object.keys(room.users) : [];
          const isUserInRoom = roomUserIds.includes(currentUser?.uid || '');
          const hasFriend = roomUserIds.some(uid => friendIds.includes(uid));
          
          return isUserInRoom || hasFriend;
        });
        setRooms(filteredRooms);
      } else {
        setRooms([]);
      }
    });
    return () => unsubscribe();
  }, [friendIds, currentUser]);

  // Set user presence
  useEffect(() => {
    if (!currentUser) return;
    
    presenceService.initUserPresence(currentUser.uid);
    presenceService.updatePresence(currentUser.uid, {
      currentRoom: currentRoom?.id
    });
    
    return () => {
      presenceService.updatePresence(currentUser.uid, {
        currentRoom: undefined
      });
    };
  }, [currentUser, currentRoom]);

  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const createRoom = async () => {
    if (!currentUser || !newRoomName.trim()) {
      toast.error('Please enter a room name');
      return;
    }
    setIsCreating(true);
    try {
      const code = generateRoomCode();
      const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
      const userName = userDoc.data()?.username || currentUser.email?.split('@')[0] || 'User';
      
      const roomsRef = ref(realtimeDb, 'rooms');
      const newRoomRef = push(roomsRef);
      
      if (!newRoomRef.key) {
        throw new Error('Failed to generate room key');
      }

      const roomData: any = {
        id: newRoomRef.key,
        name: newRoomName.trim(),
        code,
        hostId: currentUser.uid,
        hostName: userName,
        users: {
          [currentUser.uid]: userName
        },
        createdAt: Date.now()
      };

      if (currentSong) {
        roomData.currentSong = currentSong;
      }
      
      await set(newRoomRef, roomData);
      
      // Initialize playback state if there's a current song
      if (currentSong) {
        await roomPlaybackService.playSong(
          newRoomRef.key,
          currentUser.uid,
          currentSong.id,
          {
            title: currentSong.title,
            artist: currentSong.artist,
            thumbnail: currentSong.thumbnail
          },
          volume
        );
      }
      
      setCurrentRoom(roomData);
      saveRoom(newRoomRef.key, newRoomName.trim(), code);
      toast.success(`🎉 Room created! Code: ${code}`);
      setNewRoomName('');
      setCreateDialogOpen(false);
    } catch (error: any) {
      console.error('❌ [Rooms] Error creating room:', error);
      toast.error(error?.message || 'Failed to create room');
    } finally {
      setIsCreating(false);
    }
  };

  const joinRoom = async () => {
    if (!currentUser || !joinCode.trim()) return;
    try {
      const roomsRef = ref(realtimeDb, 'rooms');
      const snapshot = await get(roomsRef);
      const data = snapshot.val();
      if (!data) {
        toast.error('Room not found');
        return;
      }
      const roomEntry = Object.entries(data).find(([_, room]: [string, any]) => room.code === joinCode.toUpperCase());
      if (!roomEntry) {
        toast.error('Room not found');
        return;
      }
      const [roomId, roomData] = roomEntry as [string, any];
      const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
      const userName = userDoc.data()?.username || currentUser.email?.split('@')[0] || 'User';
      const roomRef = ref(realtimeDb, `rooms/${roomId}/users/${currentUser.uid}`);
      await set(roomRef, userName);
      const room = {
        id: roomId,
        ...roomData
      };
      setCurrentRoom(room);
      saveRoom(roomId, roomData.name, roomData.code);
      toast.success(`🎵 Joined ${roomData.name}!`);
      setJoinCode('');
      setJoinDialogOpen(false);
    } catch (error) {
      console.error('Error joining room:', error);
      toast.error('Failed to join room');
    }
  };

  const leaveRoom = async () => {
    if (!currentRoom || !currentUser) return;
    try {
      const isHost = currentUser.uid === currentRoom.hostId;
      const userCount = currentRoom.users ? Object.keys(currentRoom.users).length : 0;
      
      if (isHost && userCount > 1) {
        const otherUserId = Object.keys(currentRoom.users).find(id => id !== currentUser.uid);
        if (otherUserId) {
          const roomRef = ref(realtimeDb, `rooms/${currentRoom.id}`);
          await update(roomRef, { hostId: otherUserId });
          await remove(ref(realtimeDb, `rooms/${currentRoom.id}/users/${currentUser.uid}`));
          toast.success('Host transferred');
        }
      } else if (isHost) {
        await remove(ref(realtimeDb, `rooms/${currentRoom.id}`));
        toast.success('Room closed');
      } else {
        await remove(ref(realtimeDb, `rooms/${currentRoom.id}/users/${currentUser.uid}`));
        toast.success('Left room');
      }
      
      roomPlaybackService.unsubscribe(currentRoom.id);
      setCurrentRoom(null);
      clearRoom();
    } catch (error) {
      console.error('Error leaving room:', error);
      toast.error('Failed to leave room');
    }
  };

  // Send invite to friend via Firebase Realtime DB
  const sendInviteToFriend = async (friend: FriendWithPresence) => {
    if (!currentRoom || !currentUser) {
      toast.error('No room selected');
      return;
    }
    
    // Check cooldown
    const lastInvite = inviteCooldowns[friend.friendId];
    if (lastInvite && Date.now() - lastInvite < 15000) {
      toast.error('Wait 15 seconds before inviting again');
      return;
    }
    
    try {
      const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
      const myUsername = userDoc.data()?.username || currentUser.email?.split('@')[0] || 'Someone';
      
      // Send invite to friend's inbox
      const inviteData = {
        roomId: currentRoom.id,
        roomName: currentRoom.name,
        roomCode: currentRoom.code,
        fromUser: myUsername,
        fromUserId: currentUser.uid,
        timestamp: Date.now(),
      };
      
      const inviteRef = push(ref(realtimeDb, `roomInvites/${friend.friendId}`));
      await set(inviteRef, inviteData);
      
      setInviteCooldowns(prev => ({ ...prev, [friend.friendId]: Date.now() }));
      toast.success(`Invited ${friend.username}!`);
    } catch (error: any) {
      console.error('Error sending invite:', error);
      // More detailed error message
      if (error?.code === 'PERMISSION_DENIED') {
        toast.error('Permission denied - check database rules');
      } else {
        toast.error(`Failed to invite: ${error?.message || 'Unknown error'}`);
      }
    }
  };

  // Accept a room invite
  const acceptRoomInvite = async (invite: typeof roomInvites[0]) => {
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
      setCurrentRoom({ id: invite.roomId, ...roomData });
      saveRoom(invite.roomId, roomData.name, roomData.code);
      
      // Remove invite
      await remove(ref(realtimeDb, `roomInvites/${currentUser.uid}/${invite.id}`));
      toast.success(`Joined ${invite.roomName}!`);
    } catch (error) {
      console.error('Error accepting invite:', error);
      toast.error('Failed to join room');
    }
  };

  // Decline invite
  const declineRoomInvite = async (invite: typeof roomInvites[0]) => {
    if (!currentUser) return;
    await remove(ref(realtimeDb, `roomInvites/${currentUser.uid}/${invite.id}`));
  };

  const copyRoomLink = () => {
    if (!currentRoom) return;
    const inviteLink = `${window.location.origin}/rooms?join=${currentRoom.code}`;
    navigator.clipboard.writeText(inviteLink);
    toast.success('Invite link copied!');
  };

  const copyRoomCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('📋 Room code copied!');
  };

  // ============= Live Room Users Subscription =============
  const [liveRoomUsers, setLiveRoomUsers] = useState<{ [key: string]: string }>({});
  
  useEffect(() => {
    if (!currentRoom) {
      setLiveRoomUsers({});
      return;
    }
    
    // Subscribe specifically to current room's users for instant updates
    const usersRef = ref(realtimeDb, `rooms/${currentRoom.id}/users`);
    const unsubscribe = onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      console.log(`👥 [Rooms] Live users update: ${Object.keys(users).length} users`);
      setLiveRoomUsers(users);
    });
    
    return () => unsubscribe();
  }, [currentRoom?.id]);

  // ============= Room View =============
  if (currentRoom) {
    const userCount = Object.keys(liveRoomUsers).length || (currentRoom.users ? Object.keys(currentRoom.users).length : 0);
    const userNames = Object.values(liveRoomUsers).length > 0 ? Object.values(liveRoomUsers) : (currentRoom.users ? Object.values(currentRoom.users) : []);
    const isHost = currentUser?.uid === currentRoom.hostId;

    return (
      <div className="p-4 pb-36 animate-fade-in bg-background min-h-screen relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-20 left-1/4 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-40 right-1/4 w-96 h-96 bg-secondary/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <div className="relative z-10">
          {/* Header - Fixed for mobile */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-full blur opacity-60 animate-pulse" />
                <div className="relative w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center">
                  <Radio className="w-5 h-5 text-white" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent truncate">
                    {currentRoom.name}
                  </h1>
                  {isHost && (
                    <span className="px-2 py-0.5 text-[10px] bg-primary/20 text-primary rounded-full border border-primary/30 shrink-0">
                      Host
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs font-mono bg-muted/80 backdrop-blur px-2 py-0.5 rounded border border-border">
                    {currentRoom.code}
                  </code>
                  <Button size="icon" variant="ghost" onClick={() => copyRoomCode(currentRoom.code)} className="h-6 w-6">
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
            
            {/* Action buttons - always visible */}
            <div className="flex gap-2 flex-wrap">
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="border-primary/30 hover:bg-primary/10 flex-1 min-w-[100px]">
                    <UserPlus className="w-4 h-4 mr-1" />
                    Invite
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-card/95 backdrop-blur border-border w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      Invite Friends
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    {/* Friends list */}
                    {friendsWithPresence.length > 0 ? (
                      <div className="max-h-[45vh] overflow-y-auto pr-1 space-y-2">
                        {friendsWithPresence
                          .sort((a, b) => {
                            const aOnline = a.presence?.status === 'online' ? 1 : 0;
                            const bOnline = b.presence?.status === 'online' ? 1 : 0;
                            return bOnline - aOnline;
                          })
                          .map(friend => {
                            const isOnline = friend.presence?.status === 'online';
                            const lastSeen = friend.presence?.lastSeen || 0;
                            const isRecentlyOnline = isOnline || (Date.now() - lastSeen < 90000);
                            const isOnCooldown = inviteCooldowns[friend.friendId] && Date.now() - inviteCooldowns[friend.friendId] < 15000;
                            
                            // Check if friend is already in this room
                            const isInRoom = currentRoom && liveRoomUsers && Object.keys(liveRoomUsers).includes(friend.friendId);
                            
                            return (
                              <div 
                                key={friend.friendId}
                                className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg"
                              >
                                <div className="relative">
                                  <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center text-xs text-white font-bold">
                                    {friend.username.charAt(0).toUpperCase()}
                                  </div>
                                  <Circle 
                                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${isOnline ? 'text-green-500 fill-green-500' : 'text-muted-foreground fill-muted-foreground'}`}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{friend.username}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {isInRoom ? '🎵 Already in room' : isRecentlyOnline ? 'Online' : 'Offline'}
                                  </p>
                                </div>
                                {isInRoom ? (
                                  <span className="text-[10px] text-primary px-2 py-1 bg-primary/10 rounded-full">
                                    Listening
                                  </span>
                                ) : isRecentlyOnline ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => sendInviteToFriend(friend)}
                                    disabled={isOnCooldown}
                                    className="shrink-0"
                                  >
                                    <UserPlus className="w-3 h-3 mr-1" />
                                    {isOnCooldown ? 'Wait...' : 'Invite'}
                                  </Button>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No friends yet. Add friends first!
                      </p>
                    )}
                    
                    {/* Divider */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex-1 h-px bg-border" />
                      <span>or</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    
                    {/* Copy link button */}
                    <Button onClick={copyRoomLink} variant="outline" className="w-full">
                      <Link2 className="w-4 h-4 mr-2" />
                      Copy Invite Link
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowQueue(!showQueue)}
                className="border-primary/30 hover:bg-primary/10"
              >
                <ListMusic className="w-4 h-4 mr-1" />
                Queue ({roomQueue.length})
              </Button>
              
              <Button variant="destructive" size="sm" onClick={leaveRoom} className="shrink-0">
                <LogOut className="w-4 h-4 mr-1" />
                {isHost ? 'Close' : 'Leave'}
              </Button>
            </div>
          </div>

          {/* Queue Display */}
          {showQueue && roomQueue.length > 0 && (
            <Card className="bg-card/60 backdrop-blur border-border/50 p-4 mb-4 animate-fade-in">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-primary" />
                Up Next
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {roomQueue.map((item, i) => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => playRoomQueueItem(item.itemId)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg hover:bg-muted/40 transition-colors">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <img
                        src={item.song.thumbnail}
                        alt={`${item.song.title} thumbnail`}
                        className="w-10 h-10 rounded object-cover"
                        loading="lazy"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.song.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.song.artist}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Listeners Card */}
          <Card className="bg-card/60 backdrop-blur border-border/50 p-4 md:p-6 mb-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl" />
            
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Users className="w-5 h-5 text-primary" />
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  </div>
                  <span className="font-medium text-sm md:text-base">{userCount} listening</span>
                </div>
                <Waves className="w-5 h-5 text-primary/50 animate-pulse" />
              </div>

              {/* User avatars */}
              <div className="flex flex-wrap gap-2 mb-4">
                {userNames.map((name, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-full border border-border/50 animate-fade-in"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <div className="w-5 h-5 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center text-[10px] text-white font-bold">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium text-primary">{name}</span>
                  </div>
                ))}
              </div>

              {/* Now Playing */}
              {currentSong ? (
                <div className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-gradient-to-r from-primary/10 via-secondary/5 to-primary/10 rounded-xl border border-primary/20 animate-fade-in">
                  <div className="relative group shrink-0">
                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-lg blur opacity-40" />
                    <img 
                      src={currentSong.thumbnail} 
                      alt={currentSong.title} 
                      className="relative w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover shadow-lg" 
                    />
                    {isPlaying && (
                      <div className="absolute bottom-1 right-1 flex items-center gap-[2px] p-1 bg-black/60 rounded">
                        <span className="w-1 h-3 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.5s' }} />
                        <span className="w-1 h-4 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.7s' }} />
                        <span className="w-1 h-2 bg-primary rounded-full animate-pulse" style={{ animationDuration: '0.4s' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] md:text-xs text-primary uppercase tracking-wider mb-1">Now Playing</p>
                    <h3 className="font-bold text-sm md:text-lg truncate">{currentSong.title}</h3>
                    <p className="text-xs md:text-sm text-muted-foreground truncate">{currentSong.artist}</p>
                  </div>
                  {roomQueue.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={nextSong}
                      className="shrink-0"
                    >
                      <SkipForward className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground animate-fade-in">
                  <div className="relative mb-4">
                    <div className="absolute -inset-4 bg-primary/10 rounded-full blur-xl animate-pulse" />
                    <Music2 className="relative w-12 h-12 opacity-30" />
                  </div>
                  <p className="text-base font-medium">No song playing</p>
                  <p className="text-xs text-center max-w-xs mt-1">
                    Play any song from Home, Search, or Playlists - it'll sync with everyone!
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Tips */}
          <Card className="bg-muted/30 border-border/30 p-4">
            <h4 className="font-medium text-sm mb-2 text-primary">💡 Tips</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Any member can play, pause, or change songs</li>
              <li>• Timeline changes sync with everyone</li>
              <li>• Songs selected outside room add to queue</li>
              <li>• If audio feels out of sync, change the timeline or pause and play again to re-sync</li>
            </ul>
          </Card>
        </div>
      </div>
    );
  }

  // ============= Room List View =============
  return (
    <div className="p-4 pb-36 animate-fade-in bg-background min-h-screen relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-32 right-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-32 left-10 w-80 h-80 bg-secondary/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6 gap-2">
          <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">
            Music Rooms
          </h1>
          <div className="flex gap-2">
            <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-primary/30 hover:border-primary hover:bg-primary/10">
                  Join
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card/95 backdrop-blur border-border w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-lg">
                <DialogHeader>
                  <DialogTitle>Join Room</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <Input 
                    placeholder="Enter room code" 
                    value={joinCode} 
                    onChange={e => setJoinCode(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && joinRoom()} 
                    className="uppercase bg-input/50" 
                  />
                  <Button onClick={joinRoom} disabled={!joinCode.trim()} className="w-full btn-gradient-primary">
                    Join
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="btn-gradient-primary shadow-glow-violet">
                  <Plus className="w-4 h-4 mr-1" />
                  Create
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card/95 backdrop-blur border-border w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Create Room
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <Input 
                    placeholder="Room name" 
                    value={newRoomName} 
                    onChange={e => setNewRoomName(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && createRoom()} 
                    className="bg-input/50"
                  />
                  <Button onClick={createRoom} disabled={isCreating || !newRoomName.trim()} className="w-full btn-gradient-primary">
                    {isCreating ? 'Creating...' : 'Create Room'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-fade-in">
            <div className="relative mb-6">
              <div className="absolute -inset-6 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-full blur-2xl animate-pulse" />
              <Radio className="relative w-16 h-16 opacity-40" />
            </div>
            <p className="text-lg font-medium mb-2">No active rooms</p>
            <p className="text-sm text-center max-w-xs">Create a room to listen with friends in real-time</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room, index) => {
              const userCount = room.users ? Object.keys(room.users).length : 0;
              return (
                <Card 
                  key={room.id} 
                  className="group bg-card/60 backdrop-blur border-border/50 hover:border-primary/50 hover:shadow-glow-violet transition-all cursor-pointer p-4 md:p-6 animate-fade-in relative overflow-hidden"
                  style={{ animationDelay: `${index * 0.1}s` }}
                  onClick={async () => {
                    const roomRef = ref(realtimeDb, `rooms/${room.id}`);
                    const snapshot = await get(roomRef);
                    if (snapshot.exists()) {
                      const userDoc = await getDoc(doc(db, 'Users', currentUser!.uid));
                      const userName = userDoc.data()?.username || currentUser!.email?.split('@')[0] || 'User';
                      await set(ref(realtimeDb, `rooms/${room.id}/users/${currentUser!.uid}`), userName);
                      const roomData = snapshot.val();
                      setCurrentRoom({ id: room.id, ...roomData });
                      saveRoom(room.id, roomData.name, roomData.code);
                    }
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative shrink-0">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-secondary rounded-full blur opacity-50 group-hover:opacity-80 transition-opacity" />
                        <div className="relative w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center">
                          <Radio className="w-5 h-5 md:w-6 md:h-6 text-white" />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-base md:text-xl group-hover:text-primary transition-colors truncate">{room.name}</h3>
                        <p className="text-xs md:text-sm text-muted-foreground truncate">Host: <span className="text-primary">{room.hostName}</span></p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-border/50">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="w-4 h-4" />
                        <span className="text-xs md:text-sm">{userCount} listening</span>
                      </div>
                      <code className="text-xs font-mono bg-muted/50 px-2 py-1 rounded">
                        {room.code}
                      </code>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Room Invite Notifications - Fixed bottom right */}
      {roomInvites.length > 0 && (
        <div className="fixed bottom-20 right-4 z-50 space-y-2 max-w-xs">
          {roomInvites.slice(0, 3).map(invite => (
            <Card 
              key={invite.id}
              className="bg-card/95 backdrop-blur border-primary/30 p-3 animate-fade-in shadow-lg"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {invite.fromUser} invites you
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Join "{invite.roomName}"
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button 
                  size="sm" 
                  className="flex-1 btn-gradient-primary"
                  onClick={() => acceptRoomInvite(invite)}
                >
                  <Check className="w-3 h-3 mr-1" />
                  Join
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  className="flex-1"
                  onClick={() => declineRoomInvite(invite)}
                >
                  <X className="w-3 h-3 mr-1" />
                  Decline
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
