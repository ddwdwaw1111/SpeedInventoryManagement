import { Search } from "lucide-react";
import type { KeyboardEvent } from "react";

export type SearchSubmitFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  submitTitle: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function SearchSubmitField({
  label,
  placeholder,
  value,
  disabled = false,
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
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="search-submit-field__button"
          aria-label={submitTitle}
          title={submitTitle}
          disabled={disabled}
          onClick={onSubmit}
        >
          <Search size={15} strokeWidth={2.2} />
        </button>
      </span>
    </label>
  );
}
