import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { IconButton } from "@mui/material";
import type { KeyboardEvent } from "react";

type SearchSubmitFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  submitTitle: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function SearchSubmitField({
  label,
  placeholder,
  value,
  submitTitle,
  onChange,
  onSubmit
}: SearchSubmitFieldProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onSubmit();
  }

  return (
    <label>
      {label}
      <span className="search-submit-field">
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <IconButton
          type="button"
          size="small"
          className="search-submit-field__button"
          aria-label={submitTitle}
          title={submitTitle}
          onClick={onSubmit}
        >
          <SearchOutlinedIcon fontSize="small" />
        </IconButton>
      </span>
    </label>
  );
}
