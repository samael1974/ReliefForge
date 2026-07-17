// src/pages/Relief.tsx
import BrandHero from "@/components/branding/BrandHero";
import ReliefWizard from "@/components/relief/ReliefWizard";

export default function ReliefPage() {
  return (
    <div className="min-h-screen bg-[#ECECEC]">
      <BrandHero showBackLink />

      <main className="mx-auto w-full max-w-6xl px-4 pb-12">
        <div className="rounded-2xl bg-white shadow-sm">
          <div className="p-4 sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-slate-900">
                Generatore bassorilievi
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Upload → Parametri → Heightmap → STL.
              </p>
            </div>

            <ReliefWizard />
          </div>
        </div>
      </main>
    </div>
  );
}
