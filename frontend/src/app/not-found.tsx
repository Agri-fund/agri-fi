import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-card-lg">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-muted text-3xl">
          🌱
        </div>
        <p className="text-sm font-semibold uppercase tracking-wide text-secondary">
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          This field hasn&apos;t been planted yet
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have been
          moved.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/marketplace"
            className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-primary-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Browse Marketplace
          </Link>
        </div>
      </div>
    </main>
  );
}
