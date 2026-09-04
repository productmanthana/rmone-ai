export function BrandSplash() {
  return (
    <div className="w-[390px] h-[844px] bg-white flex flex-col items-center justify-center relative overflow-hidden mx-auto">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-[-80px] right-[-60px] w-[320px] h-[320px] rounded-full border-[48px] border-[#8DC63F] opacity-15" />
        <div className="absolute top-[-60px] right-[-40px] w-[220px] h-[220px] rounded-full border-[32px] border-[#E07A35] opacity-12" />
        <div className="absolute bottom-[-100px] left-[-70px] w-[300px] h-[300px] rounded-full border-[40px] border-[#8DC63F] opacity-10" />
        <div className="absolute top-[180px] left-[-30px] w-[160px] h-[160px] rounded-full border-[24px] border-[#8DC63F] opacity-12" />
        <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#8DC63F]" />
      </div>

      <div className="flex flex-col items-center z-10 px-8">
        <div className="flex items-center gap-1 mb-3">
          <span className="text-5xl font-black text-[#1B3035] tracking-tight">RM</span>
          <span className="text-5xl font-black text-[#8DC63F] tracking-tight">ONE</span>
        </div>
        <div className="w-14 h-[3px] bg-[#8DC63F] rounded-full mb-4" />
        <p className="text-[#8A9E8A] text-sm font-medium tracking-widest uppercase mb-2 text-center">
          Resource Management Platform
        </p>
        <p className="text-[#C0CFC0] text-xs text-center leading-relaxed">
          AI-Powered Resource Management
        </p>
      </div>

      <div className="absolute bottom-20 left-0 right-0 flex flex-col items-center z-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-1.5 bg-[#8DC63F] rounded-full" />
          <div className="w-1.5 h-1.5 bg-[#E2EAD8] rounded-full" />
          <div className="w-1.5 h-1.5 bg-[#E2EAD8] rounded-full" />
        </div>
        <p className="text-[#C0CFC0] text-xs">Powered by Vyaas AI</p>
      </div>
    </div>
  );
}
