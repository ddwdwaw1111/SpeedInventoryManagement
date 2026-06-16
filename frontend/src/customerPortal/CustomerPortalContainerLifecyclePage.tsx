import { useEffect, useState } from "react";

import { ContainerLifecycleView } from "../components/ContainerLifecycleView";
import { useI18n } from "../lib/i18n";
import { customerPortalApi } from "./api";
import type { CustomerPortalContainerLifecycle } from "./types";

type CustomerPortalContainerLifecyclePageProps = {
  containerNo: string | null;
  adminPortalCustomerId?: number;
  onBack: () => void;
  onError: (message: string) => void;
};

export function CustomerPortalContainerLifecyclePage({
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
      if (!containerNo) {
        setLifecycle(null);
        setErrorMessage("");
        return;
      }
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextLifecycle = await customerPortalApi.getContainerLifecycle(containerNo, adminPortalCustomerId);
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
  }, [adminPortalCustomerId, containerNo, onError, t]);

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
