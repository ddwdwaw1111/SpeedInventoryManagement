export type PageFeedbackNotice = {
  severity: "success" | "error";
  message: string;
};

const PAGE_FEEDBACK_STORAGE_KEY = "sim-page-feedback";

export function queuePageFeedback(notice: PageFeedbackNotice) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PAGE_FEEDBACK_STORAGE_KEY, JSON.stringify(notice));
}

export function consumePageFeedback(): PageFeedbackNotice | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(PAGE_FEEDBACK_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(PAGE_FEEDBACK_STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as PageFeedbackNotice;
    return parsed?.message ? parsed : null;
  } catch {
    return null;
  }
}
