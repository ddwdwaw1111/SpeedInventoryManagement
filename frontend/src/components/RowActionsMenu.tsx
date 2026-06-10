import { MoreVertical } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

type RowAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void | Promise<void>;
};

type RowActionsMenuProps = {
  actions: RowAction[];
  ariaLabel: string;
};

export function RowActionsMenu({ actions, ariaLabel }: RowActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function closeMenu() {
    setIsOpen(false);
  }

  async function handleAction(action: RowAction) {
    closeMenu();
    await action.onClick();
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="row-actions-menu" ref={menuRef}>
      <button
        className="row-actions-menu__trigger"
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MoreVertical size={16} strokeWidth={2.1} />
      </button>
      {isOpen ? (
        <div className="row-actions-menu__content" role="menu">
        {actions.map((action) => (
          <button
            className={`row-actions-menu__item ${action.danger ? "row-actions-menu__item--danger" : ""}`}
            key={action.key}
            type="button"
            role="menuitem"
            onClick={() => void handleAction(action)}
          >
            {action.icon ? <span className="row-actions-menu__item-icon">{action.icon}</span> : null}
            <span>{action.label}</span>
          </button>
        ))}
        </div>
      ) : null}
    </div>
  );
}
