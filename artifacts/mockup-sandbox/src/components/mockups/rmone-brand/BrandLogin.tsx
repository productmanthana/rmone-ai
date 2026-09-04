import { useState } from "react";

export function BrandLogin() {
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="w-[390px] h-[844px] bg-white flex flex-col overflow-hidden mx-auto relative">
      <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />

      <div className="absolute top-0 right-0 overflow-hidden w-[200px] h-[200px]">
        <div className="absolute top-[-60px] right-[-50px] w-[200px] h-[200px] rounded-full border-[32px] border-[#8DC63F] opacity-15" />
        <div className="absolute top-[-45px] right-[-35px] w-[150px] h-[150px] rounded-full border-[22px] border-[#E07A35] opacity-10" />
      </div>

      <div className="relative z-10 pt-14 px-7 pb-6 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-10">
          <div className="flex items-center">
            <span className="text-2xl font-black text-[#1B3035]">RM</span>
            <span className="text-2xl font-black text-[#8DC63F]">ONE</span>
          </div>
          <div className="w-px h-5 bg-[#E2EAD8]" />
          <span className="text-[#8A9E8A] text-xs tracking-wider uppercase">AI Platform</span>
        </div>

        <h2 className="text-3xl font-bold text-[#1B3035] mb-2">Sign In</h2>
        <p className="text-[#8A9E8A] text-sm mb-8">Access your resource management dashboard</p>

        <div className="space-y-4 flex-1">
          <div>
            <label className="text-[#8DC63F] text-[10px] font-bold mb-2 block tracking-widest uppercase">Tenant / Organization</label>
            <div className="flex items-center bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl px-4 py-3.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span className="text-[#8A9E8A] text-sm">bcci</span>
            </div>
          </div>

          <div>
            <label className="text-[#8DC63F] text-[10px] font-bold mb-2 block tracking-widest uppercase">Email Address</label>
            <div className="flex items-center bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl px-4 py-3.5 focus-within:border-[#8DC63F]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
              </svg>
              <span className="text-[#8A9E8A] text-sm">sanket.lad@gmail.com</span>
            </div>
          </div>

          <div>
            <label className="text-[#8DC63F] text-[10px] font-bold mb-2 block tracking-widest uppercase">Password</label>
            <div className="flex items-center bg-[#F5F9F0] border border-[#E2EAD8] rounded-xl px-4 py-3.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8DC63F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-3 flex-shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span className="text-[#8A9E8A] text-sm flex-1">••••••••••••</span>
              <button onClick={() => setShowPass(!showPass)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B0C4B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="text-[#8DC63F] text-sm font-semibold">Forgot password?</button>
          </div>

          <button className="w-full bg-[#8DC63F] text-white font-bold py-4 rounded-xl shadow-md text-sm tracking-wide hover:bg-[#7AB82E] transition-colors">
            Sign In to RM ONE
          </button>
        </div>

        <div className="flex items-center justify-center mt-4">
          <div className="flex items-center gap-2 bg-[#F5F9F0] border border-[#E2EAD8] rounded-full px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-[#8DC63F]" />
            <span className="text-[#8A9E8A] text-[10px]">JWT Secured · TLS 1.3</span>
          </div>
        </div>
      </div>
    </div>
  );
}
