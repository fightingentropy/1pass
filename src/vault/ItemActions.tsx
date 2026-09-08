import { createEffect, on, onCleanup, onMount } from "solid-js";
import { MoreIcon, PencilIcon, TrashIcon } from "./icons";

export default function ItemActions(props: {
  itemId: string;
  itemType: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  let menuRef: HTMLDetailsElement | undefined;
  const close = () => {
    if (menuRef) menuRef.open = false;
  };
  createEffect(on(() => props.itemId, close));
  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef?.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef?.open) return;
      close();
      menuRef.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
  return (
    <div class="detail-actions">
      <button
        class="btn ghost small"
        type="button"
        aria-label={`Edit ${props.itemType}`}
        onClick={props.onEdit}
      >
        <PencilIcon />
        Edit
      </button>
      <details class="item-actions-menu" ref={menuRef}>
        <summary
          class="icon-button icon-only"
          aria-label={`More actions for ${props.itemType}`}
          title="More actions"
        >
          <MoreIcon />
        </summary>
        <div class="overflow-panel">
          <button
            class="danger"
            type="button"
            onClick={() => {
              close();
              props.onDelete();
            }}
          >
            <TrashIcon />
            Delete {props.itemType}
          </button>
        </div>
      </details>
    </div>
  );
}
