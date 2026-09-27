import { useParams } from "react-router-dom";

/**
 * Placeholder details target for the main screen's long-press / right-click
 * (docs/TASKS.md → T16). The full details view — editing, image, price history
 * — is T18.
 */
export function ItemDetailsPage() {
  const { itemId } = useParams<{ itemId: string }>();
  return (
    <div className="min-h-dvh bg-gray-50 p-4">
      <p className="text-sm text-gray-500">Item details for {itemId} — coming soon.</p>
    </div>
  );
}
