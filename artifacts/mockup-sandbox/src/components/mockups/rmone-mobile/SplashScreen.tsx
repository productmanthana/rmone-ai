export function SplashScreen() {
  return (
    <div className="w-[390px] h-[844px] bg-[#0A1628] flex flex-col items-center justify-center relative overflow-hidden mx-auto">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-[-80px] right-[-80px] w-[300px] h-[300px] rounded-full bg-[#1E3A5F] opacity-40" />
        <div className="absolute bottom-[-60px] left-[-60px] w-[250px] h-[250px] rounded-full bg-[#162847] opacity-50" />
        <div className="absolute top-[30%] left-[-40px] w-[140px] h-[140px] rounded-full bg-[#0D4F8C] opacity-20" />
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#3B82F6] to-transparent opacity-60" />
      </div>

      <div className="flex flex-col items-center z-10 px-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] flex items-center justify-center shadow-2xl mb-6">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <rect x="6" y="10" width="32" height="4" rx="2" fill="white" opacity="0.9" />
            <rect x="6" y="20" width="24" height="4" rx="2" fill="white" opacity="0.7" />
            <rect x="6" y="30" width="28" height="4" rx="2" fill="white" opacity="0.5" />
            <circle cx="35" cy="32" r="7" fill="#60A5FA" />
            <path d="M32 32l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="text-4xl font-bold text-white tracking-tight mb-1">
          RM<span className="text-[#3B82F6]">ONE</span>
        </h1>
        <p className="text-[#94A3B8] text-sm font-medium tracking-widest uppercase mb-2">
          Resource Management
        </p>
        <div className="w-12 h-[2px] bg-[#3B82F6] rounded-full mb-6" />
        <p className="text-[#64748B] text-xs text-center leading-relaxed">
          Powered by AI
        </p>
      </div>

      <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center z-10">
        <div className="flex space-x-2 mb-6">
          <div className="w-6 h-1.5 bg-[#3B82F6] rounded-full" />
          <div className="w-1.5 h-1.5 bg-[#334155] rounded-full" />
          <div className="w-1.5 h-1.5 bg-[#334155] rounded-full" />
        </div>
        <p className="text-[#334155] text-xs">© 2026 Vyaas AI Solutions</p>
      </div>

      <div className="absolute top-[50%] left-[50%] w-[600px] h-[600px] rounded-full border border-[#1E3A5F] opacity-20 transform -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-[50%] left-[50%] w-[400px] h-[400px] rounded-full border border-[#1E3A5F] opacity-30 transform -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}
