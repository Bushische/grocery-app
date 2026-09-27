import { type LoginRequest, loginRequestSchema } from "@grocery/shared";
import { Field, Input, Label } from "@headlessui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiClientError } from "../../../lib/api-client";
import { useLogin } from "../hooks/use-login";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Please try again.";

const inputClassName =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";
const labelClassName = "block text-sm font-medium text-gray-700";
const fieldErrorClassName = "mt-1 text-sm text-red-600";

export function LoginPage() {
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login.mutateAsync(values);
    } catch (error) {
      setServerError(
        error instanceof ApiClientError && error.status === 401
          ? INVALID_CREDENTIALS_MESSAGE
          : UNEXPECTED_ERROR_MESSAGE,
      );
    }
  });

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gray-50 px-4">
      <form
        noValidate
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200"
      >
        <h1 className="text-xl font-semibold text-gray-900">My Groceries</h1>
        <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>

        <div className="mt-6 space-y-4">
          <Field>
            <Label className={labelClassName}>Email</Label>
            <Input
              {...register("email")}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className={inputClassName}
            />
            {errors.email ? (
              <p role="alert" className={fieldErrorClassName}>
                {errors.email.message}
              </p>
            ) : null}
          </Field>
          <Field>
            <Label className={labelClassName}>Password</Label>
            <Input
              {...register("password")}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputClassName}
            />
            {errors.password ? (
              <p role="alert" className={fieldErrorClassName}>
                {errors.password.message}
              </p>
            ) : null}
          </Field>
        </div>

        {serverError ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-lg bg-green-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
