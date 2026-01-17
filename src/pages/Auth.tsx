import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import logo from '@/assets/logo.png';

const AUTH_MODE_KEY = 'soulsync_auth_mode';

export default function Auth() {

  // DEFAULT → SIGN UP
  const [isLogin, setIsLogin] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTH_MODE_KEY) === 'login';
    } catch {
      return false;
    }
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, signup, loginWithGoogle, currentUser } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(AUTH_MODE_KEY, 'login');
      navigate('/');
    }
  }, [currentUser, navigate]);

  const switchToLogin = () => {
    setIsLogin(true);
    localStorage.setItem(AUTH_MODE_KEY, 'login');
  };

  const switchToSignup = () => {
    setIsLogin(false);
    localStorage.setItem(AUTH_MODE_KEY, 'signup');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        toast.success('Welcome back!');
        localStorage.setItem(AUTH_MODE_KEY, 'login');
      } else {
        if (!username.trim()) {
          toast.error('Please enter a username');
          setLoading(false);
          return;
        }
        await signup(email, password, username);
        toast.success('Account created!');
        localStorage.setItem(AUTH_MODE_KEY, 'login'); // After signup → show login next time
      }

      navigate('/');

    } catch (error: any) {
      const code = error?.code || '';
      let message = 'Authentication failed';

      if (isLogin) {
        if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
          message = 'Incorrect email or password.';
        } else if (code === 'auth/user-not-found') {
          message = 'No account found with this email.';
        } else if (code === 'auth/too-many-requests') {
          message = 'Too many attempts. Please try again later.';
        }
      } else {
        if (code === 'auth/email-already-in-use') {
          message = 'This email is already registered. Please sign in.';
          switchToLogin();
        } else if (code === 'auth/weak-password') {
          message = 'Password should be at least 6 characters.';
        } else if (code === 'auth/invalid-email') {
          message = 'Please enter a valid email address.';
        }
      }

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      localStorage.setItem(AUTH_MODE_KEY, 'login');
      toast.success('Welcome!');
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Animated glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-glow-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-3xl animate-glow-pulse" style={{ animationDelay: '1s' }} />
      
      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-primary/30 rounded-full animate-float"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${3 + i * 0.5}s`
            }}
          />
        ))}
      </div>
      
      <Card className="w-full max-w-md p-8 glass backdrop-blur-xl border-primary/20 animate-fade-in shadow-glow-combined relative z-10">
        <div className="flex flex-col items-center mb-8">
          {/* Logo with glow effect */}
          <div className="relative mb-4 group">
            <div className="absolute -inset-4 bg-gradient-to-r from-primary via-secondary to-primary rounded-full opacity-50 blur-xl animate-pulse group-hover:opacity-75 transition-opacity" />
            <div className="relative">
              <img 
                src={logo} 
                alt="SoulSync" 
                className="w-20 h-20 object-contain drop-shadow-2xl animate-float"
                style={{ filter: 'drop-shadow(0 0 20px hsl(var(--primary) / 0.5))' }}
              />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent drop-shadow-glow-violet animate-fade-in" style={{ animationDelay: '0.2s' }}>
            SoulSync
          </h1>
          <p className="text-muted-foreground text-center mt-2 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            Your music, perfectly synced
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-2 animate-fade-in">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required={!isLogin}
                className="bg-input border-border"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-input border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-input border-border"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            variant="vibrant"
            className="w-full font-semibold py-6 rounded-xl"
          >
            {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Sign Up'}
          </Button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/50"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="px-3 text-muted-foreground bg-transparent backdrop-blur-sm">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full border-border hover:bg-muted"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-primary hover:text-accent transition-colors"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </Card>
    </div>
  );
}
