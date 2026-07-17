// src/components/branding/BrandHero.tsx
import { Link } from "react-router-dom";

type BrandHeroProps = {
  showBackLink?: boolean;
};

export default function BrandHero({ showBackLink = false }: BrandHeroProps) {
  // ✅ usa BASE_URL di Vite (robusto anche se cambi base path)
  const logoSrc = `${import.meta.env.BASE_URL}home/rf-logo.png`;

  return (
    <header className="bg-[#ECECEC]">
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* Badge tecnico */}
            <div className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
              Tool gratuito • STL manifold • PNG 16-bit • Nessun account
            </div>

            {/* Logo + H1 */}
            <div className="mt-4 flex items-center gap-3">
              <div
                className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-sm"
                aria-hidden="true"
              >
                <img
                  src={logoSrc}
                  alt="ReliefForge"
                  className="h-7 w-auto"
                  loading="eager"
                  onError={(e) => {
                    // fallback: nasconde l’immagine se manca (evita “icona rotta”)
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight text-[#1F4E5F] md:text-5xl">
                <span className="text-[#E26D5C]">R</span>elief
                <span className="text-[#E26D5C]">F</span>orge
              </h1>
            </div>

            {/* Value proposition */}
            <p className="mt-3 text-base text-slate-700 md:text-lg">
              <span className="font-semibold">Da foto a bassorilievo STL</span>{" "}
              pronto da stampare in pochi minuti.
            </p>

            {/* Micro-riga */}
            <div className="mt-3 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-slate-700">
              <span className="font-medium">Preview 3D</span>
              <span className="mx-2 opacity-50">·</span>
              <span className="font-medium">Controlli precisi</span>
              <span className="mx-2 opacity-50">·</span>
              <span className="font-medium">Export STL</span>
            </div>
          </div>

          {/* Back link (solo in /relief) */}
          {showBackLink ? (
            <Link
              to="/"
              className="shrink-0 text-sm underline text-gray-700 hover:text-gray-900"
            >
              Torna alla Home
            </Link>
          ) : null}
        </div>

        {/* Divider */}
        <div className="mt-6 h-px w-full bg-black/5" />
      </div>
    </header>
  );
}

