const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "stroke-width": "1.6",
} as const;

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M16.862 4.487a1.5 1.5 0 0 1 2.121 2.122l-9.9 9.9-3.36.39.39-3.36 9.9-9.9Zm-12.6 14.4h15.3"
        {...strokeProps}
      />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"
        {...strokeProps}
      />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" {...strokeProps} />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5"
        {...strokeProps}
      />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm4.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM20 15l-4.5-4.5L8 18h12l0-3Z"
        {...strokeProps}
      />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15 8a3.5 3.5 0 1 1-3.4 4.3L10 13.9V16h-2v2H5v-3l5.3-5.3A3.5 3.5 0 0 1 15 8Zm1.2 2.3h.01"
        {...strokeProps}
      />
    </svg>
  );
}

export function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m20 10.5-8.1 8.1a5 5 0 0 1-7.07-7.07l8.84-8.84a3.33 3.33 0 0 1 4.71 4.71l-8.84 8.84a1.67 1.67 0 0 1-2.36-2.36l8.13-8.12"
        {...strokeProps}
      />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        {...strokeProps}
      />
      <circle cx="12" cy="12" r="2.6" {...strokeProps} />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 6c.46-.08.93-.13 1.4-.13 6 0 9.5 6.13 9.5 6.13a17.4 17.4 0 0 1-2.32 3.04M6.61 6.6A17 17 0 0 0 2.5 12S6 18.13 12 18.13c1.5 0 2.86-.38 4.05-.96M9.9 9.9a2.6 2.6 0 1 0 3.68 3.68"
        {...strokeProps}
      />
    </svg>
  );
}

export function CopyIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" {...strokeProps} />
    </svg>
  );
}

export function ChevronIcon(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" {...strokeProps} />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" {...strokeProps} />
      <path d="m16 16 4.5 4.5" {...strokeProps} />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" {...strokeProps} />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2.5" {...strokeProps} />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" {...strokeProps} />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-3Z"
        {...strokeProps}
      />
      <path d="m8.5 12 2.5 2.5 4.5-5" {...strokeProps} />
    </svg>
  );
}

export function IdentityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" {...strokeProps} />
      <circle cx="8.5" cy="10" r="2" {...strokeProps} />
      <path d="M5.5 16c.4-3 5.6-3 6 0M15 9h3M15 13h3" {...strokeProps} />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 17h16" {...strokeProps} />
      <circle
        cx="9"
        cy="7"
        r="3"
        fill="var(--settings-fill, #1d2420)"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <circle
        cx="15"
        cy="17"
        r="3"
        fill="var(--settings-fill, #1d2420)"
        stroke="currentColor"
        stroke-width="1.6"
      />
    </svg>
  );
}

export function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m10 5-7 7 7 7M3 12h18" {...strokeProps} />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14 5 7 7-7 7M3 12h18" {...strokeProps} />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v4h16v-4" {...strokeProps} />
    </svg>
  );
}
