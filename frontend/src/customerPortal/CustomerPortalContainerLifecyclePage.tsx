import { useEffect, useState } from "react";

import { ContainerLifecycleView } from "../components/ContainerLifecycleView";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import type { CustomerPortalContainerLifecycle } from "./types";

type CustomerPortalContainerLifecyclePageProps = {
  containerId: number | null;
  containerNo: string | null;
  adminPortalCustomerId?: number;
  onBack: () => void;
  onError: (message: string) => void;
};

export function CustomerPortalContainerLifecyclePage({
  containerId,
  containerNo,
  adminPortalCustomerId,
  onBack,
  onError
}: CustomerPortalContainerLifecyclePageProps) {
  const { t } = useI18n();
  const [lifecycle, setLifecycle] = useState<CustomerPortalContainerLifecycle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadLifecycle() {
      if (!containerId || containerId <= 0) {
        setLifecycle(null);
        setErrorMessage("");
        return;
      }
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextLifecycle = await customerPortalApi.getContainerLifecycle(containerId, adminPortalCustomerId);
        if (!active) return;
        setLifecycle(nextLifecycle);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : t("customerPortalLoadFailed");
        setErrorMessage(message);
        onError(message);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadLifecycle();
    return () => {
      active = false;
    };
  }, [adminPortalCustomerId, containerId, onError, t]);

  return (
    <ContainerLifecycleView
      containerNo={containerNo}
      lifecycle={lifecycle}
      visibilityMode="customer"
      isLoading={isLoading}
      errorMessage={errorMessage}
      onBack={onBack}
    />
  );
}
