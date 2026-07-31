import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { CircularProgress, Modal } from "@mui/material";

import { useI18n } from "../lib/i18n";

type ExportLoadingScreenProps = {
  open: boolean;
};

export function ExportLoadingScreen({ open }: ExportLoadingScreenProps) {
  const { t } = useI18n();

  return (
    <Modal
      className="export-loading-screen"
      open={open}
      sx={{ zIndex: (theme) => theme.zIndex.modal + 20 }}
    >
      <section
        className="export-loading-screen__card"
        role="status"
        aria-live="assertive"
        aria-label={t("exportLoadingTitle")}
        tabIndex={-1}
      >
        <div className="export-loading-screen__signal" aria-hidden="true">
          <CircularProgress size={54} thickness={2.6} />
          <FileDownloadOutlinedIcon />
        </div>
        <div className="export-loading-screen__copy">
          <span>{t("exportLoadingEyebrow")}</span>
          <strong>{t("exportLoadingTitle")}</strong>
          <p>{t("exportLoadingDesc")}</p>
        </div>
        <div className="export-loading-screen__track" aria-hidden="true">
          <span />
        </div>
      </section>
    </Modal>
  );
}
