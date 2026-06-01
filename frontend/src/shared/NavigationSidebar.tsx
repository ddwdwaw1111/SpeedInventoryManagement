import type { ReactNode } from "react";

export type NavigationSidebarItem<TKey extends string> = {
  key: TKey;
  label: string;
  icon: ReactNode;
};

export type NavigationSidebarSection<TKey extends string> = {
  key: string;
  label: string;
  items: NavigationSidebarItem<TKey>[];
};

type NavigationSidebarClassNames = {
  root: string;
  rootCollapsed?: string;
  header?: string;
  primary?: string;
  primaryItem?: string;
  nav: string;
  section?: string;
  sectionToggle?: string;
  sectionToggleActive?: string;
  sectionLabel?: string;
  sectionChevron?: string;
  sectionChevronCollapsed?: string;
  sectionItems?: string;
  sectionItemsCollapsed?: string;
  item: string;
  itemActive: string;
  itemIcon: string;
  itemLabel?: string;
  collapseToggle?: string;
};

type NavigationSidebarCollapseToggle = {
  label: string;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
};

type NavigationSidebarProps<TKey extends string> = {
  activeKey: TKey;
  activeSectionKey?: string;
  ariaLabel: string;
  classNames: NavigationSidebarClassNames;
  collapsed?: boolean;
  collapsedSections?: Record<string, boolean>;
  collapseToggle?: NavigationSidebarCollapseToggle;
  header?: ReactNode;
  hideItemLabelsWhenCollapsed?: boolean;
  hideSectionHeadersWhenCollapsed?: boolean;
  items?: NavigationSidebarItem<TKey>[];
  navLabel?: string;
  onSelect: (key: TKey) => void;
  onToggleSection?: (key: string) => void;
  primaryItems?: NavigationSidebarItem<TKey>[];
  renderSectionChevron?: (section: NavigationSidebarSection<TKey>, isCollapsed: boolean) => ReactNode;
  sections?: NavigationSidebarSection<TKey>[];
  useAriaCurrent?: boolean;
};

export function NavigationSidebar<TKey extends string>({
  activeKey,
  activeSectionKey,
  ariaLabel,
  classNames,
  collapsed = false,
  collapsedSections = {},
  collapseToggle,
  header,
  hideItemLabelsWhenCollapsed = false,
  hideSectionHeadersWhenCollapsed = false,
  items = [],
  navLabel,
  onSelect,
  onToggleSection,
  primaryItems = [],
  renderSectionChevron,
  sections = [],
  useAriaCurrent = false
}: NavigationSidebarProps<TKey>) {
  const showItemLabels = !collapsed || !hideItemLabelsWhenCollapsed;
  const showSectionHeaders = !collapsed || !hideSectionHeadersWhenCollapsed;

  function renderItems(sidebarItems: NavigationSidebarItem<TKey>[], extraItemClassName?: string) {
    return sidebarItems.map((item) => (
      <button
        key={item.key}
        className={joinClassNames(
          classNames.item,
          extraItemClassName,
          activeKey === item.key ? classNames.itemActive : undefined
        )}
        type="button"
        aria-current={useAriaCurrent && activeKey === item.key ? "page" : undefined}
        title={!showItemLabels ? item.label : undefined}
        onClick={() => onSelect(item.key)}
      >
        <span className={classNames.itemIcon} aria-hidden="true">{item.icon}</span>
        {showItemLabels ? <span className={classNames.itemLabel}>{item.label}</span> : null}
      </button>
    ));
  }

  return (
    <aside className={joinClassNames(classNames.root, collapsed ? classNames.rootCollapsed : undefined)} aria-label={ariaLabel}>
      {header && classNames.header ? <div className={classNames.header}>{header}</div> : header}

      {primaryItems.length > 0 ? (
        <div className={classNames.primary}>{renderItems(primaryItems, classNames.primaryItem)}</div>
      ) : null}

      <nav className={classNames.nav} aria-label={navLabel ?? ariaLabel}>
        {items.length > 0 ? renderItems(items) : null}
        {sections.map((section) => {
          const isSectionCollapsed = Boolean(collapsedSections[section.key]);
          return (
            <section className={classNames.section} key={section.key}>
              {showSectionHeaders ? (
                <button
                  className={joinClassNames(
                    classNames.sectionToggle,
                    activeSectionKey === section.key ? classNames.sectionToggleActive : undefined
                  )}
                  type="button"
                  onClick={() => onToggleSection?.(section.key)}
                  aria-expanded={!isSectionCollapsed}
                >
                  <span className={classNames.sectionLabel}>{section.label}</span>
                  {renderSectionChevron ? renderSectionChevron(section, isSectionCollapsed) : null}
                </button>
              ) : null}
              <div
                className={joinClassNames(
                  classNames.sectionItems,
                  showSectionHeaders && isSectionCollapsed ? classNames.sectionItemsCollapsed : undefined
                )}
              >
                {renderItems(section.items)}
              </div>
            </section>
          );
        })}
      </nav>

      {collapseToggle ? (
        <button
          className={classNames.collapseToggle}
          type="button"
          onClick={collapseToggle.onClick}
          aria-label={collapseToggle.label}
          title={collapseToggle.title ?? collapseToggle.label}
        >
          {collapseToggle.icon}
        </button>
      ) : null}
    </aside>
  );
}

function joinClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}
