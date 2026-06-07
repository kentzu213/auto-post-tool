'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import api from '@/lib/api';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useAppStore((s) => s.login);

  // Shared: turn a Supabase session into a local account + JWT, then enter the app.
  const syncSupabaseSession = async (session: any) => {
    const res = await api.post<{
      accessToken: string;
      user: { id: string; name: string; email: string };
      defaultWorkspace: { id: string; name: string; role: string } | null;
    }>('/auth/supabase-sync', {
      email: session.user.email,
      name:
        session.user.user_metadata?.name ||
        session.user.user_metadata?.full_name ||
        session.user.email?.split('@')[0] ||
        'User',
      supabaseToken: session.access_token,
    });
    login(res.user, res.accessToken, res.defaultWorkspace?.id || 'default');
    window.location.href = '/dashboard';
  };

  // After a Google/GitHub OAuth redirect, the Supabase client restores the
  // session from the URL. Detect it and finish the local sync automatically.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let done = false;
    const finish = async (session: any) => {
      if (done || !session) return;
      done = true;
      try {
        setLoading(true);
        await syncSupabaseSession(session);
      } catch (e: any) {
        setError(e?.message || 'Đồng bộ tài khoản thất bại.');
        setLoading(false);
        done = false;
      }
    };
    supabase.auth.getSession().then(({ data }: any) => {
      if (data?.session) finish(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e: any, session: any) => {
      if (session) finish(session);
    });
    return () => sub?.subscription?.unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start an OAuth login (Google / GitHub) via Supabase. Returns to /login,
  // where the effect above completes the sync.
  const handleOAuth = async (provider: 'google' | 'github') => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setError('Đăng nhập mạng xã hội cần Supabase được cấu hình.');
      return;
    }
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (oauthErr) setError(oauthErr.message);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isLogin) {
        if (isSupabaseConfigured && supabase) {
          console.log('🌐 Logging in via Supabase...');
          // 1. Đăng nhập qua Supabase
          const { data, error: supabaseError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (supabaseError) {
            throw new Error(supabaseError.message);
          }

          if (!data || !data.session) {
            throw new Error('Không thể khởi tạo phiên làm việc với Supabase.');
          }

          console.log('🔄 Syncing user session with local NestJS API...');
          // 2. Gửi token đồng bộ lên NestJS API local
          const res = await api.post<{
            accessToken: string;
            user: { id: string; name: string; email: string };
            defaultWorkspace: { id: string; name: string; role: string } | null;
          }>('/auth/supabase-sync', {
            email: data.user.email,
            name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
            supabaseToken: data.session.access_token,
          });

          // 3. Đăng nhập thành công -> Cập nhật trạng thái
          login(res.user, res.accessToken, res.defaultWorkspace?.id || 'default');
          window.location.href = '/dashboard';
        } else {
          console.log('🔌 Supabase not configured. Falling back to local auth...');
          // Fallback: Đăng nhập Local truyền thống
          const res = await api.post<{
            accessToken: string;
            user: { id: string; name: string; email: string };
            defaultWorkspace: { id: string; name: string; role: string } | null;
          }>('/auth/login', { email, password });

          login(res.user, res.accessToken, res.defaultWorkspace?.id || 'default');
          window.location.href = '/dashboard';
        }
      } else {
        if (isSupabaseConfigured && supabase) {
          // Đăng ký qua Supabase
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                name,
              },
            },
          });

          if (signUpError) {
            throw new Error(signUpError.message);
          }

          setSuccess('Đăng ký tài khoản Supabase thành công! Vui lòng xác thực email (nếu có) hoặc tiến hành đăng nhập.');
          setIsLogin(true);
          setPassword('');
        } else {
          // Đăng ký Local
          await api.post('/auth/register', { email, password, name });
          setSuccess('Đăng ký thành công! Hãy đăng nhập.');
          setIsLogin(true);
          setPassword('');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={styles.wrapper}>
      {/* Animated background */}
      <div style={styles.bgGlow1} />
      <div style={styles.bgGlow2} />
      <div style={styles.bgGlow3} />

      <div style={styles.container}>
        {/* Logo & Brand */}
        <div style={styles.brand}>
          <div style={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <h1 style={styles.brandName}>AutoPost</h1>
          <p style={styles.brandDesc}>
            Nền tảng quản lý & đăng bài tự động đa kênh
          </p>
        </div>

        {/* Auth Card */}
        <div style={styles.card}>
          {/* Tab Switch */}
          <div style={styles.tabs}>
            <button
              onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
              style={{
                ...styles.tab,
                ...(isLogin ? styles.tabActive : {}),
              }}
            >
              Đăng nhập
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
              style={{
                ...styles.tab,
                ...(!isLogin ? styles.tabActive : {}),
              }}
            >
              Đăng ký
            </button>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div style={styles.errorBox}>
              <span style={styles.errorIcon}>⚠️</span>
              {error}
            </div>
          )}
          {success && (
            <div style={styles.successBox}>
              <span style={styles.errorIcon}>✅</span>
              {success}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={styles.form}>
            {!isLogin && (
              <div style={styles.field}>
                <label style={styles.label}>Họ và tên</label>
                <div style={styles.inputWrap}>
                  <span style={styles.inputIcon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    required={!isLogin}
                    style={styles.input}
                  />
                </div>
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <div style={styles.inputWrap}>
                <span style={styles.inputIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Mật khẩu</label>
              <div style={styles.inputWrap}>
                <span style={styles.inputIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  required
                  minLength={6}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {isLogin && (
              <div style={styles.forgotRow}>
                <label style={styles.rememberLabel}>
                  <input type="checkbox" style={styles.checkbox} />
                  <span>Ghi nhớ đăng nhập</span>
                </label>
                <button type="button" style={styles.forgotLink}>Quên mật khẩu?</button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitBtn,
                ...(loading ? styles.submitBtnDisabled : {}),
              }}
            >
              {loading ? (
                <span style={styles.spinner} />
              ) : isLogin ? (
                'Đăng nhập'
              ) : (
                'Tạo tài khoản'
              )}
            </button>
          </form>

          {/* Divider */}
          <div style={styles.divider}>
            <span style={styles.dividerLine} />
            <span style={styles.dividerText}>hoặc tiếp tục với</span>
            <span style={styles.dividerLine} />
          </div>

          {/* Social Login */}
          <div style={styles.socialRow}>
            <button type="button" onClick={() => handleOAuth('google')} disabled={loading} style={{ ...styles.socialBtn, ...styles.socialGoogle }}>
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Google
            </button>
            <button type="button" onClick={() => handleOAuth('github')} disabled={loading} style={{ ...styles.socialBtn, ...styles.socialGithub }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              GitHub
            </button>
          </div>

          {/* Bottom text */}
          <p style={styles.bottomText}>
            {isLogin ? (
              <>Chưa có tài khoản? <button onClick={() => setIsLogin(false)} style={styles.switchLink}>Đăng ký ngay</button></>
            ) : (
              <>Đã có tài khoản? <button onClick={() => setIsLogin(true)} style={styles.switchLink}>Đăng nhập</button></>
            )}
          </p>
        </div>

        {/* Footer */}
        <p style={styles.footer}>
          © 2026 AutoPost — Powered by AI
        </p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        @keyframes float1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-40px, 30px) scale(1.15); }
          66% { transform: translate(30px, -40px) scale(0.85); }
        }
        @keyframes float3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, 40px) scale(1.08); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        input::placeholder {
          color: rgba(148, 163, 184, 0.6);
        }
        input:focus {
          outline: none;
          border-color: #6366f1 !important;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15), 0 0 20px rgba(99, 102, 241, 0.1) !important;
        }
        button[type="submit"]:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
        }
        button[type="submit"]:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Inline styles — Premium Dark Theme
// ============================================================
const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f0a1a 0%, #1a1035 30%, #0d1b2a 70%, #0a0f1e 100%)',
    fontFamily: "'Inter', -apple-system, sans-serif",
    position: 'relative',
    overflow: 'hidden',
    padding: '20px',
  },
  bgGlow1: {
    position: 'absolute',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
    top: '-150px',
    right: '-100px',
    animation: 'float1 15s ease-in-out infinite',
    pointerEvents: 'none' as const,
  },
  bgGlow2: {
    position: 'absolute',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
    bottom: '-100px',
    left: '-80px',
    animation: 'float2 18s ease-in-out infinite',
    pointerEvents: 'none' as const,
  },
  bgGlow3: {
    position: 'absolute',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)',
    top: '50%',
    left: '60%',
    animation: 'float3 12s ease-in-out infinite',
    pointerEvents: 'none' as const,
  },
  container: {
    width: '100%',
    maxWidth: '440px',
    position: 'relative',
    zIndex: 1,
  },
  brand: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  logoIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
    color: 'white',
    boxShadow: '0 8px 32px rgba(99,102,241,0.3)',
  },
  brandName: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#ffffff',
    margin: '0 0 6px',
    letterSpacing: '-0.5px',
  },
  brandDesc: {
    fontSize: '14px',
    color: 'rgba(148, 163, 184, 0.8)',
    margin: 0,
  },
  card: {
    background: 'rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(99, 102, 241, 0.15)',
    borderRadius: '20px',
    padding: '32px',
    boxShadow: '0 25px 50px rgba(0,0,0,0.4), 0 0 80px rgba(99,102,241,0.05)',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(30, 41, 59, 0.6)',
    borderRadius: '12px',
    padding: '4px',
    marginBottom: '24px',
  },
  tab: {
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: 'transparent',
    color: 'rgba(148, 163, 184, 0.8)',
    fontFamily: "'Inter', sans-serif",
  },
  tabActive: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#ffffff',
    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    color: '#fca5a5',
    fontSize: '13px',
    marginBottom: '16px',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '12px',
    color: '#86efac',
    fontSize: '13px',
    marginBottom: '16px',
  },
  errorIcon: {
    fontSize: '16px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '18px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'rgba(203, 213, 225, 0.9)',
  },
  inputWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute' as const,
    left: '14px',
    color: 'rgba(148, 163, 184, 0.5)',
    display: 'flex',
    pointerEvents: 'none' as const,
  },
  input: {
    width: '100%',
    padding: '12px 14px 12px 44px',
    background: 'rgba(30, 41, 59, 0.6)',
    border: '1px solid rgba(71, 85, 105, 0.4)',
    borderRadius: '12px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontFamily: "'Inter', sans-serif",
    transition: 'all 0.2s ease',
    boxSizing: 'border-box' as const,
  },
  eyeBtn: {
    position: 'absolute' as const,
    right: '12px',
    background: 'none',
    border: 'none',
    color: 'rgba(148, 163, 184, 0.5)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    transition: 'color 0.2s',
  },
  forgotRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '-4px',
  },
  rememberLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: 'rgba(148, 163, 184, 0.8)',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: '#6366f1',
    cursor: 'pointer',
  },
  forgotLink: {
    background: 'none',
    border: 'none',
    color: '#818cf8',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    fontWeight: 500,
  },
  submitBtn: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    borderRadius: '12px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    transition: 'all 0.2s ease',
    marginTop: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    letterSpacing: '0.3px',
  },
  submitBtnDisabled: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTop: '2px solid #ffffff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.6s linear infinite',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '24px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(71, 85, 105, 0.4)',
  },
  dividerText: {
    fontSize: '12px',
    color: 'rgba(148, 163, 184, 0.6)',
    whiteSpace: 'nowrap' as const,
  },
  socialRow: {
    display: 'flex',
    gap: '12px',
  },
  socialBtn: {
    flex: 1,
    padding: '11px',
    border: '1px solid rgba(71, 85, 105, 0.4)',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  socialGoogle: {
    background: 'rgba(30, 41, 59, 0.6)',
    color: '#e2e8f0',
  },
  socialGithub: {
    background: 'rgba(30, 41, 59, 0.6)',
    color: '#e2e8f0',
  },
  bottomText: {
    textAlign: 'center' as const,
    fontSize: '13px',
    color: 'rgba(148, 163, 184, 0.7)',
    marginTop: '20px',
    marginBottom: 0,
  },
  switchLink: {
    background: 'none',
    border: 'none',
    color: '#818cf8',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: "'Inter', sans-serif",
    textDecoration: 'underline',
  },
  footer: {
    textAlign: 'center' as const,
    fontSize: '12px',
    color: 'rgba(100, 116, 139, 0.5)',
    marginTop: '24px',
  },
};
