import { useState } from "react";

export function LoginScreen() {
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[220px] bg-gradient-to-b from-[#0D4F8C] to-transparent opacity-30" />

      <div className="relative z-10 pt-16 px-8 pb-6">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 44 44" fill="none">
              <rect x="6" y="10" width="32" height="4" rx="2" fill="white" opacity="0.9" />
              <rect x="6" y="20" width="24" height="4" rx="2" fill="white" opacity="0.7" />
              <rect x="6" y="30" width="28" height="4" rx="2" fill="white" opacity="0.5" />
              <circle cx="35" cy="32" r="7" fill="#60A5FA" />
              <path d="M32 32l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">RM<span className="text-[#3B82F6]">ONE</span></h1>
            <p className="text-[#64748B] text-[10px] tracking-widest uppercase">AI Platform</p>
          </div>
        </div>

        <h2 className="text-3xl font-bold text-white mb-2">Welcome back</h2>
        <p className="text-[#64748B] text-sm mb-10">Sign in to your account to continue</p>

        <div className="space-y-4">
          <div>
            <label className="text-[#94A3B8] text-xs font-medium mb-2 block tracking-wide uppercase">Email Address</label>
            <div className="flex items-center bg-[#0F2040] border border-[#1E3A5F] rounded-xl px-4 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <span className="text-[#475569] text-sm">sanket.lad@gmail.com</span>
            </div>
          </div>

          <div>
            <label className="text-[#94A3B8] text-xs font-medium mb-2 block tracking-wide uppercase">Password</label>
            <div className="flex items-center bg-[#0F2040] border border-[#1E3A5F] rounded-xl px-4 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span className="text-[#475569] text-sm flex-1">••••••••••••</span>
              <button onClick={() => setShowPass(!showPass)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="text-[#94A3B8] text-xs font-medium mb-2 block tracking-wide uppercase">Organization</label>
            <div className="flex items-center bg-[#0F2040] border border-[#1E3A5F] rounded-xl px-4 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span className="text-[#94A3B8] text-sm">bcci</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-3 mb-6">
          <button className="text-[#3B82F6] text-sm">Forgot password?</button>
        </div>

        <button className="w-full bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-white font-semibold py-4 rounded-xl shadow-lg shadow-blue-900/40 mb-6 text-sm tracking-wide">
          Sign In
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-[#1E3A5F]" />
          <span className="text-[#334155] text-xs">OR CONTINUE WITH</span>
          <div className="flex-1 h-px bg-[#1E3A5F]" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className="flex items-center justify-center gap-2 bg-[#0F2040] border border-[#1E3A5F] rounded-xl py-3 text-[#94A3B8] text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Google
          </button>
          <button className="flex items-center justify-center gap-2 bg-[#0F2040] border border-[#1E3A5F] rounded-xl py-3 text-[#94A3B8] text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#0078D4"><rect x="1" y="1" width="10" height="10" rx="1"/><rect x="13" y="1" width="10" height="10" rx="1"/><rect x="1" y="13" width="10" height="10" rx="1"/><rect x="13" y="13" width="10" height="10" rx="1"/></svg>
            Microsoft
          </button>
        </div>
      </div>

      <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center">
        <div className="flex items-center gap-2 bg-[#0F2040] border border-[#1E3A5F] rounded-full px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
          <span className="text-[#64748B] text-xs">Secured with JWT · TLS 1.3</span>
        </div>
      </div>
    </div>
  );
}
