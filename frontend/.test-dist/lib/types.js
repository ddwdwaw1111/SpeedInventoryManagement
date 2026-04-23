export const DEFAULT_STORAGE_SECTION = "TEMP";
export function normalizeStorageSection(value) {
    const trimmed = (value ?? "").trim().toUpperCase();
    if (!trimmed) {
        return DEFAULT_STORAGE_SECTION;
    }
    return trimmed;
}
export function getLocationSectionOptions(location) {
    const sectionNames = location?.sectionNames
        ?.map((sectionName) => normalizeStorageSection(sectionName))
        .filter(Boolean) ?? [];
    return Array.from(new Set([DEFAULT_STORAGE_SECTION, ...sectionNames]));
}
export function buildInventoryProjectionKey(input) {
    return [
        String(input.customerId),
        String(input.locationId),
        normalizeStorageSection(input.storageSection),
        (input.containerNo ?? "").trim().toUpperCase(),
        String(input.skuMasterId)
    ].join(":");
}
export function toInventoryProjectionRef(item) {
    return {
        customerId: item.customerId,
        locationId: item.locationId,
        storageSection: normalizeStorageSection(item.storageSection),
        containerNo: (item.containerNo ?? "").trim().toUpperCase(),
        skuMasterId: item.skuMasterId
    };
}
