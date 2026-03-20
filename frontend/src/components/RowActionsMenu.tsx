import MoreVertIcon from "@mui/icons-material/MoreVert";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { type MouseEvent, type ReactNode, useState } from "react";

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
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  function openMenu(event: MouseEvent<HTMLElement>) {
    setAnchorEl(event.currentTarget);
  }

  function closeMenu() {
    setAnchorEl(null);
  }

  async function handleAction(action: RowAction) {
    closeMenu();
    await action.onClick();
  }

  return (
    <>
      <IconButton size="small" aria-label={ariaLabel} onClick={openMenu}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        {actions.map((action) => (
          <MenuItem key={action.key} onClick={() => void handleAction(action)} sx={action.danger ? { color: "error.main" } : undefined}>
            {action.icon ? <ListItemIcon sx={action.danger ? { color: "error.main" } : undefined}>{action.icon}</ListItemIcon> : null}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
