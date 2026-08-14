package service

import (
	"regexp"
	"testing"
	"time"
)

func TestGenerateBillingInvoiceNoIncludesBillingPeriodAndRandomNumber(t *testing.T) {
	periodStart := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	periodEnd := time.Date(2026, time.August, 15, 0, 0, 0, 0, time.UTC)

	invoiceNo := generateBillingInvoiceNo(periodStart, periodEnd)
	if !regexp.MustCompile(`^INV-2026-0801-0815-[0-9]{5}$`).MatchString(invoiceNo) {
		t.Fatalf("invoice number %q does not match the expected billing-period format", invoiceNo)
	}
}
