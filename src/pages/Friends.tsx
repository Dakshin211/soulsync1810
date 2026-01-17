import React, { useState, useEffect, useRef } from 'react';
import { UserPlus, Check, X, Users as UsersIcon, Music2, Radio, Circle, MoreVertical, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { 
  collection, addDoc, getDocs, deleteDoc, doc, query, 
  where, updateDoc, onSnapshot, getDoc, orderBy, limit, Timestamp, writeBatch
} from 'firebase/firestore';
import { toast } from 'sonner';
import { presenceService, UserPresence } from '@/services/presenceService';

interface Friend {
  id: string;
  odacId: string;
  friendId: string;
  username: string;
  nickname?: string;
  status: 'pending' | 'accepted';
  requestedBy: string;
  createdAt: any;
  presence?: UserPresence;
  email?: string;
}

export default function Friends() {
  const { currentUser } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Friend[]>([]);
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  // Nickname edit state
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
  const [editingFriend, setEditingFriend] = useState<Friend | null>(null);
  const [newNickname, setNewNickname] = useState('');

  // Track presence subscriptions so we don't break global presence heartbeat
  const subscribedPresenceIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to friends and their presence
  useEffect(() => {
    if (!currentUser) return;

    const friendsQuery = query(
      collection(db, 'Friends'),
      where('userId', '==', currentUser.uid)
    );
    
    const unsubscribe = onSnapshot(friendsQuery, async (snapshot) => {
      const data = await Promise.all(
        snapshot.docs.map(async (docSnapshot) => {
          const friendData = docSnapshot.data();
          let username = 'Unknown User';
          let email = '';
          
          try {
            const friendDoc = await getDoc(doc(db, 'Users', friendData.friendId));
            if (friendDoc.exists()) {
              username = friendDoc.data().username || friendDoc.data().email?.split('@')[0] || 'User';
              email = friendDoc.data().email || '';
            }
          } catch (error) {
            console.error('Error fetching friend data:', error);
          }

          return {
            id: docSnapshot.id,
            odacId: docSnapshot.id,
            ...friendData,
            username,
            email,
            nickname: friendData.nickname || ''
          } as Friend;
        })
      );

      const acceptedFriends = data.filter(f => f.status === 'accepted');
      const pendingRequests = data.filter(f => f.status === 'pending' && f.requestedBy !== currentUser.uid);

      // Sync presence subscriptions (add new, remove stale)
      const nextIds = new Set(acceptedFriends.map(f => f.friendId));
      subscribedPresenceIdsRef.current.forEach((id) => {
        if (!nextIds.has(id)) {
          presenceService.unsubscribe(id);
          subscribedPresenceIdsRef.current.delete(id);
        }
      });

      acceptedFriends.forEach(friend => {
        if (subscribedPresenceIdsRef.current.has(friend.friendId)) return;
        subscribedPresenceIdsRef.current.add(friend.friendId);

        presenceService.subscribeToUserPresence(friend.friendId, (presence) => {
          setFriends(prev => prev.map(f => 
            f.friendId === friend.friendId ? { ...f, presence: presence || undefined } : f
          ));
        });
      });

      setFriends(acceptedFriends);
      setRequests(pendingRequests);
    });

    return () => {
      unsubscribe();
      subscribedPresenceIdsRef.current.forEach((id) => presenceService.unsubscribe(id));
      subscribedPresenceIdsRef.current.clear();
    };
  }, [currentUser]);

  const sendFriendRequest = async () => {
    if (!currentUser || !searchEmail.trim()) return;
    
    setIsSearching(true);
    try {
      const usersQuery = query(
        collection(db, 'Users'),
        where('email', '==', searchEmail.toLowerCase())
      );
      const userSnapshot = await getDocs(usersQuery);

      if (userSnapshot.empty) {
        toast.error('User not found');
        return;
      }

      const friendUser = userSnapshot.docs[0];
      const friendId = friendUser.id;

      if (friendId === currentUser.uid) {
        toast.error('You cannot add yourself');
        return;
      }

      const existingQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', currentUser.uid),
        where('friendId', '==', friendId)
      );
      const existing = await getDocs(existingQuery);

      if (!existing.empty) {
        toast.error('Friend request already sent');
        return;
      }

      await addDoc(collection(db, 'Friends'), {
        userId: currentUser.uid,
        friendId: friendId,
        status: 'pending',
        requestedBy: currentUser.uid,
        createdAt: Timestamp.now()
      });

      await addDoc(collection(db, 'Friends'), {
        userId: friendId,
        friendId: currentUser.uid,
        status: 'pending',
        requestedBy: currentUser.uid,
        createdAt: Timestamp.now()
      });

      toast.success('Friend request sent!');
      setSearchEmail('');
      setDialogOpen(false);
    } catch (error) {
      console.error('Error sending request:', error);
      toast.error('Failed to send request');
    } finally {
      setIsSearching(false);
    }
  };

  const acceptRequest = async (friendshipId: string, friendId: string) => {
    if (!currentUser) return;
    
    try {
      const myFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', currentUser.uid),
        where('friendId', '==', friendId)
      );
      const theirFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', friendId),
        where('friendId', '==', currentUser.uid)
      );
      
      const [mySnapshot, theirSnapshot] = await Promise.all([
        getDocs(myFriendshipQuery),
        getDocs(theirFriendshipQuery)
      ]);
      
      const batch = writeBatch(db);
      mySnapshot.docs.forEach(d => batch.update(d.ref, { status: 'accepted' }));
      theirSnapshot.docs.forEach(d => batch.update(d.ref, { status: 'accepted' }));
      
      await batch.commit();
      toast.success('Friend request accepted!');
    } catch (error) {
      console.error('Error accepting request:', error);
      toast.error('Failed to accept');
    }
  };

  const rejectRequest = async (friendshipId: string, friendId: string) => {
    if (!currentUser) return;
    
    try {
      const myFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', currentUser.uid),
        where('friendId', '==', friendId)
      );
      const theirFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', friendId),
        where('friendId', '==', currentUser.uid)
      );
      
      const [mySnapshot, theirSnapshot] = await Promise.all([
        getDocs(myFriendshipQuery),
        getDocs(theirFriendshipQuery)
      ]);
      
      const batch = writeBatch(db);
      mySnapshot.docs.forEach(d => batch.delete(d.ref));
      theirSnapshot.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();
      toast.success('Request rejected');
    } catch (error) {
      console.error('Error rejecting:', error);
      toast.error('Failed to reject');
    }
  };

  const deleteFriend = async (friend: Friend) => {
    if (!currentUser) return;
    
    try {
      const myFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', currentUser.uid),
        where('friendId', '==', friend.friendId)
      );
      const theirFriendshipQuery = query(
        collection(db, 'Friends'),
        where('userId', '==', friend.friendId),
        where('friendId', '==', currentUser.uid)
      );
      
      const [mySnapshot, theirSnapshot] = await Promise.all([
        getDocs(myFriendshipQuery),
        getDocs(theirFriendshipQuery)
      ]);
      
      const batch = writeBatch(db);
      mySnapshot.docs.forEach(d => batch.delete(d.ref));
      theirSnapshot.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();
      toast.success('Friend removed');
    } catch (error) {
      console.error('Error deleting friend:', error);
      toast.error('Failed to remove friend');
    }
  };

  const openNicknameDialog = (friend: Friend) => {
    setEditingFriend(friend);
    setNewNickname(friend.nickname || '');
    setNicknameDialogOpen(true);
  };

  const saveNickname = async () => {
    if (!currentUser || !editingFriend) return;
    
    try {
      await updateDoc(doc(db, 'Friends', editingFriend.id), {
        nickname: newNickname.trim()
      });
      toast.success('Nickname updated!');
      setNicknameDialogOpen(false);
      setEditingFriend(null);
      setNewNickname('');
    } catch (error) {
      console.error('Error updating nickname:', error);
      toast.error('Failed to update nickname');
    }
  };

  const getPresenceStatus = (friend: Friend) => {
    const presence = friend.presence;
    if (!presence) return { color: 'bg-muted-foreground/50', text: 'Offline', isOnline: false };

    // Use the presence service's determination (already checks heartbeat)
    const isOnline = presence.status === 'online';

    if (isOnline) {
      if (presence.currentRoom) {
        return { 
          color: 'bg-violet-500', 
          text: 'In Room', 
          isOnline: true,
          icon: <Radio className="w-3 h-3" />
        };
      }
      if (presence.currentSong) {
        return { 
          color: 'bg-green-500', 
          text: `Listening: ${presence.currentSong.title}`, 
          isOnline: true,
          icon: <Music2 className="w-3 h-3" />
        };
      }
      return { color: 'bg-green-500', text: 'Online', isOnline: true };
    }

    return { color: 'bg-muted-foreground/50', text: 'Offline', isOnline: false };
  };

  const getDisplayName = (friend: Friend) => {
    return friend.nickname || friend.username;
  };

  return (
    <div className="p-4 pb-36 animate-fade-in bg-background min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
          Friends
        </h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="btn-gradient-primary shadow-glow-pink">
              <UserPlus className="w-5 h-5 mr-2" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card/95 backdrop-blur border-border w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-lg">
            <DialogHeader>
              <DialogTitle>Add Friend</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                type="email"
                placeholder="Enter friend's email"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendFriendRequest()}
                className="bg-input border-border"
              />
              <Button 
                onClick={sendFriendRequest}
                disabled={isSearching || !searchEmail.trim()}
                className="w-full btn-gradient-primary"
              >
                {isSearching ? 'Searching...' : 'Send Request'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Nickname Dialog */}
      <Dialog open={nicknameDialogOpen} onOpenChange={setNicknameDialogOpen}>
        <DialogContent className="bg-card/95 backdrop-blur border-border w-[calc(100vw-2rem)] sm:w-full sm:max-w-md rounded-lg">
          <DialogHeader>
            <DialogTitle>Change Nickname</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <Input
              placeholder="Enter nickname (leave empty to use username)"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
              className="bg-input border-border"
            />
            <Button 
              onClick={saveNickname}
              className="w-full btn-gradient-primary"
            >
              Save Nickname
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Friend Requests */}
      {requests.length > 0 && (
        <div className="mb-8 animate-fade-in">
          <h2 className="text-lg font-bold mb-4 text-foreground">Friend Requests</h2>
          <div className="space-y-3">
            {requests.map((request) => (
              <Card key={request.id} className="bg-card border-border p-4 animate-fade-in">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="w-12 h-12 shrink-0">
                      <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white font-bold">
                        {request.username.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="font-bold text-foreground truncate">{request.username}</h3>
                      <p className="text-sm text-muted-foreground">wants to be friends</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => acceptRequest(request.id, request.friendId)}
                      className="btn-gradient-primary"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectRequest(request.id, request.friendId)}
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Online Friends */}
      {friends.filter(f => getPresenceStatus(f).isOnline).length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-4 text-foreground flex items-center gap-2">
            <Circle className="w-3 h-3 bg-green-500 fill-green-500 rounded-full" />
            Online Now
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {friends.filter(f => getPresenceStatus(f).isOnline).map((friend) => {
              const presenceStatus = getPresenceStatus(friend);
              return (
                <Card 
                  key={friend.id} 
                  className="bg-card/60 backdrop-blur border-border/50 p-4 hover:shadow-glow-pink hover:border-primary/50 transition-all animate-fade-in"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-12 h-12 relative shrink-0">
                      <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white font-bold">
                        {getDisplayName(friend).charAt(0).toUpperCase()}
                      </AvatarFallback>
                      <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ${presenceStatus.color} border-2 border-background`} />
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-foreground truncate">{getDisplayName(friend)}</h3>
                      {friend.nickname && (
                        <p className="text-xs text-muted-foreground truncate">@{friend.username}</p>
                      )}
                      <div className="flex items-center gap-1 text-xs text-green-500">
                        {presenceStatus.icon}
                        <span className="truncate">{presenceStatus.text}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0">
                          <MoreVertical className="w-5 h-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-card border-border">
                        <DropdownMenuItem onClick={() => openNicknameDialog(friend)} className="cursor-pointer">
                          <Pencil className="w-4 h-4 mr-2" />
                          Change Nickname
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => deleteFriend(friend)} 
                          className="text-destructive focus:text-destructive cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove Friend
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* All Friends */}
      <h2 className="text-lg font-bold mb-4 text-foreground">All Friends</h2>
      
      {friends.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <UsersIcon className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-medium">No friends yet</p>
          <p className="text-sm">Add friends to listen together</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {friends.map((friend) => {
            const presenceStatus = getPresenceStatus(friend);
            return (
              <Card 
                key={friend.id} 
                className="bg-card/60 backdrop-blur border-border/50 p-4 hover:shadow-glow-pink hover:border-primary/50 transition-all animate-fade-in"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="w-12 h-12 relative shrink-0">
                    <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white font-bold">
                      {getDisplayName(friend).charAt(0).toUpperCase()}
                    </AvatarFallback>
                    <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ${presenceStatus.color} border-2 border-background`} />
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-foreground truncate">{getDisplayName(friend)}</h3>
                    {friend.nickname && (
                      <p className="text-xs text-muted-foreground truncate">@{friend.username}</p>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {presenceStatus.icon}
                      <span className="truncate">{presenceStatus.text}</span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        <MoreVertical className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-card border-border">
                      <DropdownMenuItem onClick={() => openNicknameDialog(friend)} className="cursor-pointer">
                        <Pencil className="w-4 h-4 mr-2" />
                        Change Nickname
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => deleteFriend(friend)} 
                        className="text-destructive focus:text-destructive cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove Friend
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}