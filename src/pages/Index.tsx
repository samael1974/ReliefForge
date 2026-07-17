// src/pages/Index.tsx
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Index() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#ECECEC]">
      {/* TOP BAR */}
      <div className="mx-auto flex max-w-6xl items-center justify-end px-4 pt-4">
        <LanguageSwitcher />
      </div>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div className="space-y-5">
            <div className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
              {t("badge")}
            </div>

            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-sm"
                aria-hidden="true"
              >
                <img
                  src="/home/rf-logo.png"
                  alt="ReliefForge"
                  className="h-7 w-4.5"
                  loading="eager"
                />
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight text-[#1F4E5F] md:text-5xl">
                <span className="text-[#E26D5C]">R</span>elief
                <span className="text-[#E26D5C]">F</span>orge
              </h1>
            </div>

            <p className="text-sm text-slate-600 md:text-base">{t("heroLead")}</p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="bg-[#E26D5C] text-white hover:bg-[#d85f50]">
                <Link to="/relief">{t("ctaGenerator")}</Link>
              </Button>

              <Button
                asChild
                variant="outline"
                className="border-[#F5A623] text-[#1F4E5F] hover:bg-white"
              >
                <Link to="/depth">{t("ctaDepth")}</Link>
              </Button>
            </div>

            <p className="text-sm text-slate-600">{t("donateInline")}</p>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-2xl bg-white shadow">
              <img
                src="/home/hero-relief.webp"
                alt="ReliefForge"
                className="h-auto w-full object-cover"
                loading="eager"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">{t("heroCaption")}</p>
          </div>
        </div>
      </section>

      {/* 3 CARD: COME FUNZIONA */}
      <section className="mx-auto max-w-6xl px-4 pb-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-[#1F4E5F]">{t("step1Title")}</h3>
              <p className="mt-2 text-sm text-slate-600">{t("step1Body")}</p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-[#1F4E5F]">{t("step2Title")}</h3>
              <p className="mt-2 text-sm text-slate-600">{t("step2Body")}</p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-[#1F4E5F]">{t("step3Title")}</h3>
              <p className="mt-2 text-sm text-slate-600">{t("step3Body")}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* DONAZIONE */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <div className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold text-[#1F4E5F]">{t("donateTitle")}</h2>
              <p className="mt-2 text-sm text-slate-600">{t("donateBody")}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="bg-[#E26D5C] text-white hover:bg-[#d85f50]">
                <a
                  href="https://www.paypal.me/federicocordioli72"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("donatePaypal")}
                </a>
              </Button>

              <div className="flex items-center gap-2 rounded-xl bg-[#ECECEC] px-3 py-2">
                <img src="/home/paypal.webp" alt="PayPal" className="h-6 w-6" loading="lazy" />
                <span className="text-xs text-slate-600">{t("donateSmall")}</span>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">{t("donateTip")}</p>
        </div>
      </section>

      <footer className="border-t border-black/5 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">
          {t("footerTag")}
        </div>
      </footer>
    </div>
  );
}
