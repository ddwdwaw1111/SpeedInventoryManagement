package service

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	pdf "rsc.io/pdf"
)

type InboundPackingListImportPreview struct {
	SourceFileName      string                         `json:"sourceFileName"`
	Title               string                         `json:"title"`
	ContainerNo         string                         `json:"containerNo"`
	ReferenceCode       string                         `json:"referenceCode"`
	UnitLabel           string                         `json:"unitLabel"`
	TotalQty            int                            `json:"totalQty"`
	TotalCartons        int                            `json:"totalCartons"`
	TotalNetWeightKgs   float64                        `json:"totalNetWeightKgs"`
	TotalGrossWeightKgs float64                        `json:"totalGrossWeightKgs"`
	Lines               []InboundPackingListImportLine `json:"lines"`
}

type InboundPackingListImportLine struct {
	Sequence       int     `json:"sequence"`
	ItemNumber     string  `json:"itemNumber"`
	SKU            string  `json:"sku"`
	Description    string  `json:"description"`
	Quantity       int     `json:"quantity"`
	UnitLabel      string  `json:"unitLabel"`
	CartonSizeMM   string  `json:"cartonSizeMm"`
	CartonCount    int     `json:"cartonCount"`
	NetWeightKgs   float64 `json:"netWeightKgs"`
	GrossWeightKgs float64 `json:"grossWeightKgs"`
}

type importedPDFTextFragment struct {
	X    float64
	Y    float64
	Text string
}

type importedPDFTextRow struct {
	Y         float64
	Fragments []importedPDFTextFragment
}

var (
	packingListHeaderKeywords = []string{"ITEM", "DESCRIPTION", "QTY", "UNIT", "CTN"}
	importedPDFContainerRE    = regexp.MustCompile(`\b[A-Z]{4}\d{7}\b`)
	importedPDFReferenceRE    = regexp.MustCompile(`\b[A-Z]{2}\d{7,}\b`)
)

func (s *Store) ImportInboundPackingListPreview(_ context.Context, fileName string, data []byte) (InboundPackingListImportPreview, error) {
	preview, err := parseInboundPackingListPreview(fileName, data)
	if err != nil {
		return InboundPackingListImportPreview{}, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
	}

	return preview, nil
}

func parseInboundPackingListPreview(fileName string, data []byte) (InboundPackingListImportPreview, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return InboundPackingListImportPreview{}, fmt.Errorf("open PDF: %w", err)
	}
	if reader.NumPage() == 0 {
		return InboundPackingListImportPreview{}, fmt.Errorf("the PDF has no readable pages")
	}

	page := reader.Page(1)
	if page.V.IsNull() {
		return InboundPackingListImportPreview{}, fmt.Errorf("the PDF first page could not be read")
	}

	content := page.Content()
	rows := groupImportedPDFRows(content.Text)
	if len(rows) == 0 {
		return InboundPackingListImportPreview{}, fmt.Errorf("no readable text rows were found in the PDF")
	}

	return parseImportedPackingListRows(fileName, rows)
}

func groupImportedPDFRows(texts []pdf.Text) []importedPDFTextRow {
	if len(texts) == 0 {
		return nil
	}

	fragments := make([]importedPDFTextFragment, 0, len(texts))
	for _, text := range texts {
		normalized := normalizeImportedPDFText(text.S)
		if normalized == "" {
			continue
		}

		fragments = append(fragments, importedPDFTextFragment{
			X:    text.X,
			Y:    text.Y,
			Text: normalized,
		})
	}

	sort.Slice(fragments, func(i, j int) bool {
		if math.Abs(fragments[i].Y-fragments[j].Y) > 1 {
			return fragments[i].Y > fragments[j].Y
		}
		return fragments[i].X < fragments[j].X
	})

	rows := make([]importedPDFTextRow, 0)
	for _, fragment := range fragments {
		if len(rows) == 0 || math.Abs(rows[len(rows)-1].Y-fragment.Y) > 2.4 {
			rows = append(rows, importedPDFTextRow{
				Y:         fragment.Y,
				Fragments: []importedPDFTextFragment{fragment},
			})
			continue
		}

		rows[len(rows)-1].Fragments = append(rows[len(rows)-1].Fragments, fragment)
	}

	for index := range rows {
		sort.Slice(rows[index].Fragments, func(i, j int) bool {
			return rows[index].Fragments[i].X < rows[index].Fragments[j].X
		})
	}

	return rows
}

func parseImportedPackingListRows(fileName string, rows []importedPDFTextRow) (InboundPackingListImportPreview, error) {
	preview := InboundPackingListImportPreview{
		SourceFileName: strings.TrimSpace(fileName),
		Title:          "Packing List",
		UnitLabel:      "PCS",
		Lines:          make([]InboundPackingListImportLine, 0),
	}

	headerRowIndex := -1
	for index, row := range rows {
		if isImportedPackingListHeaderRow(row) {
			headerRowIndex = index
			break
		}
	}
	if headerRowIndex < 0 {
		return InboundPackingListImportPreview{}, fmt.Errorf("could not find the packing list header row")
	}

	for _, row := range rows[:headerRowIndex] {
		rowText := joinImportedPDFRowText(row)
		upperText := strings.ToUpper(rowText)

		if strings.Contains(upperText, "PACKING LIST") {
			preview.Title = "Packing List"
		}
		if preview.ContainerNo == "" {
			preview.ContainerNo = firstImportedPDFMatch(importedPDFContainerRE, rowText)
		}
		if preview.ReferenceCode == "" {
			reference := firstImportedPDFMatch(importedPDFReferenceRE, rowText)
			if reference != "" && reference != preview.ContainerNo {
				preview.ReferenceCode = reference
			}
		}
	}

	for _, row := range rows[headerRowIndex+1:] {
		values := splitImportedPackingListRow(row)
		rowText := strings.ToUpper(joinImportedPackingListRowValues(values))

		if strings.Contains(rowText, "TOTAL") {
			continue
		}
		if strings.TrimSpace(values["sku"]) == "" || strings.TrimSpace(values["qty"]) == "" {
			continue
		}

		line := InboundPackingListImportLine{
			Sequence:       parseImportedPDFInt(values["sequence"]),
			ItemNumber:     strings.TrimSpace(values["sku"]),
			SKU:            strings.TrimSpace(values["sku"]),
			Description:    strings.TrimSpace(values["description"]),
			Quantity:       parseImportedPDFInt(values["qty"]),
			UnitLabel:      firstNonEmpty(strings.TrimSpace(values["unit"]), preview.UnitLabel),
			CartonSizeMM:   strings.TrimSpace(values["cartonSize"]),
			CartonCount:    parseImportedPDFInt(values["ctn"]),
			NetWeightKgs:   parseImportedPDFFloat(values["net"]),
			GrossWeightKgs: parseImportedPDFFloat(values["gross"]),
		}
		if line.Quantity <= 0 {
			continue
		}

		if preview.UnitLabel == "" && line.UnitLabel != "" {
			preview.UnitLabel = line.UnitLabel
		}
		preview.TotalQty += line.Quantity
		preview.TotalCartons += line.CartonCount
		preview.TotalNetWeightKgs += line.NetWeightKgs
		preview.TotalGrossWeightKgs += line.GrossWeightKgs
		preview.Lines = append(preview.Lines, line)
	}

	if preview.ContainerNo == "" {
		preview.ContainerNo = firstImportedPDFMatch(importedPDFContainerRE, preview.SourceFileName)
	}
	if preview.ReferenceCode == "" {
		preview.ReferenceCode = firstImportedPDFMatch(importedPDFReferenceRE, preview.SourceFileName)
	}
	if len(preview.Lines) == 0 {
		return InboundPackingListImportPreview{}, fmt.Errorf("no importable receipt lines were found in the PDF")
	}

	return preview, nil
}

func isImportedPackingListHeaderRow(row importedPDFTextRow) bool {
	rowText := strings.ToUpper(joinImportedPDFRowText(row))
	if strings.Contains(rowText, "TOTAL") {
		return false
	}

	matchCount := 0
	for _, keyword := range packingListHeaderKeywords {
		if strings.Contains(rowText, keyword) {
			matchCount++
		}
	}

	return matchCount >= 4
}

func splitImportedPackingListRow(row importedPDFTextRow) map[string]string {
	values := map[string][]string{
		"sequence":    {},
		"sku":         {},
		"description": {},
		"qty":         {},
		"unit":        {},
		"cartonSize":  {},
		"ctn":         {},
		"net":         {},
		"gross":       {},
	}

	for _, fragment := range row.Fragments {
		text := normalizeImportedPDFText(fragment.Text)
		if text == "" {
			continue
		}

		switch {
		case fragment.X < 32:
			values["sequence"] = append(values["sequence"], text)
		case fragment.X < 118:
			values["sku"] = append(values["sku"], text)
		case fragment.X < 245:
			values["description"] = append(values["description"], text)
		case fragment.X < 304:
			values["qty"] = append(values["qty"], text)
		case fragment.X < 348:
			values["unit"] = append(values["unit"], text)
		case fragment.X < 452:
			values["cartonSize"] = append(values["cartonSize"], text)
		case fragment.X < 490:
			values["ctn"] = append(values["ctn"], text)
		case fragment.X < 544:
			values["net"] = append(values["net"], text)
		default:
			values["gross"] = append(values["gross"], text)
		}
	}

	joined := make(map[string]string, len(values))
	for key, parts := range values {
		joined[key] = normalizeImportedPDFText(strings.Join(parts, " "))
	}

	return joined
}

func joinImportedPDFRowText(row importedPDFTextRow) string {
	parts := make([]string, 0, len(row.Fragments))
	for _, fragment := range row.Fragments {
		if text := normalizeImportedPDFText(fragment.Text); text != "" {
			parts = append(parts, text)
		}
	}

	return normalizeImportedPDFText(strings.Join(parts, " "))
}

func joinImportedPackingListRowValues(values map[string]string) string {
	parts := []string{
		values["sequence"],
		values["sku"],
		values["description"],
		values["qty"],
		values["unit"],
		values["cartonSize"],
		values["ctn"],
		values["net"],
		values["gross"],
	}

	return normalizeImportedPDFText(strings.Join(parts, " "))
}

func normalizeImportedPDFText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func parseImportedPDFInt(value string) int {
	sanitized := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if sanitized == "" {
		return 0
	}

	number, err := strconv.Atoi(sanitized)
	if err != nil {
		return 0
	}

	return number
}

func parseImportedPDFFloat(value string) float64 {
	sanitized := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if sanitized == "" {
		return 0
	}

	number, err := strconv.ParseFloat(sanitized, 64)
	if err != nil {
		return 0
	}

	return number
}

func firstImportedPDFMatch(pattern *regexp.Regexp, value string) string {
	return strings.TrimSpace(pattern.FindString(strings.ToUpper(strings.TrimSpace(value))))
}
