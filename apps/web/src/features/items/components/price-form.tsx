import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const inputClassName =
  "block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

const PRICE_MESSAGE = "Enter a price greater than 0.";

/**
 * Form-level schema — `register("price", { valueAsNumber: true })` feeds RHF's
 * numeric conversion (an empty field yields NaN, rejected with a friendly
 * message); the wire body is re-validated by createPriceObservationRequestSchema.
 * Shop is optional (T44): it is trimmed and submitted as "" when left empty.
 */
const priceFormSchema = z.object({
  price: z.number({ message: PRICE_MESSAGE }).positive(PRICE_MESSAGE),
  shop: z.string().trim(),
});
type PriceFormValues = z.infer<typeof priceFormSchema>;

export interface PriceFormProps {
  pending: boolean;
  error: string | null;
  onSave: (observation: { price: number; shop: string }) => void;
}

/** Price + shop form appending an observation via POST /items/:id/prices. */
export function PriceForm({ pending, error, onSave }: PriceFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PriceFormValues>({
    resolver: zodResolver(priceFormSchema),
    defaultValues: { price: Number.NaN, shop: "" },
  });

  const onSubmit = handleSubmit((values) => {
    onSave({ price: values.price, shop: values.shop });
    reset({ price: Number.NaN, shop: "" });
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="w-28 shrink-0">
          <label htmlFor="price-value" className={labelClassName}>
            Price
          </label>
          <input
            id="price-value"
            {...register("price", { valueAsNumber: true })}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder="1.99"
            className={`mt-1 ${inputClassName}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="price-shop" className={labelClassName}>
            Shop (optional)
          </label>
          <input
            id="price-shop"
            {...register("shop")}
            type="text"
            placeholder="e.g. Tops"
            className={`mt-1 ${inputClassName}`}
          />
        </div>
        <button
          type="submit"
          disabled={pending || isSubmitting}
          className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add price"}
        </button>
      </div>
      {errors.price ? (
        <p role="alert" className={fieldErrorClassName}>
          {errors.price.message}
        </p>
      ) : null}
      {errors.shop ? (
        <p role="alert" className={fieldErrorClassName}>
          {errors.shop.message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
