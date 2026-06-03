import { type FormEvent, type ReactNode, useState } from "react";
import { ArrowRight, Building2, ClipboardCheck, FileText, PackageSearch, ShieldCheck } from "lucide-react";

import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { InfoTooltip } from "../components/ui/tooltip";
import { useI18n } from "../lib/i18n";
import { InlineAlert } from "./sharedUi";
import type { LoginPayload, SignUpPayload } from "./types";

type CustomerPortalAuthPageProps = {
  onLogin: (payload: LoginPayload) => Promise<void>;
  onSignUp: (payload: SignUpPayload) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
};

export function CustomerPortalAuthPage({
  onLogin,
  onSignUp: _onSignUp,
  isSubmitting,
  errorMessage
}: CustomerPortalAuthPageProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onLogin({ email, password });
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid min-h-screen w-[min(1180px,calc(100vw-2rem))] grid-cols-1 gap-6 py-6 lg:grid-cols-[minmax(0,1.05fr)_420px] lg:items-center">
        <section className="grid content-center gap-8 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-sm font-black tracking-wider text-white">
              SI
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("customerPortal")}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{t("inventorySystem")}</h1>
            </div>
          </div>

          <div className="max-w-2xl">
            <h2 className="text-4xl font-semibold tracking-tight text-slate-950">{t("customerPortalSignInTitle")}</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">{t("customerPortalAuthDesc")}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <AuthFeature icon={<PackageSearch className="h-5 w-5" />} title={t("customerPortalAuthInventoryTitle")} description={t("customerPortalAuthInventoryDesc")} />
            <AuthFeature icon={<Building2 className="h-5 w-5" />} title={t("customerPortalAuthPackingListTitle")} description={t("customerPortalAuthPackingListDesc")} tooltip={t("customerPortalInboundTooltip")} />
            <AuthFeature icon={<ClipboardCheck className="h-5 w-5" />} title={t("customerPortalAuthDocumentTitle")} description={t("customerPortalAuthDocumentDesc")} tooltip={t("customerPortalOutboundTooltip")} />
          </div>
        </section>

        <Card>
          <CardHeader>
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle>{t("customerPortalCustomerAccess")}</CardTitle>
            <CardDescription>{t("customerPortalSignInTitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => { void handleSubmit(event); }}>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("email")}
                <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("emailPlaceholder")} autoComplete="email" />
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                {t("password")}
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("userPasswordPlaceholder")} autoComplete="current-password" />
              </label>

              {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

              <Button className="w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("signingIn") : t("signIn")}
                <ArrowRight className="h-4 w-4" />
              </Button>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Button asChild variant="outline" className="w-full">
                  <a href="/admin">
                    <FileText className="h-4 w-4" />
                    <span>{t("adminEntrance")}</span>
                  </a>
                </Button>
                <span className="mt-2 block text-center text-xs leading-5 text-slate-500">{t("adminEntranceHint")}</span>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AuthFeature({ icon, title, description, tooltip }: { icon: ReactNode; title: string; description: string; tooltip?: string }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-700 shadow-sm">
        {icon}
      </div>
      <strong className="flex items-center gap-1.5 text-sm font-semibold text-slate-950">
        {title}
        {tooltip ? <InfoTooltip content={tooltip} /> : null}
      </strong>
      <span className="mt-1 block text-sm leading-6 text-slate-500">{description}</span>
    </article>
  );
}
